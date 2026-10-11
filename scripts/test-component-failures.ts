#!/usr/bin/env bun

/**
 * Prove the component validator fails on each defect it claims to catch.
 *
 * Copies a known-good component, injects one defect at a time, and asserts the
 * validator exits non-zero and names the responsible check. This is the
 * OS-component counterpart to `scripts/test-validator-failures.ts`.
 *
 * Usage:
 *   bun scripts/build-component.ts <version>
 *   bun scripts/test-component-failures.ts [componentDir]
 */

import { spawnSync } from 'child_process'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  chmodSync,
} from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const goodDir = resolve(
  process.argv[2] ?? join(import.meta.dir, '..', 'directioner/cli/release/component'),
)
if (!existsSync(goodDir)) {
  console.error(
    `No built component at ${goodDir}. Build one first:\n` +
      `  bun scripts/build-component.ts <version>`,
  )
  process.exit(2)
}

const validator = join(import.meta.dir, 'validate-component.ts')

interface Injection {
  label: string
  mutate: (dir: string) => void
  expect: string
}

function readManifest(dir: string): any {
  return JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
}
function writeManifest(dir: string, manifest: unknown): void {
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
}

const injections: Injection[] = [
  {
    label: 'missing tree-sitter.wasm payload',
    mutate: (dir) => rmSync(join(dir, 'bin', 'tree-sitter.wasm'), { force: true }),
    expect: 'component: required files present',
  },
  {
    label: 'wrong component identity',
    mutate: (dir) => {
      const m = readManifest(dir)
      m.component = 'beyonders'
      writeManifest(dir, m)
    },
    expect: 'manifest: identity and layout',
  },
  {
    label: 'non-Linux platform claimed',
    mutate: (dir) => {
      const m = readManifest(dir)
      m.platform = 'win32'
      writeManifest(dir, m)
    },
    expect: 'manifest: identity and layout',
  },
  {
    label: 'architecture disagrees with the binary',
    mutate: (dir) => {
      const m = readManifest(dir)
      m.architecture = 'arm64'
      writeManifest(dir, m)
    },
    expect: 'manifest: architecture is declared and consistent with the binary',
  },
  {
    label: 'version mismatch',
    mutate: (dir) => {
      const m = readManifest(dir)
      m.version = '9.9.9'
      writeManifest(dir, m)
    },
    expect: 'manifest: version matches the requested release version',
  },
  {
    label: 'tampered payload (integrity)',
    mutate: (dir) =>
      writeFileSync(
        join(dir, 'bin', 'tree-sitter.wasm'),
        readFileSync(join(dir, 'bin', 'tree-sitter.wasm')).toString() + 'tamper',
      ),
    expect: 'integrity: SHA256SUMS verifies every payload file',
  },
  {
    label: 'missing SHA256SUMS',
    mutate: (dir) => rmSync(join(dir, 'SHA256SUMS'), { force: true }),
    expect: 'component: required files present',
  },
  {
    label: 'SHA256SUMS does not cover the binary',
    mutate: (dir) => writeFileSync(join(dir, 'SHA256SUMS'), ''),
    expect: 'integrity: SHA256SUMS verifies every payload file',
  },
  {
    label: 'NOTICE loses upstream attribution',
    mutate: (dir) => writeFileSync(join(dir, 'NOTICE'), 'Directioner CLI\n'),
    expect: 'component: NOTICE preserves upstream attribution',
  },
  {
    label: 'unexpected extra executable',
    mutate: (dir) => {
      writeFileSync(join(dir, 'bin', 'helper'), '#!/bin/sh\n')
      chmodSync(join(dir, 'bin', 'helper'), 0o755)
    },
    expect: 'component: no unexpected executable files',
  },
]

let failures = 0
console.log(`Component validator failure behavior — ${goodDir}\n`)

for (const injection of injections) {
  const dir = mkdtempSync(join(tmpdir(), 'directioner-component-inject-'))
  try {
    cpSync(goodDir, dir, { recursive: true })
    injection.mutate(dir)

    const result = spawnSync('bun', [validator, dir, '--expected-version', '0.1.0'], {
      encoding: 'utf8',
      timeout: 120_000,
    })
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
  console.error(`Component validator failure behavior FAILED (${failures} injection(s) not caught).`)
  process.exit(1)
}
console.log(`✅ All ${injections.length} injected component defects were caught by the validator.`)
