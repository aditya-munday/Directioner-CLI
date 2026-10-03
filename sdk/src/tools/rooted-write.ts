import { randomUUID } from 'node:crypto'
import nodeFs from 'node:fs'
import path from 'node:path'

import { ensureDirectoryExists } from '@beyonders/common/util/file'

import { writeFileNoFollow } from './no-follow-write'

import type { BeyondersFileSystem } from '@beyonders/common/types/filesystem'
import type { FileHandle } from 'node:fs/promises'

/**
 * Kernel-enforced write/delete boundary for the ordinary file tools.
 *
 * `resolveWritePath` decides containment, then the tool acts. Between those two
 * moments a directory on the path can be replaced by a symlink (the TOCTOU
 * shape), and `O_NOFOLLOW` does not cover it: it protects only the FINAL
 * component, while `open`/`rename` still follow a symlinked PARENT. Measured,
 * not assumed: a probe flipping `project/racedir` between a directory and a
 * link to an outside directory landed a write at `outside/b.txt`.
 *
 * A second escape needs no race at all: a hard link inside the project to a
 * file outside it makes the two names one inode, so writing the in-project
 * name rewrites the outside file. Measured: `ln outside/target project/hl` then
 * a write to `project/hl` changed `outside/target`.
 *
 * Both are closed the way the sponsored file layer closes them (COD-642), by
 * making the operation act on the SAME object the check approved, through a
 * held-open directory handle:
 *
 *  1. Open the authorized root `O_DIRECTORY | O_NOFOLLOW` and pin it with a
 *     kernel-resolved handle name (`/proc/self/fd/<fd>` on Linux,
 *     `/.vol/<dev>/<ino>` on macOS). Every step below resolves relative to that
 *     handle, so a component swapped for a link is refused with `ELOOP`, not
 *     followed.
 *  2. Walk the parent components one at a time, each opened `O_NOFOLLOW`
 *     relative to the previous pin.
 *  3. Write content to a FRESH file created exclusively beside the target and
 *     `rename` it over the target through the same pin. The target inode is
 *     never opened for writing, so a hard link to an outside file is replaced
 *     rather than written through, and no reader sees half a file.
 *
 * This is application code driving kernel primitives, not a sandbox: it bounds
 * what THESE operations do. It does not bound a shell command, and it does not
 * exist on Windows (see {@link rootedWriteSupport}).
 */

export type RootedWriteSupport = 'pinned' | 'unpinned'

/**
 * Whether this platform can pin a directory by an open handle.
 *
 * Linux (`/proc/self/fd`) and macOS (`/.vol`) can. Windows cannot: Node exposes
 * no handle-relative open there, so the ordinary tools keep the check plus an
 * `O_NOFOLLOW` leaf and the parent-swap race remains — a limitation the
 * filesystem security note records rather than hides.
 */
export function rootedWriteSupport(
  platform: NodeJS.Platform = process.platform,
): RootedWriteSupport {
  return platform === 'linux' || platform === 'darwin'
    ? 'pinned'
    : 'unpinned'
}

interface Pinned {
  pin: string
  handle: FileHandle
}

function pinFor(
  platform: NodeJS.Platform,
  handle: FileHandle,
  dev: bigint,
  ino: bigint,
): string | null {
  if (platform === 'linux') return `/proc/self/fd/${handle.fd}`
  if (platform === 'darwin') return `/.vol/${dev}/${ino}`
  return null
}

function symlinkSwapRefusal(): NodeJS.ErrnoException {
  const error = new Error(
    'Refused: a component of the path was replaced by a symlink while the operation was in progress.',
  ) as NodeJS.ErrnoException
  error.code = 'ELOOP'
  return error
}

/** Open `dirPath` and prove its pin names the very directory the handle holds. */
async function pinDirectory(
  dirPath: string,
  platform: NodeJS.Platform,
): Promise<Pinned | null> {
  let handle: FileHandle
  try {
    handle = await nodeFs.promises.open(
      dirPath,
      nodeFs.constants.O_RDONLY |
        nodeFs.constants.O_DIRECTORY |
        nodeFs.constants.O_NOFOLLOW,
    )
  } catch {
    return null
  }
  try {
    const opened = await handle.stat({ bigint: true })
    const pin = pinFor(platform, handle, opened.dev, opened.ino)
    if (!pin) throw new Error('no pin mechanism')
    const named = await nodeFs.promises
      .stat(pin, { bigint: true })
      .catch(() => null)
    if (!named || named.dev !== opened.dev || named.ino !== opened.ino) {
      throw new Error('pin does not name the opened directory')
    }
    return { pin, handle }
  } catch {
    await handle.close()
    return null
  }
}

/** Descend one component from a pin, refusing a symlink component. */
async function pinChild(
  parent: Pinned,
  name: string,
  create: boolean,
  platform: NodeJS.Platform,
): Promise<Pinned | null> {
  const target = `${parent.pin}/${name}`
  if (create) {
    await nodeFs.promises.mkdir(target).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') throw error
    })
  }
  let handle: FileHandle
  try {
    handle = await nodeFs.promises.open(
      target,
      nodeFs.constants.O_RDONLY |
        nodeFs.constants.O_DIRECTORY |
        nodeFs.constants.O_NOFOLLOW,
    )
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    // macOS answers O_DIRECTORY|O_NOFOLLOW on a link with ENOTDIR, not ELOOP.
    if (code === 'ELOOP' || code === 'ENOTDIR') throw symlinkSwapRefusal()
    if (code === 'ENOENT' && !create) return null
    throw error
  }
  const opened = await handle.stat({ bigint: true })
  const pin = pinFor(platform, handle, opened.dev, opened.ino)
  if (!pin) {
    await handle.close()
    return null
  }
  return { pin, handle }
}

