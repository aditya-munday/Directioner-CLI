import { existsSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(__dirname, '../../..')

export function getDirectionerBinaryPath(): string {
  if (process.env.DIRECTIONER_BINARY) {
    return resolve(process.env.DIRECTIONER_BINARY)
  }
  return resolve(REPO_ROOT, 'cli/bin/directioner')
}

export function requireDirectionerBinary(): string {
  const binaryPath = getDirectionerBinaryPath()
  if (!existsSync(binaryPath)) {
    throw new Error(
      `Directioner binary not found at ${binaryPath}. ` +
        'Build with: bun directioner/cli/build.ts <version>',
    )
  }
  return binaryPath
}
