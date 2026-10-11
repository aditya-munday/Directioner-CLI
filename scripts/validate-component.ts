#!/usr/bin/env bun

/**
 * Validate a built Directioner-CLI **OS component** directory.
 *
 * The component validator is the pre-release gate for the preinstalled
 * Directioner-OS artifact (see `scripts/build-component.ts`). It replaces the
 * npm-archive validation path while preserving the guarantees that mattered:
 * correct identity, correct architecture, required runtime assets, integrity
 * verification, corrupt-artifact rejection, unexpected-executable detection,
 * secret scanning.
 *
 * It does NOT assert that the CLI is preinstalled in a working OS image — that
 * requires a real Directioner-OS build integration, which is out of scope here
 * and marked DESIGNED/BLOCKED in the docs.
 *
 * Usage:
 *   bun scripts/validate-component.ts [componentDir] [--expected-version <v>]
 *
 * Default componentDir: directioner/cli/release/component
 */

import { createHash } from 'crypto'
import { spawnSync } from 'child_process'
import { existsSync, readFileSync, statSync } from 'fs'
import { join, resolve } from 'path'

import { detectBinaryFormat, scanForSecrets } from './validate-release'

export interface ComponentCheck {
  name: string
  ok: boolean
  detail: string
}

export interface ComponentReport {
  ok: boolean
  checks: ComponentCheck[]
}

const REPO_ROOT = resolve(import.meta.dir, '..')

const REQUIRED_FILES = [
  'bin/directioner',
  'bin/tree-sitter.wasm',
  'manifest.json',
  'SHA256SUMS',
  'NOTICE',
]

const MAX_BINARY_BYTES = 250 * 1024 * 1024
const MIN_BINARY_BYTES = 5 * 1024 * 1024

