#!/usr/bin/env bun

/**
 * Prove a built Directioner-CLI OS component works when it is moved out of the
 * repository and run from an unrelated working directory — the way an OS image
 * would run it.
 *
 * What this establishes:
 *   - the executable runs without the development repository present;
 *   - `--version` reports the component version;
 *   - `--smoke-tree-sitter` boots the wasm through Parser.init, proving the
 *     sibling-asset lookup works from the staged `bin/` directory and a foreign
 *     cwd;
 *   - tampering with a payload file is rejected by the component validator.
 *
 * It explicitly does NOT claim the component is installed in a working OS
 * image; it stages a copy in a temp directory only.
 *
 * Usage:
 *   bun scripts/test-component-runtime.ts <componentDir> <expectedVersion>
 */

import { spawnSync } from 'child_process'
import { cpSync, mkdtempSync, rmSync, appendFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

import { validateComponent } from './validate-component'

const [componentArg, expectedVersion] = process.argv.slice(2)
if (!componentArg || !expectedVersion) {
  console.error('Usage: bun scripts/test-component-runtime.ts <componentDir> <expectedVersion>')
  process.exit(2)
}
const componentDir = resolve(componentArg)
if (!existsSync(join(componentDir, 'bin', 'directioner'))) {
  console.error(`component binary not found under ${componentDir}/bin/directioner`)
  process.exit(2)
}

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`  ✓ ${label}`)
  } else {
    failures++
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const stage = mkdtempSync(join(tmpdir(), 'directioner-component-'))
try {
  const staged = join(stage, 'directioner-cli-component')
  cpSync(componentDir, staged, { recursive: true })

  const bin = join(staged, 'bin', 'directioner')
  // Isolated HOME so nothing reads the developer's config; cwd is the temp
  // staging root, deliberately outside the repository.
  const env = { ...process.env, HOME: stage, NO_COLOR: '1' }
  const run = (args: string[]) =>
    spawnSync(bin, args, { cwd: stage, encoding: 'utf8', timeout: 60_000, env })

  const versionRun = run(['--version'])
  check(
    '--version runs from a foreign cwd without the repository',
    versionRun.status === 0 && versionRun.stdout.includes(expectedVersion),
    `status=${versionRun.status} stdout=${JSON.stringify(versionRun.stdout?.trim())}`,
  )

  const smokeRun = run(['--smoke-tree-sitter'])
  check(
    '--smoke-tree-sitter boots the wasm from the sibling asset',
    smokeRun.status === 0 && smokeRun.stdout.includes('tree-sitter smoke ok'),
    `status=${smokeRun.status} stdout=${JSON.stringify(smokeRun.stdout?.trim())}`,
  )

  // Independent of the runtime run: the validator must accept the staged copy…
  check('staged component passes validation', validateComponent(staged, expectedVersion).ok)

  // …and reject it once a payload file is tampered with.
  appendFileSync(join(staged, 'bin', 'tree-sitter.wasm'), 'tamper')
  const report = validateComponent(staged, expectedVersion)
  check(
    'tampered payload is rejected (integrity)',
    !report.ok &&
      report.checks.some((c) => !c.ok && /integrity/i.test(c.name)),
    report.checks.filter((c) => !c.ok).map((c) => c.name).join(', '),
  )
} finally {
  rmSync(stage, { recursive: true, force: true })
}

console.log('')
if (failures > 0) {
  console.error(`Component runtime test FAILED (${failures} check(s)).`)
  process.exit(1)
}
console.log('✅ Component runs correctly when staged out of the repository.')
