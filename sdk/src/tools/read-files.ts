import path from 'path'

import { countTokens } from '@beyonders/agent-runtime/util/token-counter'
import {
  getImageMimeType,
  isProviderSupportedImageMediaType,
  MAX_IMAGE_BASE64_SIZE,
} from '@beyonders/common/constants/images'
import { FILE_READ_STATUS } from '@beyonders/common/old-constants'
import { isFileIgnored } from '@beyonders/common/project-file-tree'
import {
  isEnvTemplateFilePath,
  isSensitiveEnvFilePath,
} from '@beyonders/common/util/env-file-path'
import {
  createFileReadLimiter,
  windowFileRead,
} from '@beyonders/common/util/file-read-limits'

import { resolveFilePath, resolveReadPath } from './path-utils'

import type { PathBoundary } from './path-utils'

import type {
  FileReadWindow,
  RequestImageFileFn,
} from '@beyonders/common/types/contracts/client'
import type { BeyondersFileSystem } from '@beyonders/common/types/filesystem'

export type FileFilterResult = {
  status: 'blocked' | 'allow-example' | 'allow'
}

export type FileFilter = (filePath: string) => FileFilterResult

export async function getFiles(params: {
  filePaths: string[]
  cwd: string
  fs: BeyondersFileSystem
  fileWindows?: Record<string, FileReadWindow[]>
  /**
   * Apply the user-facing read_files output budget. Internal edit tools need
   * the complete file so replacements below the display limit can still match.
   */
  limitContent?: boolean
  /** Apply the read_files-only .env restriction. */
  enforceEnvPolicy?: boolean
  /**
   * Filter to classify files before reading.
   * If provided, the caller takes control of additional filtering. The SDK's
   * read_files .env policy applies by default, including ordinary gitignore
   * checks for env templates.
   */
  fileFilter?: FileFilter
  /**
   * Host-authorized read roots. Absent, reads are confined to `cwd`. The run
   * passes the same boundary as writes, so an edit tool can read a file the
   * host authorized it to write while an arbitrary outside path stays refused.
   */
  boundary?: PathBoundary
}) {
  const {
    filePaths,
    cwd,
    fs,
    fileWindows,
    fileFilter,
    limitContent = true,
    enforceEnvPolicy = true,
    boundary,
  } = params
  // If the caller provides a filter, they own additional filtering decisions.
  // Otherwise the SDK also applies default gitignore checking.
  const hasCustomFilter = fileFilter !== undefined

  const result = Object.create(null) as Record<string, string | null>
  const seenPaths = new Set<string>()
  const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10MB - skip reading entirely
  const limiter = limitContent ? createFileReadLimiter({ countTokens }) : null

  for (const filePath of filePaths) {
    if (!filePath) {
      continue
    }

    const { relativePath, fullPath, isWithinProject } = resolveFilePath(
      cwd,
      filePath,
    )
    if (seenPaths.has(relativePath)) {
      continue
    }
    seenPaths.add(relativePath)

    // A read is as much a boundary crossing as a write: following a planted
    // symlink to /etc/passwd or ~/.ssh/id_rsa leaks it into the model's
    // context. Decide containment before the filesystem is touched.
    const readDecision = resolveReadPath(cwd, filePath, boundary ?? {})
    if (!readDecision.allowed) {
      result[relativePath] = FILE_READ_STATUS.OUTSIDE_PROJECT
      continue
    }

    if (enforceEnvPolicy && isSensitiveEnvFilePath(relativePath)) {
      result[relativePath] = FILE_READ_STATUS.IGNORED
      continue
    }

    // Apply file filter if provided
    const filterResult = fileFilter?.(relativePath)
    if (filterResult?.status === 'blocked') {
      result[relativePath] = FILE_READ_STATUS.IGNORED
      continue
    }
    const isEnvTemplate =
      enforceEnvPolicy && isEnvTemplateFilePath(relativePath)
    const isExampleFile =
      isEnvTemplate || filterResult?.status === 'allow-example'

    // Custom-filter callers own ordinary filtering decisions, except that env
    // templates must still obey gitignore when the read_files policy is active.
    if ((!hasCustomFilter || isEnvTemplate) && isWithinProject) {
      const ignored = await isFileIgnored({
        filePath: relativePath,
        projectRoot: cwd,
        fs,
        ...(isEnvTemplate ? { allowEnvTemplate: true } : {}),
      })
      if (ignored) {
        result[relativePath] = FILE_READ_STATUS.IGNORED
        continue
      }
    }

    try {
      // Safety check: skip reading files over 10MB to avoid OOM
      const stats = await fs.stat(fullPath)
      if (stats.size > MAX_FILE_BYTES) {
        result[relativePath] =
          FILE_READ_STATUS.TOO_LARGE +
          ` [${(stats.size / (1024 * 1024)).toFixed(1)}MB exceeds 10MB limit. Use code_search or glob to find specific content.]`
        continue
      }

      const content = await fs.readFile(fullPath, 'utf8')

      const windows = fileWindows?.[filePath]
      const windowedContent =
        limitContent && fileWindows !== undefined
          ? (windows?.length ? windows : [{}])
              .map((window: FileReadWindow) =>
                windowFileRead(content, window.offset, window.limit),
              )
              .join('\n\n')
          : content
      const returnedContent = limiter?.limit(windowedContent) ?? windowedContent
      result[relativePath] = isExampleFile
        ? FILE_READ_STATUS.TEMPLATE + '\n' + returnedContent
        : returnedContent
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        result[relativePath] = FILE_READ_STATUS.DOES_NOT_EXIST
      } else {
        result[relativePath] = FILE_READ_STATUS.ERROR
      }
    }
  }
  return { ...result }
}

