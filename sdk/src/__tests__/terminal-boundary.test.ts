import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { runTerminalCommand } from '../tools/run-terminal-command'
import {
  TERMINAL_ENV_ALLOWLIST,
  assertTerminalEnvHasNoCredentials,
  scrubTerminalEnv,
} from '../tools/terminal-env-policy'
import { resolveTerminalCommandCwd } from '../tools/terminal-boundary'

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-boundary-'))
}

async function run(
  command: string,
  cwd: string,
  env: Record<string, string>,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const output = await runTerminalCommand({
    command,
    process_type: 'SYNC',
    cwd,
    timeout_seconds: 15,
    env,
    // The SDK dispatch passes a COMPLETE scrubbed env, so the host is not
    // merged back in. Reproduce that here or the test would prove nothing.
    inheritHostEnvironment: false,
  })
  const value = output[0].value as {
    stdout?: string
    stderr?: string
    exitCode?: number
  }
  return {
    stdout: value.stdout ?? '',
    stderr: value.stderr ?? '',
    exitCode: value.exitCode ?? null,
  }
}

describe('scrubTerminalEnv', () => {
  test('keeps machine and toolchain variables', () => {
    const env = scrubTerminalEnv({
      PATH: '/usr/bin:/bin',
      HOME: '/home/u',
      LANG: 'en_US.UTF-8',
      CARGO_HOME: '/home/u/.cargo',
      SystemRoot: 'C:\\Windows',
    })
    expect(env.PATH).toBe('/usr/bin:/bin')
    expect(env.HOME).toBe('/home/u')
    expect(env.LANG).toBe('en_US.UTF-8')
    expect(env.CARGO_HOME).toBe('/home/u/.cargo')
    expect(env.SystemRoot).toBe('C:\\Windows')
  })

  test('drops every credential-shaped name', () => {
    const env = scrubTerminalEnv({
      PATH: '/usr/bin',
      OPENROUTER_API_KEY: 'sk-or-xxx',
      OPENAI_API_KEY: 'sk-xxx',
      ANTHROPIC_API_KEY: 'sk-ant-xxx',
      GITHUB_TOKEN: 'ghp_xxx',
      GH_TOKEN: 'ghp_yyy',
      AWS_SECRET_ACCESS_KEY: 'aws',
      AWS_ACCESS_KEY_ID: 'awsid',
      NPM_TOKEN: 'npm_xxx',
      SESSION_API_KEY: 'sess',
      DATABASE_PASSWORD: 'pw',
      MY_PRIVATE_KEY: 'pk',
      OH_LLM_API_KEY_REFRESH_URL: 'https://example',
      LOG_JSON_LEVEL_KEY: 'severity',
    })
    for (const leaked of [
      'OPENROUTER_API_KEY',
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'GITHUB_TOKEN',
      'GH_TOKEN',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_ACCESS_KEY_ID',
      'NPM_TOKEN',
      'SESSION_API_KEY',
      'DATABASE_PASSWORD',
      'MY_PRIVATE_KEY',
      'OH_LLM_API_KEY_REFRESH_URL',
    ]) {
      expect(env[leaked]).toBeUndefined()
    }
    expect(env.PATH).toBe('/usr/bin')
  })

  test('does not carry an arbitrary host variable', () => {
    const env = scrubTerminalEnv({ PATH: '/bin', SOME_RANDOM_HOST_VAR: 'x' })
    expect(env.SOME_RANDOM_HOST_VAR).toBeUndefined()
  })

  test('moves HOME and TMPDIR into the run-private directory', () => {
    const env = scrubTerminalEnv(
      { PATH: '/bin', HOME: '/home/u', TMPDIR: '/tmp' },
      { home: '/run/home', tmp: '/run/tmp' },
    )
    expect(env.HOME).toBe('/run/home')
    expect(env.USERPROFILE).toBe('/run/home')
    expect(env.TMPDIR).toBe('/run/tmp')
    expect(env.TEMP).toBe('/run/tmp')
    expect(env.TMP).toBe('/run/tmp')
  })

  test('the allowlist names no credential-shaped variable', () => {
    expect(() =>
      assertTerminalEnvHasNoCredentials(
        Object.fromEntries(TERMINAL_ENV_ALLOWLIST.map((k) => [k, 'v'])),
      ),
    ).not.toThrow()
  })

  test('the assertion catches a widened allowlist', () => {
    expect(() =>
      assertTerminalEnvHasNoCredentials({ PATH: '/bin', GITHUB_TOKEN: 'x' }),
    ).toThrow(/credential-shaped/)
  })
})

