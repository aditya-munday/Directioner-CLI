import { resolveReadPath } from './path-utils'

import type { BeyondersToolOutput } from '@beyonders/common/tools/list'
import type { BeyondersFileSystem } from '@beyonders/common/types/filesystem'
import type { PathBoundary } from './path-utils'

export async function listDirectory(params: {
  directoryPath: string
  projectPath: string
  fs: BeyondersFileSystem
  boundary?: PathBoundary
}): Promise<BeyondersToolOutput<'list_directory'>> {
  const { directoryPath, projectPath, fs, boundary } = params

  try {
    // The model names this path. Listing a directory discloses the names it
    // contains, so it crosses the same boundary a read does. Without this,
    // `list_directory /etc` listed /etc and a symlinked directory listed its
    // outside target — a read the file tools refuse, reached by another door.
    const decision = resolveReadPath(
      projectPath,
      directoryPath,
      boundary ?? {},
    )
    if (!decision.allowed) {
      return [{ type: 'json', value: { errorMessage: decision.reason } }]
    }

    const entries = await fs.readdir(decision.fullPath, {
      withFileTypes: true,
    })

    const files: string[] = []
    const directories: string[] = []

    for (const entry of entries) {
      if (entry.isDirectory()) {
        directories.push(entry.name)
      } else if (entry.isFile()) {
        files.push(entry.name)
      }
    }

    return [
      {
        type: 'json',
        value: {
          files,
          directories,
          path: directoryPath,
        },
      },
    ]
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return [
      {
        type: 'json',
        value: {
          errorMessage: `Failed to list directory: ${errorMessage}`,
        },
      },
    ]
  }
}
