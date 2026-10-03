#!/usr/bin/env bun

/**
 * Prove the packaged Directioner binary runs with no network reachable.
 *
 * The artifact test wraps the Node launcher in a runtime guard, but the binary
 * it execs is a separate process the guard cannot see. On Linux this script
 * closes that gap: it runs the binary inside a network namespace (`unshare -n`)
 * where there is no route out, and asserts that `--version` and `--doctor`
 * still work. If a startup path needed the network, it would fail here.
 *
 * It degrades gracefully: without `unshare` (or the privilege to create a
 * namespace) it prints a clear SKIP and exits 0, so it never turns an
 * environment limitation into a false failure. In CI on a normal runner it
 * runs for real.
 *
 * Usage:
 *   bun scripts/test-binary-offline.ts <binaryPath> <expectedVersion>
 */

import { spawnSync } from 'child_process'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'path'

const [binaryArg, expectedVersion] = process.argv.slice(2)
if (!binaryArg || !expectedVersion) {
  console.error('Usage: bun scripts/test-binary-offline.ts <binaryPath> <expectedVersion>')
  process.exit(2)
}
const binaryPath = resolve(binaryArg)
if (!existsSync(binaryPath)) {
  console.error(`binary not found: ${binaryPath}`)
  process.exit(2)
}

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0

/** Build the argv for a command run inside a fresh network namespace. */
function namespaceCommand(args: string[]): string[] {
  // `unshare -n` needs CAP_SYS_ADMIN; use passwordless sudo when not root.
  const launcher = isRoot ? [] : ['sudo', '-n']
  return [...launcher, 'unshare', '-n', ...args]
}

function hasNamespaceSupport(): boolean {
  return spawnSync(namespaceCommand(['true'])[0]!, namespaceCommand(['true']).slice(1), {
    encoding: 'utf8',
    timeout: 30_000,
  }).status === 0
}

function runInNamespace(args: string[], env: Record<string, string>) {
  const envArgs = Object.entries(env).flatMap(([k, v]) => [`${k}=${v}`])
  const command = namespaceCommand(['env', ...envArgs, ...args])
  return spawnSync(command[0]!, command.slice(1), { encoding: 'utf8', timeout: 60_000 })
}

if (!hasNamespaceSupport()) {
  console.log('SKIP: cannot create a network namespace here (needs unshare + privilege).')
  console.log('      Offline behavior is still enforced for the launcher by scripts/net-guard.cjs.')
  process.exit(0)
}

const workDir = mkdtempSync(join(tmpdir(), 'directioner-netns-'))
let failures = 0
function check(label: string, condition: boolean, detail = ''): void {
  if (condition) console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

try {
  console.log(`Binary offline check (network namespace) — ${binaryPath}\n`)
  // Copy into a writable, executable location; the source may be read-only.
  const localBinary = join(workDir, 'directioner')
  copyFileSync(binaryPath, localBinary)

  const env = {
    HOME: workDir,
    DIRECTIONER_CONFIG_DIR: join(workDir, 'config'),
    DIRECTIONER_CACHE_DIR: join(workDir, 'cache'),
    NO_COLOR: '1',
  }

  const version = runInNamespace([localBinary, '--version'], env)
  check('--version exits 0 offline', version.status === 0, `exit ${version.status}`)
  check(
    '--version reports the expected version offline',
    (version.stdout ?? '').includes(expectedVersion),
    (version.stdout ?? '').trim(),
  )

  const doctor = runInNamespace([localBinary, '--doctor'], env)
  const doctorOut = `${doctor.stdout ?? ''}${doctor.stderr ?? ''}`
  // No config yet: the report should say so, and must not crash from a failed
  // connection attempt.
  check(
    '--doctor produces its BYOK report offline',
    /no provider config|configure/i.test(doctorOut),
    doctorOut.split('\n').find((l) => l.includes('config'))?.trim() ?? '',
  )
  check(
    '--doctor does not report a network/connection error',
    !/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|getaddrinfo|socket hang up/i.test(doctorOut),
  )

  console.log('')
  if (failures > 0) {
    console.error(`Binary offline check FAILED (${failures} check(s)).`)
    process.exit(1)
  }
  console.log('✅ Binary runs with no network reachable.')
} finally {
  // Files written by the namespace run are root-owned; clean those up first,
  // then remove what we still can. Cleanup must never mask a check failure.
  if (!isRoot) spawnSync('sudo', ['-n', 'rm', '-rf', workDir])
  try {
    rmSync(workDir, { recursive: true, force: true })
  } catch {
    // Best effort: a leftover temp dir is not a test failure.
  }
}
