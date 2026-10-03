#!/usr/bin/env bun

/**
 * Prove the release validator fails for the right reason.
 *
 * The validator is only a gate if a broken package actually fails it. This
 * script copies a known-good package directory, injects one defect at a time,
 * runs `scripts/validate-release.ts`, and asserts it exits non-zero with the
 * expected class of failure.
 *
 * It is committed so "the gate still works" is a repeatable check rather than a
 * claim. Run it locally or in CI; it never touches the network.
 *
 * Usage:
 *   bun scripts/test-validator-failures.ts [goodPackageDir]
 *
 * Default goodPackageDir: directioner/cli/release/.build
 */

import { spawnSync } from 'child_process'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'path'

const goodDir = resolve(
  process.argv[2] ?? join(import.meta.dir, '..', 'directioner/cli/release/.build'),
)
if (!existsSync(goodDir)) {
  console.error(
    `No built package at ${goodDir}. Build one first:\n` +
      `  bun directioner/cli/release.ts <version>`,
  )
  process.exit(2)
}

const validator = join(import.meta.dir, 'validate-release.ts')

interface Injection {
  /** What is being broken, for the log. */
  label: string
  /** Mutate a fresh copy of the good package. */
  mutate: (dir: string) => void
  /** A substring the validator output must contain. */
  expect: string
}

function readManifest(dir: string): any {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
}
function writeManifest(dir: string, manifest: unknown): void {
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, null, 2))
}

const injections: Injection[] = [
  {
    label: 'injected vendor URL in a package file',
    mutate: (dir) => {
      const readme = readFileSync(join(dir, 'README.md'), 'utf8')
      writeFileSync(join(dir, 'README.md'), `${readme}\nDownload: https://beyonders.com/api/releases\n`)
    },
    expect: 'legacy: package files carry no vendor references',
  },
  {
    label: 'fake credential in a package file',
    mutate: (dir) => {
      const launcher = readFileSync(join(dir, 'launcher.js'), 'utf8')
      writeFileSync(join(dir, 'launcher.js'), `${launcher}\n// sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaa\n`)
    },
    expect: 'secrets: no credentials in package files',
  },
  {
    label: 'missing tree-sitter.wasm',
    mutate: (dir) => rmSync(join(dir, 'tree-sitter.wasm'), { force: true }),
    expect: 'archive: required runtime assets present',
  },
  {
    label: 'wrong package name',
    mutate: (dir) => {
      const manifest = readManifest(dir)
      manifest.name = 'beyonders'
      writeManifest(dir, manifest)
    },
    expect: 'identity: package name',
  },
  {
    label: 'wrong executable name',
    mutate: (dir) => {
      const manifest = readManifest(dir)
      manifest.bin = { directioner: 'cli.js' }
      writeManifest(dir, manifest)
    },
    expect: 'identity: executable name',
  },
  {
    label: 'archive nesting (a tarball inside the package)',
    mutate: (dir) => writeFileSync(join(dir, 'directioner-9.9.9.tgz'), 'x'),
    expect: 'archive: no nested copy of itself',
  },
  {
    label: 'missing binary',
    mutate: (dir) => {
      rmSync(join(dir, 'directioner'), { force: true })
      rmSync(join(dir, 'directioner.exe'), { force: true })
    },
    expect: 'archive: required runtime assets present',
  },
  {
    label: 'vendor repository metadata',
    mutate: (dir) => {
      const manifest = readManifest(dir)
      manifest.repository = { type: 'git', url: 'git+https://github.com/BeyondersAI/beyonders.git' }
      writeManifest(dir, manifest)
    },
    expect: 'identity: repository metadata',
  },
  {
    label: 'version mismatch between binary and package',
    mutate: (dir) => {
      const manifest = readManifest(dir)
      manifest.version = '0.0.0'
      writeManifest(dir, manifest)
    },
    expect: 'version: binary reports the packaged version',
  },
  {
    label: 'README without BYOK guidance',
    mutate: (dir) => writeFileSync(join(dir, 'README.md'), '# Directioner\n'),
    expect: 'docs: README describes BYOK configuration',
  },
  {
    label: 'development-only file shipped',
    mutate: (dir) => writeFileSync(join(dir, 'PROGRESS.md'), 'internal notes'),
    expect: 'archive: no internal-only files',
  },
]

let failures = 0
console.log(`Validator failure behavior — ${goodDir}\n`)

for (const injection of injections) {
  const dir = mkdtempSync(join(tmpdir(), 'directioner-inject-'))
  try {
    cpSync(goodDir, dir, { recursive: true })
    injection.mutate(dir)

    const result = spawnSync('bun', [validator, dir], { encoding: 'utf8', timeout: 120_000 })
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
    const exitedNonZero = result.status !== 0
    const namedCorrectly = output.includes(injection.expect)

    if (exitedNonZero && namedCorrectly) {
      console.log(`  ✓ ${injection.label} → exit ${result.status}, "${injection.expect}"`)
    } else {
      failures++
      console.error(
        `  ✗ ${injection.label} → exit ${result.status}, ` +
          `expected "${injection.expect}" ${namedCorrectly ? '' : '(not named in output)'}`,
      )
      if (!exitedNonZero) console.error('    validator did NOT fail — the gate is broken')
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

console.log('')
if (failures > 0) {
  console.error(`Validator failure behavior FAILED (${failures} injection(s) not caught).`)
  process.exit(1)
}
console.log(`✅ All ${injections.length} injected defects were caught by the validator.`)
