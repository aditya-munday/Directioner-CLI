#!/usr/bin/env bun

/**
 * Install and exercise a Directioner release tarball in a clean environment.
 *
 * This is the step that tests the artifact CI just produced — not the source
 * tree, not a globally installed copy, not a stale binary. It:
 *
 *   1. installs the .tgz into a throwaway npm prefix with a throwaway HOME;
 *   2. runs the installed wrapper under the runtime network guard and proves
 *      `--version`, `--doctor` (no config) and `--check-update` make ZERO
 *      outbound connections;
 *   3. asserts the wrapper installed the packaged binary and its wasm sibling
 *      into the cache, byte-for-byte;
 *   4. asserts there is no login flow and the BYOK guidance is present;
 *   5. exercises the configured-provider path against a loopback server only,
 *      proving `--doctor` names the key variable and never prints its value.
 *
 * Usage:
 *   bun scripts/test-release-artifact.ts <package.tgz> <expected-version>
 *
 * Exit code 0 only when every assertion holds.
 */

import { spawnSync, execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { createServer } from 'http'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'path'

const [tarballArg, expectedVersion] = process.argv.slice(2)
if (!tarballArg || !expectedVersion) {
  console.error('Usage: bun scripts/test-release-artifact.ts <package.tgz> <expected-version>')
  process.exit(2)
}

const tarball = resolve(tarballArg)
const netGuard = join(resolve(import.meta.dir, '..'), 'scripts', 'net-guard.cjs')
if (!existsSync(tarball)) fail(`tarball not found: ${tarball}`)

const nodeBinary = process.env.NODE_BINARY || 'node'
const root = mkdtempSync(join(tmpdir(), 'directioner-artifact-'))
const prefix = join(root, 'prefix')
const home = join(root, 'home')
const npmCache = join(root, 'npm-cache')
const cliCache = join(root, 'cli-cache')
const configDir = join(root, 'config')
const netLog = join(root, 'net-guard.log')

let failures = 0
function fail(message: string): never {
  console.error(`❌ ${message}`)
  process.exit(1)
}
function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`)
  } else {
    failures++
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/** Run a command with the clean HOME/cache env and the network guard. */
function runGuarded(args: string[], extraEnv: Record<string, string> = {}) {
  rmSync(netLog, { force: true })
  const result = spawnSync(nodeBinary, ['--require', netGuard, entrypoint(), ...args], {
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env,
      HOME: home,
      XDG_CACHE_HOME: join(home, '.cache'),
      XDG_CONFIG_HOME: join(home, '.config'),
      DIRECTIONER_CACHE_DIR: cliCache,
      DIRECTIONER_CONFIG_DIR: configDir,
      NET_GUARD_LOG: netLog,
      NO_COLOR: '1',
      ...extraEnv,
    },
  })
  const attempts = existsSync(netLog) ? readFileSync(netLog, 'utf8').trim() : ''
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    attempts,
  }
}

let installedRoot = ''
function entrypoint(): string {
  return join(installedRoot, 'index.js')
}

try {
  console.log(`Directioner artifact test — ${tarball}`)
  console.log(`Expected version: ${expectedVersion}\n`)

  // --- Install into a clean prefix --------------------------------------
  console.log('Install (clean HOME + prefix):')
  const install = spawnSync(
    'npm',
    [
      'install',
      '--global',
      '--prefix',
      prefix,
      '--cache',
      npmCache,
      '--no-audit',
      '--no-fund',
      '--ignore-scripts',
      tarball,
    ],
    { encoding: 'utf8', timeout: 300_000, env: { ...process.env, HOME: home } },
  )
  if (install.status !== 0) {
    console.error(install.stdout)
    console.error(install.stderr)
    fail('npm install of the artifact failed')
  }
  installedRoot = join(
    execFileSync('npm', ['root', '--global', '--prefix', prefix], {
      encoding: 'utf8',
    }).trim(),
    'directioner',
  )
  check('installed package directory exists', existsSync(entrypoint()), installedRoot)
  const installedManifest = JSON.parse(readFileSync(join(installedRoot, 'package.json'), 'utf8'))
  check('installed package name', installedManifest.name === 'directioner', installedManifest.name)
  check(
    'installed package version',
    installedManifest.version === expectedVersion,
    installedManifest.version,
  )
  check(
    'installed package carries the binary',
    existsSync(join(installedRoot, 'directioner')),
  )
  check(
    'installed package carries tree-sitter.wasm',
    existsSync(join(installedRoot, 'tree-sitter.wasm')),
  )

  // --- Offline guarantee -------------------------------------------------
  console.log('\nOffline guarantee (runtime network guard):')
  const version = runGuarded(['--version'])
  check('--version exits 0', version.status === 0, `exit ${version.status}`)
  check(
    '--version reports the expected version',
    version.stdout.includes(expectedVersion),
    version.stdout.trim(),
  )
  check('--version made no network attempt', version.attempts === '', version.attempts)

  const doctor = runGuarded(['--doctor'])
  check('--doctor ran without a crash', doctor.status !== null)
  check('--doctor made no network attempt (no config)', doctor.attempts === '', doctor.attempts)
  check(
    '--doctor explains the BYOK setup when no config exists',
    /no provider config|configure/i.test(doctor.stdout + doctor.stderr),
  )

  const update = runGuarded(['--check-update'])
  check('--check-update exits 0', update.status === 0, `exit ${update.status}`)
  check(
    '--check-update points at npm, not an update endpoint',
    /npm install -g directioner/.test(update.stdout),
  )
  check('--check-update made no network attempt', update.attempts === '', update.attempts)

  // --- No login flow -----------------------------------------------------
  console.log('\nNo login flow:')
  const help = runGuarded(['--help'])
  const helpText = help.stdout + help.stderr
  check('--help does not offer a login command', !/\/login\b|press enter to login/i.test(helpText))
  check('--help does not mention a Beyonders account', !/beyonders\.com/i.test(helpText))
  check('--help made no network attempt', help.attempts === '', help.attempts)

  // --- The wrapper launched the packaged binary --------------------------
  console.log('\nWrapper -> packaged binary:')
  const packagedSha = sha256(join(installedRoot, 'directioner'))
  check('cache binary installed', existsSync(join(cliCache, 'directioner')))
  check(
    'cache binary is byte-identical to the packaged binary',
    existsSync(join(cliCache, 'directioner')) &&
      sha256(join(cliCache, 'directioner')) === packagedSha,
    packagedSha.slice(0, 12),
  )
  check(
    'cache holds the wasm resource',
    existsSync(join(cliCache, 'tree-sitter.wasm')),
  )
  const record = existsSync(join(cliCache, 'installed.json'))
    ? JSON.parse(readFileSync(join(cliCache, 'installed.json'), 'utf8'))
    : null
  check(
    'cache record names the release version',
    record?.version === expectedVersion,
    String(record?.version),
  )

  // --- Configured provider path (loopback only) --------------------------
  console.log('\nConfigured provider path (loopback only, no external network):')
  const SECRET = 'sk-artifact-test-value-do-not-leak'
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{}')
  })
  const port = await new Promise<number>((resolvePort) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolvePort(typeof address === 'object' && address ? address.port : 0)
    })
  })
  try {
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify(
        {
          version: 1,
          providers: [
            {
              id: 'heital',
              model: 'gemini-artifact-test',
              apiKeyEnvVar: 'ARTIFACT_TEST_KEY',
              baseUrl: `http://127.0.0.1:${port}/v1`,
            },
          ],
          active: 'heital',
        },
        null,
        2,
      ),
    )
    const configured = runGuarded(['--doctor'], { ARTIFACT_TEST_KEY: SECRET })
    const output = configured.stdout + configured.stderr
    check('--doctor names the key environment variable', output.includes('ARTIFACT_TEST_KEY'))
    check('--doctor never prints the key value', !output.includes(SECRET))
    check('--doctor reports the configured model', output.includes('gemini-artifact-test'))
  } finally {
    server.close()
  }

  console.log('')
  if (failures > 0) {
    console.error(`Artifact test FAILED (${failures} check(s)).`)
    process.exit(1)
  }
  console.log('✅ Artifact test passed.')
} finally {
  rmSync(root, { recursive: true, force: true })
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}