/**
 * The largest image read_files attaches: the base64 ceiling the CLI enforces on
 * a pasted image after compressing it. The SDK has no image codec to shrink a
 * larger file, so the refusal tells the model how to make a smaller copy.
 */
const MAX_IMAGE_READ_BYTES = Math.floor((MAX_IMAGE_BASE64_SIZE * 3) / 4)

/** read_files for an image: the same policy as `getFiles`, but the bytes. */
export async function getImageFile(params: {
  filePath: string
  cwd: string
  fs: BeyondersFileSystem
  fileFilter?: FileFilter
  boundary?: PathBoundary
}): ReturnType<RequestImageFileFn> {
  const { filePath, cwd, fs, fileFilter, boundary } = params
  const { relativePath, fullPath, isWithinProject } = resolveFilePath(
    cwd,
    filePath,
  )
  const ext = path.extname(relativePath)
  const mediaType = getImageMimeType(ext)
  if (!mediaType) return { path: relativePath, error: FILE_READ_STATUS.ERROR }

  // An image read is still a read: it must not follow a planted link out of
  // the project and return the bytes.
  if (!resolveReadPath(cwd, filePath, boundary ?? {}).allowed) {
    return { path: relativePath, error: FILE_READ_STATUS.OUTSIDE_PROJECT }
  }
  // A BMP or TIFF is an image we recognise but no vision provider decodes:
  // attached anyway, it 400s this turn AND every later turn of the thread
  // (history is replayed) with "unsupported image ... webp, png, jpeg, and
  // gif". Refuse here, where the model can still act on it.
  if (!isProviderSupportedImageMediaType(mediaType)) {
    return {
      path: relativePath,
      error:
        FILE_READ_STATUS.ERROR +
        ` [${ext} images cannot be attached; models accept only PNG, JPEG, GIF and WebP. Convert it with a terminal command (for example \`magick ${relativePath} /tmp/preview.png\`) and read that instead.]`,
    }
  }
  if (fileFilter?.(relativePath).status === 'blocked') {
    return { path: relativePath, error: FILE_READ_STATUS.IGNORED }
  }
  if (
    !fileFilter &&
    isWithinProject &&
    (await isFileIgnored({ filePath: relativePath, projectRoot: cwd, fs }))
  ) {
    return { path: relativePath, error: FILE_READ_STATUS.IGNORED }
  }

  try {
    const stats = await fs.stat(fullPath)
    if (stats.size > MAX_IMAGE_READ_BYTES) {
      const kb = (bytes: number) => Math.round(bytes / 1024)
      return {
        path: relativePath,
        error:
          FILE_READ_STATUS.TOO_LARGE +
          ` [Image is ${kb(stats.size)} KB; images over ${kb(MAX_IMAGE_READ_BYTES)} KB cannot be attached. Save a downscaled copy with a terminal command (for example \`magick ${relativePath} -resize 1024x1024 /tmp/preview.png\`) and read that instead.]`,
      }
    }
    const data = Buffer.from(await fs.readFile(fullPath)).toString('base64')
    return { path: relativePath, data, mediaType, bytes: stats.size }
  } catch (error) {
    const missing =
      !!error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    return {
      path: relativePath,
      error: missing ? FILE_READ_STATUS.DOES_NOT_EXIST : FILE_READ_STATUS.ERROR,
    }
  }
}