const EXPECTED_REPOSITORY = 'github.com/aditya-munday/Directioner-CLI'

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function check(name: string, fn: () => string | null): ComponentCheck {
  try {
    const failure = fn()
    return failure === null
      ? { name, ok: true, detail: 'ok' }
      : { name, ok: false, detail: failure }
  } catch (error) {
    return {
      name,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

/** Parse SHA256SUMS into path -> digest. Tolerates the `sha256sum` format. */
export function parseSums(text: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of text.split('\n')) {
    const match = line.match(/^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/)
    if (match) map.set(match[2]!.trim(), match[1]!.toLowerCase())
  }
  return map
}

export function validateComponent(
  componentDir: string,
  expectedVersion: string | null = null,
): ComponentReport {
  if (!existsSync(componentDir) || !statSync(componentDir).isDirectory()) {
    return {
      ok: false,
      checks: [{ name: 'component directory', ok: false, detail: `not a directory: ${componentDir}` }],
    }
  }

  const manifestPath = join(componentDir, 'manifest.json')
  const readManifest = (): Record<string, unknown> =>
    JSON.parse(readFileSync(manifestPath, 'utf8'))
  const readText = (name: string): string | null =>
    existsSync(join(componentDir, name)) ? readFileSync(join(componentDir, name), 'utf8') : null

  const checks: ComponentCheck[] = [
    check('component: required files present', () => {
      const missing = REQUIRED_FILES.filter((name) => !existsSync(join(componentDir, name)))
      return missing.length === 0 ? null : `missing: ${missing.join(', ')}`
    }),

    check('manifest: identity and layout', () => {
      const m = readManifest()
      if (m.component !== 'directioner-cli') return `component is "${m.component}"`
      if (m.platform !== 'linux') return `platform is "${m.platform}", expected "linux"`
      if (m.entrypoint !== 'bin/directioner') return `entrypoint is "${m.entrypoint}"`
      if (m.repository !== EXPECTED_REPOSITORY) return `repository is "${m.repository}"`
      return null
    }),

    check('manifest: version is semver', () => {
      const m = readManifest()
      return /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(String(m.version))
        ? null
        : `version "${m.version}" is not semver`
    }),

    check('manifest: version matches the requested release version', () => {
      if (expectedVersion === null) return null
      const m = readManifest()
      return m.version === expectedVersion
        ? null
        : `manifest version is ${m.version}, expected ${expectedVersion}`
    }),

    check('manifest: architecture is declared and consistent with the binary', () => {
      const m = readManifest()
      const arch = String(m.architecture ?? '')
      const format = detectBinaryFormat(readFileSync(join(componentDir, 'bin/directioner')))
      if (!format || !format.startsWith('elf:')) return `binary is not ELF (${format})`
      const binaryArch = format.split(':')[1]
      return arch === binaryArch
        ? null
        : `manifest architecture ${arch} disagrees with binary ${binaryArch}`
    }),

    check('integrity: SHA256SUMS verifies every payload file', () => {
      const sums = parseSums(readText('SHA256SUMS') ?? '')
      if (sums.size === 0) return 'SHA256SUMS is empty or unparseable'
      for (const [path, digest] of sums) {
        const file = join(componentDir, path)
        if (!existsSync(file)) return `SHA256SUMS lists a missing file: ${path}`
        const actual = sha256(file)
        if (actual !== digest) return `integrity mismatch for ${path}`
      }
      return null
    }),

    check('integrity: SHA256SUMS covers every required payload file', () => {
      const sums = parseSums(readText('SHA256SUMS') ?? '')
      const required = ['bin/directioner', 'bin/tree-sitter.wasm']
      const missing = required.filter((p) => !sums.has(p))
      return missing.length === 0 ? null : `not covered by SHA256SUMS: ${missing.join(', ')}`
    }),

    check('binary: is a native Linux executable', () => {
      const format = detectBinaryFormat(readFileSync(join(componentDir, 'bin/directioner')))
      return format && format.startsWith('elf:')
        ? null
        : `binary is not an ELF executable (detected: ${format ?? 'unknown'})`
    }),

    check('binary: size is reasonable', () => {
      const { size } = statSync(join(componentDir, 'bin/directioner'))
      if (size < MIN_BINARY_BYTES) return `binary is suspiciously small (${size} bytes)`
      if (size > MAX_BINARY_BYTES) return `binary is suspiciously large (${size} bytes)`
      return null
    }),

    check('component: no unexpected executable files', () => {
      // Only the declared entrypoint may carry the executable bit.
      const out = spawnSync('find', [componentDir, '-type', 'f', '-perm', '-u+x'], {
        encoding: 'utf8',
      }).stdout
      const executables = out
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((abs) => abs.slice(componentDir.length + 1))
        .filter((rel) => rel !== 'bin/directioner')
      return executables.length === 0
        ? null
        : `unexpected executable(s): ${executables.join(', ')}`
    }),

    check('secrets: no credentials in component files', () => {
      for (const name of ['manifest.json', 'NOTICE']) {
        const text = readText(name)
        if (text === null) continue
        const hit = scanForSecrets(text)
        if (hit) return `${name} contains a ${hit}`
      }
      const binaryHit = scanForSecrets(
        readFileSync(join(componentDir, 'bin/directioner')).toString('latin1'),
      )
      return binaryHit ? `bin/directioner contains a ${binaryHit}` : null
    }),

    check('component: NOTICE preserves upstream attribution', () => {
      const notice = readText('NOTICE') ?? ''
      return /Codebuff/i.test(notice)
        ? null
        : 'NOTICE does not retain the upstream Codebuff attribution'
    }),
  ]

  return { ok: checks.every((c) => c.ok), checks }
}

function main() {
  const args = process.argv.slice(2)
  const expectedIndex = args.indexOf('--expected-version')
  const expectedVersion =
    expectedIndex !== -1 && args[expectedIndex + 1] ? args[expectedIndex + 1]! : null
  const versionValueIndex = expectedIndex === -1 ? -1 : expectedIndex + 1
  const positional = args.filter((arg, i) => !arg.startsWith('--') && i !== versionValueIndex)
  const componentDir = positional[0]
    ? resolve(positional[0])
    : join(REPO_ROOT, 'directioner', 'cli', 'release', 'component')

  console.log(`Directioner component validation — ${componentDir}`)
  if (expectedVersion) console.log(`Expected release version: ${expectedVersion}`)
  console.log('')
  const report = validateComponent(componentDir, expectedVersion)
  for (const result of report.checks) {
    console.log(`  ${result.ok ? '✓' : '✗'} ${result.name}: ${result.detail}`)
  }
  console.log('')
  if (report.ok) {
    console.log('All component checks passed.')
    return
  }
  const failures = report.checks.filter((c) => !c.ok).length
  console.log(`Component validation FAILED (${failures} error(s)). Fix the ✗ lines above.`)
  process.exit(1)
}

if (import.meta.main) main()
