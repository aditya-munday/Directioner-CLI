#!/usr/bin/env bun

/**
 * Assemble the Directioner-CLI **OS component** — the prebuilt, preinstalled
 * Linux artifact Directioner-OS includes in its image.
 *
 * This is the intended customer delivery, replacing the npm archive. It is a
 * deterministic directory (not a `.tgz`) that an OS build step copies into the
 * image. Nothing here publishes, packs, or contacts a network origin.
 *
 * Layout (deterministic; no timestamps, so a rebuild is byte-identical):
 *
 *   directioner-cli-component/
 *   ├── bin/
 *   │   ├── directioner          the compiled Linux executable
 *   │   └── tree-sitter.wasm     sibling asset (see below)
 *   ├── manifest.json            machine-readable component identity
 *   ├── SHA256SUMS               sha256 of every payload file
 *   └── NOTICE                   upstream attribution (Apache-2.0 §4)
 *
 * WHY THE WASM IS A SIBLING OF THE BINARY
 *
 * `cli/src/pre-init/tree-sitter-wasm.ts` locates `tree-sitter.wasm` next to
 * `process.execPath` / `argv[0]`. There is no `share/<pkg>` lookup. So the
 * component keeps the wasm beside the executable; an OS image that wants a
 * `/usr/share/directioner/tree-sitter.wasm` layout must either keep them
 * together or the runtime lookup must be extended first. That handoff is
 * documented, not assumed.
 *
 * Usage:
 *   bun directioner/cli/build.ts <version>        # build the binary first
 *   bun scripts/build-component.ts <version> [outDir]
 *
 * Default outDir: directioner/cli/release/component
 */

import { spawnSync } from 'child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import { createHash } from 'crypto'
import { dirname, join, relative } from 'path'
import { fileURLToPath } from 'url'

import { detectBinaryFormat } from './validate-release'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')
const binDir = join(repoRoot, 'cli', 'bin')

const version = process.argv[2]
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('Usage: bun scripts/build-component.ts <version> [outDir]')
  process.exit(2)
}

const outDir = process.argv[3]
  ? join(process.cwd(), process.argv[3])
  : join(repoRoot, 'directioner', 'cli', 'release', 'component')

function fail(message: string): never {
  console.error(`❌ ${message}`)
  process.exit(1)
}

const binarySource = join(binDir, 'directioner')
const wasmSource = join(binDir, 'tree-sitter.wasm')
if (!existsSync(binarySource)) {
  fail(
    `built binary is missing: ${binarySource}\n` +
      `  build it first: bun directioner/cli/build.ts ${version}`,
  )
}
if (!existsSync(wasmSource)) {
  fail(`tree-sitter.wasm sibling is missing: ${wasmSource}`)
}

// The supported Linux architecture is read from the real binary, not guessed.
const format = detectBinaryFormat(readFileSync(binarySource))
if (!format || !format.startsWith('elf:')) {
  fail(`binary is not an ELF executable (detected: ${format ?? 'unknown'}). This component targets Linux.`)
}
const arch = format.split(':')[1]!

rmSync(outDir, { recursive: true, force: true })
mkdirSync(join(outDir, 'bin'), { recursive: true })

// Payload files, relative to the component root. Order is fixed for determinism.
const payload: string[] = []

function copyPayload(source: string, dest: string) {
  const target = join(outDir, dest)
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(source, target)
  // Only the entrypoint is executable; everything else is a plain data file.
  spawnSync('chmod', [dest === 'bin/directioner' ? '755' : '644', target])
  payload.push(dest)
}

copyPayload(binarySource, 'bin/directioner')
copyPayload(wasmSource, 'bin/tree-sitter.wasm')

// SHA256SUMS — sorted by path so the file is stable across machines.
function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

const sums = [...payload]
  .sort()
  .map((p) => `${sha256(join(outDir, p))}  ${p}`)
  .join('\n')
writeFileSync(join(outDir, 'SHA256SUMS'), `${sums}\n`)

// NOTICE — required Apache-2.0 §4 attribution for the Codebuff-derived work.
const noticeSource = join(repoRoot, 'NOTICE')
if (!existsSync(noticeSource)) fail('NOTICE is missing from the repository root')
copyFileSync(noticeSource, join(outDir, 'NOTICE'))

// manifest.json — machine-readable identity an OS build can consume.
const manifest = {
  component: 'directioner-cli',
  product: 'Directioner-CLI',
  version,
  platform: 'linux',
  architecture: arch,
  entrypoint: 'bin/directioner',
  runtimeAssets: ['bin/tree-sitter.wasm'],
  integrity: { algorithm: 'sha256', file: 'SHA256SUMS' },
  notice: 'NOTICE',
  repository: 'github.com/aditya-munday/Directioner-CLI',
}
writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

const size = (p: string) => statSync(join(outDir, p)).size
console.error(
  `✅ Built Directioner-CLI OS component v${version} (${arch}) at ${outDir}\n` +
    `   bin/directioner      ${size('bin/directioner')} bytes\n` +
    `   bin/tree-sitter.wasm ${size('bin/tree-sitter.wasm')} bytes\n` +
    `   manifest.json, SHA256SUMS, NOTICE`,
)
// A machine-readable line for CI logs / scripts.
console.log(JSON.stringify({ componentDir: relative(repoRoot, outDir), version, architecture: arch }))
