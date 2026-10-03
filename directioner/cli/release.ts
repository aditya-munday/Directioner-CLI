#!/usr/bin/env bun

/**
 * Directioner release pipeline.
 *
 * Runs the whole release locally, against this checkout, and stops one step
 * short of publishing:
 *
 *   1. build the BYOK standalone binary     (directioner/cli/build.ts)
 *   2. assemble the npm package directory   (directioner/cli/package-release.ts)
 *   3. validate the package                 (scripts/validate-release.ts)
 *   4. (optional) smoke-test the binary     (cli/scripts/smoke-binary.ts)
 *
 * Nothing here contacts a vendor origin, triggers a workflow in someone else's
 * repository, or publishes to npm. Publishing is a deliberate, separate act the
 * maintainer performs with `npm publish` on the tarball this produces.
 *
 * Usage:
 *   bun directioner/cli/release.ts <version> [--smoke]
 *
 * Exit code 0 only when every step passes.
 */

import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..')

const args = process.argv.slice(2)
const smoke = args.includes('--smoke')
const version = args.find((arg) => !arg.startsWith('--'))

if (!version) {
  console.error('Usage: bun directioner/cli/release.ts <version> [--smoke]')
  process.exit(1)
}
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`❌ "${version}" is not a valid semver version.`)
  process.exit(1)
}

function run(label: string, command: string, commandArgs: string[]): void {
  console.log(`\n▶ ${label}`)
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  })
  if (result.status !== 0) {
    console.error(`❌ ${label} failed`)
    process.exit(result.status ?? 1)
  }
}

console.log(`Directioner release — v${version}`)

run('Build BYOK standalone binary', 'bun', [
  'directioner/cli/build.ts',
  version,
])
run('Assemble npm package', 'bun', [
  'directioner/cli/package-release.ts',
  version,
])
run('Validate release package', 'bun', [
  'scripts/validate-release.ts',
  '--expected-version',
  version,
])

if (smoke) {
  run('Smoke test binary', 'bun', [
    'cli/scripts/smoke-binary.ts',
    'cli/bin/directioner',
  ])
}

const tarball = join(
  repoRoot,
  'directioner',
  'cli',
  'release',
  'dist',
  `directioner-${version}.tgz`,
)
if (!existsSync(tarball)) {
  console.error(`❌ expected tarball was not produced: ${tarball}`)
  process.exit(1)
}

console.log(`\n✅ Release package ready: ${tarball}`)
console.log('   Nothing was published. To publish deliberately:')
console.log(`     npm publish ${tarball} --access public`)