describe('resolveTerminalCommandCwd', () => {
  test('accepts the project root and a nested directory', () => {
    const root = tmpProject()
    fs.mkdirSync(path.join(root, 'sub'), { recursive: true })
    expect(resolveTerminalCommandCwd(root, undefined).allowed).toBe(true)
    expect(resolveTerminalCommandCwd(root, '.').allowed).toBe(true)
    expect(resolveTerminalCommandCwd(root, 'sub').allowed).toBe(true)
  })

  test('refuses a cwd above the project', () => {
    const root = tmpProject()
    const decision = resolveTerminalCommandCwd(root, '..')
    expect(decision.allowed).toBe(false)
  })

  test('refuses an absolute cwd outside the project', () => {
    const root = tmpProject()
    expect(resolveTerminalCommandCwd(root, '/etc').allowed).toBe(false)
    expect(resolveTerminalCommandCwd(root, os.tmpdir()).allowed).toBe(false)
  })

  test('refuses a cwd that is a symlink out of the project', () => {
    const root = tmpProject()
    const outside = tmpProject()
    fs.symlinkSync(outside, path.join(root, 'escape'))
    expect(resolveTerminalCommandCwd(root, 'escape').allowed).toBe(false)
  })

  test('accepts an absolute cwd inside the project', () => {
    const root = tmpProject()
    fs.mkdirSync(path.join(root, 'sub'))
    expect(
      resolveTerminalCommandCwd(root, path.join(root, 'sub')).allowed,
    ).toBe(true)
  })
})

describe('a real command under the scrub', () => {
  test('normal project work still runs', async () => {
    const root = tmpProject()
    const result = await run('echo hello-from-project', root, {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('hello-from-project')
  })

  test('a planted secret is not visible to the command', async () => {
    const root = tmpProject()
    const env = scrubTerminalEnv({
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      SESSION_API_KEY: 'super-secret-value',
      GITHUB_TOKEN: 'ghp_secret',
    })
    const result = await run(
      'env | grep -E "SESSION_API_KEY|GITHUB_TOKEN" || echo NO_SECRETS',
      root,
      env,
    )
    expect(result.stdout).toContain('NO_SECRETS')
    expect(result.stdout).not.toContain('super-secret-value')
    expect(result.stdout).not.toContain('ghp_secret')
  })

  test('an interpreter the model writes cannot read the secret either', async () => {
    const root = tmpProject()
    const env = scrubTerminalEnv({
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      SESSION_API_KEY: 'super-secret-value',
    })
    const result = await run(
      `node -e "console.log(process.env.SESSION_API_KEY ?? 'NO_SECRET')"`,
      root,
      env,
    )
    expect(result.stdout).toContain('NO_SECRET')
    expect(result.stdout).not.toContain('super-secret-value')
  })
})

/**
 * The boundary's LIMITS, pinned so nobody overclaims it.
 *
 * These assert that the scrub is an environment boundary and NOT a filesystem
 * one. If a future change adds an OS sandbox to the default path, these tests
 * are the ones that should start failing — that is the point of writing the
 * limitation down as an executable fact rather than a comment.
 */
describe('documented limits of the environment-only boundary', () => {
  test('a scrubbed command can still read a file outside the project', async () => {
    const root = tmpProject()
    const outside = tmpProject()
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'FILESYSTEM SECRET')
    const result = await run(
      `cat ${path.join(outside, 'secret.txt')}`,
      root,
      { PATH: process.env.PATH ?? '/usr/bin:/bin' },
    )
    // No mount namespace here: the env scrub does not stop this. An OS sandbox
    // (bwrap/sandbox-exec) is the mechanism that would, and it exists only for
    // a sponsored run today.
    expect(result.stdout).toContain('FILESYSTEM SECRET')
  })
})
