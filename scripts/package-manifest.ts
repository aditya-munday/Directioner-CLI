#!/usr/bin/env bun

/**
 * Print an inspectable manifest of a Directioner release tarball.
 *
 * CI runs this against the .tgz it produced, so a reviewer can see exactly what
 * is inside the package without downloading a 100 MB artifact. It reads the tar
 * itself (no dependencies, no extraction to disk) and prints one line per
 * entry: role, size, sha256, and path.
 *
 * It never dumps file contents, only metadata, so a binary can be inspected
 * safely in a public log.
 *
 * Usage:
 *   bun scripts/package-manifest.ts directioner/cli/release/dist/directioner-1.0.0.tgz
 */

import { createHash } from 'crypto'
import { readFileSync, statSync } from 'fs'

const tarballPath = process.argv[2]
if (!tarballPath) {
  console.error('Usage: bun scripts/package-manifest.ts <package.tgz>')
  process.exit(2)
}

/** Strip the gzip wrapper from a .tgz using Node's zlib. */
function gunzip(data: Buffer): Buffer {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const zlib = require('zlib') as typeof import('zlib')
  return zlib.gunzipSync(data)
}

interface TarEntry {
  path: string
  size: number
  sha256: string
  content: Buffer
}

/**
 * Minimal ustar reader. npm tarballs use the POSIX ustar format with a
 * `package/` path prefix; we only need regular files and their bytes.
 */
function readTar(buffer: Buffer): TarEntry[] {
  const entries: TarEntry[] = []
  let offset = 0
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512)
    // Two consecutive zero blocks mark the end of the archive.
    if (header.every((byte) => byte === 0)) break

    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '')
    const sizeField = header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim()
    const size = sizeField ? parseInt(sizeField, 8) : 0
    const typeFlag = String.fromCharCode(header[156]!)
    const fullPath = prefix ? `${prefix}/${name}` : name

    const dataStart = offset + 512
    const dataEnd = dataStart + size
    const content = buffer.subarray(dataStart, dataEnd)

    // '0' and '\0' are regular files; only those carry content we report.
    if (typeFlag === '0' || typeFlag === '\0') {
      entries.push({
        path: fullPath,
        size,
        sha256: createHash('sha256').update(content).digest('hex'),
        content,
      })
    }

    offset = dataStart + Math.ceil(size / 512) * 512
  }
  return entries
}

/** A human role for each entry, so the manifest reads as an inventory. */
function roleOf(path: string, size: number): string {
  const base = path.replace(/^package\//, '')
  if (base === 'package.json') return 'package metadata'
  if (base === 'index.js') return 'launcher entrypoint'
  if (base === 'launcher.js') return 'launcher implementation'
  if (base === 'README.md') return 'documentation'
  if (/^LICENSE|^NOTICE|ATTRIBUTION/i.test(base)) return 'license/notice'
  if (base === 'directioner' || base === 'directioner.exe') return 'executable'
  if (base === 'tree-sitter.wasm') return 'wasm resource'
  if (/\.(map|ts|tsx)$/.test(base)) return 'DEV-ONLY (should not ship)'
  return 'other'
}

const DEV_ONLY = /(^|\/)(\.build|node_modules|\.git|.*\.map|.*\.tsx?)$|PROGRESS\.md$|SPEC\.md$/

const tarball = readFileSync(tarballPath)
const entries = readTar(gunzip(tarball))

console.log(`Package manifest — ${tarballPath}`)
console.log(`Tarball: ${statSync(tarballPath).size} bytes, ${entries.length} entries`)
console.log('')
console.log('  role                 size        sha256[:12]   path')
console.log('  -------------------- ----------- ------------- ------------------------------------')

let totalUnpacked = 0
const devOnly: string[] = []
for (const entry of entries) {
  const role = roleOf(entry.path, entry.size)
  totalUnpacked += entry.size
  if (DEV_ONLY.test(entry.path.replace(/^package\//, ''))) devOnly.push(entry.path)
  console.log(
    `  ${role.padEnd(20)} ${String(entry.size).padStart(11)} ${entry.sha256.slice(0, 12)}  ${entry.path}`,
  )
}

console.log('')
console.log(`Unpacked total: ${totalUnpacked} bytes`)

const binaryEntry = entries.find((e) => /package\/(directioner|directioner\.exe)$/.test(e.path))
if (binaryEntry) {
  console.log(`Executable sha256: ${binaryEntry.sha256}`)
}

if (devOnly.length > 0) {
  console.error(`\n✗ development-only files present in the package: ${devOnly.join(', ')}`)
  process.exit(1)
}

console.log('\n✓ Package contents look clean (no development-only files).')