function segmentsWithin(root: string, target: string): string[] {
  const parts = path.relative(root, target).split(path.sep).filter(Boolean)
  for (const part of parts) {
    if (part === '.' || part === '..' || part.includes('\0')) {
      const error = new Error(
        `Refused: '${target}' is not inside the authorized root.`,
      ) as NodeJS.ErrnoException
      error.code = 'EINVAL'
      throw error
    }
  }
  return parts
}

/** Walk to the leaf's parent through pins, returning the anchor and leaf name. */
async function pinParent(
  canonicalRoot: string,
  filePath: string,
  create: boolean,
  platform: NodeJS.Platform,
): Promise<{ anchor: Pinned; leaf: string } | null> {
  const rootPin = await pinDirectory(canonicalRoot, platform)
  if (!rootPin) return null
  const parts = segmentsWithin(canonicalRoot, filePath)
  const leaf = parts.pop()
  if (!leaf) {
    await rootPin.handle.close()
    throw new Error('Refused: cannot operate on the authorized root itself.')
  }
  let anchor = rootPin
  try {
    for (const name of parts) {
      const child = await pinChild(anchor, name, create, platform)
      if (!child) throw new Error('Refused: could not pin a parent directory.')
      await anchor.handle.close()
      anchor = child
    }
    return { anchor, leaf }
  } catch (error) {
    await anchor.handle.close()
    throw error
  }
}

/**
 * Write `content` to `filePath` (already authorized inside `root`) so the
 * operation targets the object the check approved.
 */
export async function writeFileRooted(params: {
  root: string | undefined
  filePath: string
  content: string
  fs: BeyondersFileSystem
  platform?: NodeJS.Platform
  /**
   * TEST SEAM. Called after the parent is pinned and before the content is
   * staged, the window a concurrent swap would aim for. Production callers
   * never pass it.
   */
  raceWindow?: () => void | Promise<void>
}): Promise<{ mode: RootedWriteSupport }> {
  const { filePath, content, fs: vfs, platform = process.platform } = params
  const hasOpen =
    typeof (vfs as unknown as { open?: unknown }).open === 'function'

  if (rootedWriteSupport(platform) === 'unpinned' || !hasOpen || !params.root) {
    await ensureDirectoryExists({ baseDir: path.dirname(filePath), fs: vfs })
    await writeFileNoFollow({ filePath, content, fs: vfs, platform })
    return { mode: 'unpinned' }
  }

  let canonicalRoot: string
  try {
    canonicalRoot = nodeFs.realpathSync(params.root)
  } catch {
    await ensureDirectoryExists({ baseDir: path.dirname(filePath), fs: vfs })
    await writeFileNoFollow({ filePath, content, fs: vfs, platform })
    return { mode: 'unpinned' }
  }

  const pinned = await pinParent(canonicalRoot, filePath, true, platform)
  if (!pinned) {
    await ensureDirectoryExists({ baseDir: path.dirname(filePath), fs: vfs })
    await writeFileNoFollow({ filePath, content, fs: vfs, platform })
    return { mode: 'unpinned' }
  }
  const { anchor, leaf } = pinned
  await params.raceWindow?.()
  const staged = `.directioner-write-${randomUUID()}.tmp`
  const stagedPath = `${anchor.pin}/${staged}`
  let renamed = false
  try {
    let handle: FileHandle
    try {
      handle = await nodeFs.promises.open(
        stagedPath,
        nodeFs.constants.O_WRONLY |
          nodeFs.constants.O_CREAT |
          nodeFs.constants.O_EXCL |
          nodeFs.constants.O_NOFOLLOW,
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ELOOP') {
        throw symlinkSwapRefusal()
      }
      throw error
    }
    try {
      await handle.writeFile(content)
    } finally {
      await handle.close()
    }
    await nodeFs.promises.rename(stagedPath, `${anchor.pin}/${leaf}`)
    renamed = true
    return { mode: 'pinned' }
  } finally {
    if (!renamed) {
      await nodeFs.promises.unlink(stagedPath).catch(() => {})
    }
    await anchor.handle.close()
  }
}

/** Remove `filePath` (already authorized inside `root`) through the same pin. */
export async function removeFileRooted(params: {
  root: string | undefined
  filePath: string
  fs: BeyondersFileSystem
  platform?: NodeJS.Platform
}): Promise<{ mode: RootedWriteSupport }> {
  const { filePath, fs: vfs, platform = process.platform } = params
  const hasOpen =
    typeof (vfs as unknown as { open?: unknown }).open === 'function'

  if (rootedWriteSupport(platform) === 'unpinned' || !hasOpen || !params.root) {
    await vfs.unlink(filePath)
    return { mode: 'unpinned' }
  }

  let canonicalRoot: string
  try {
    canonicalRoot = nodeFs.realpathSync(params.root)
  } catch {
    await vfs.unlink(filePath)
    return { mode: 'unpinned' }
  }

  const pinned = await pinParent(canonicalRoot, filePath, false, platform)
  if (!pinned) {
    await vfs.unlink(filePath)
    return { mode: 'unpinned' }
  }
  const { anchor, leaf } = pinned
  try {
    await nodeFs.promises.unlink(`${anchor.pin}/${leaf}`)
    return { mode: 'pinned' }
  } finally {
    await anchor.handle.close()
  }
}
