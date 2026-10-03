import { fileExists } from '@beyonders/common/util/file'
import { applyPatch } from 'diff'
import z from 'zod/v4'

import { resolveWritePath } from './path-utils'
import { writeFileRooted } from './rooted-write'

import type { BeyondersToolOutput } from '@beyonders/common/tools/list'
import type { BeyondersFileSystem } from '@beyonders/common/types/filesystem'
import type { PathBoundary, ResolvedProjectPath } from './path-utils'

const FileChangeSchema = z.object({
  type: z.enum(['patch', 'file']),
  path: z.string(),
  content: z.string(),
})

type FileChange = z.infer<typeof FileChangeSchema>

type ApplyChangeResult =
  | { status: 'created' | 'modified'; file: string }
  | { status: 'patchFailed'; file: string; patch: string }
  | { status: 'invalid'; file: string }

/** Host-authorized path exceptions; see `PathBoundary` in path-utils. */
export type { PathBoundary } from './path-utils'

export async function changeFile(params: {
  parameters: unknown
  cwd: string
  fs: BeyondersFileSystem
  boundary?: PathBoundary
}): Promise<BeyondersToolOutput<'str_replace'>> {
  const { parameters, cwd, fs, boundary } = params

  const fileChange = FileChangeSchema.parse(parameters)

  // The model supplies `path`; it is untrusted input. Authorization is decided
  // here, at the tool boundary, and is separate from parsing the argument.
  const decision = resolveWritePath(cwd, fileChange.path, boundary ?? {})
  if (!decision.allowed) {
    return [
      {
        type: 'json',
        value: {
          file: decision.fullPath,
          errorMessage: decision.reason,
        },
      },
    ]
  }

  const resolvedPath: ResolvedProjectPath = {
    fullPath: decision.fullPath,
    relativePath: decision.relativePath,
  }
  const result = await applyChange({
    change: fileChange,
    resolvedPath,
    fs,
    root: decision.root,
  })

  return [{ type: 'json', value: formatApplyChangeResult(result, fileChange) }]
}

function formatApplyChangeResult(
  result: ApplyChangeResult,
  fileChange: FileChange,
): BeyondersToolOutput<'str_replace'>[0]['value'] {
  if (result.status === 'created' || result.status === 'modified') {
    return {
      file: result.file,
      message:
        fileChange.type === 'patch'
          ? 'String replace applied successfully.'
          : result.status === 'created'
            ? 'Created file successfully.'
            : 'Overwrote file successfully.',
    }
  }

  if (result.status === 'patchFailed') {
    return {
      file: result.file,
      errorMessage: `Failed to apply patch.`,
      patch: result.patch,
    }
  }

  return {
    file: result.file,
    errorMessage:
      'Failed to write to file: file path caused an error or file could not be written',
  }
}

/**
 * Apply a validated change. The caller has already authorized `fullPath`, and
 * `root` is the authorized root it was matched against.
 */
async function applyChange(params: {
  change: FileChange
  resolvedPath: ResolvedProjectPath
  fs: BeyondersFileSystem
  root?: string
}): Promise<ApplyChangeResult> {
  const { change, resolvedPath, fs, root } = params
  const { content, type } = change
  const { fullPath, relativePath } = resolvedPath

  try {
    const exists = await fileExists({ filePath: fullPath, fs })

    if (type === 'file') {
      // Pinned: a parent swapped for a symlink is refused by the kernel, and a
      // hard link to an outside file is replaced rather than written through.
      await writeFileRooted({ root, filePath: fullPath, content, fs })
    } else {
      const oldContent = await fs.readFile(fullPath, 'utf-8')
      const newContent = applyPatch(oldContent, content)
      if (newContent === false) {
        return { status: 'patchFailed', file: relativePath, patch: content }
      }
      await writeFileRooted({ root, filePath: fullPath, content: newContent, fs })
    }

    return { status: exists ? 'modified' : 'created', file: relativePath }
  } catch (error) {
    console.error(`Failed to apply patch to ${relativePath}:`, error, content)
    return { status: 'invalid', file: relativePath }
  }
}
