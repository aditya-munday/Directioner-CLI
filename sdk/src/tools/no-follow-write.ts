import { constants } from 'fs'

import type { BeyondersFileSystem } from '@beyonders/common/types/filesystem'
import type { promises } from 'fs'

/**
 * Write a file without following a symlink at the final path component.
 *
 * The write boundary resolves a symlink leaf to its target and hands the tool
 * the resolved path, so by the time we get here the leaf should not be a link.
 * This is the belt to that braces: between the check and the write the leaf
 * could be swapped for a link (the TOCTOU shape), and `O_NOFOLLOW` makes the
 * kernel refuse that case with ELOOP instead of writing through the new link.
 * A `realpath`-then-write sequence cannot make that guarantee, because the
 * second lookup happens after the check.
 *
 * `O_NOFOLLOW` exists on Linux and macOS. Windows has no equivalent flag, so
 * there the flag is omitted and the pre-write containment check is the only
 * defence; that limitation is recorded in the filesystem security note.
 */
export function noFollowWriteSupported(platform: NodeJS.Platform): boolean {
  return platform !== 'win32'
}

export async function writeFileNoFollow(params: {
  filePath: string
  content: string
  fs: BeyondersFileSystem
  platform?: NodeJS.Platform
}): Promise<void> {
  const { filePath, content, fs, platform = process.platform } = params

  if (!noFollowWriteSupported(platform)) {
    await fs.writeFile(filePath, content)
    return
  }

  // A virtual filesystem (the test mock) has no `open`; `writeFile` is what it
  // models, so fall back to it there rather than failing the write.
  const open = (fs as unknown as { open?: typeof promises.open }).open
  if (typeof open !== 'function') {
    await fs.writeFile(filePath, content)
    return
  }

  const flag =
    constants.O_WRONLY |
    constants.O_CREAT |
    constants.O_TRUNC |
    constants.O_NOFOLLOW
  const handle = await open.call(fs, filePath, flag)
  try {
    await handle.write(content)
  } finally {
    await handle.close()
  }
}
