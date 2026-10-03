#!/usr/bin/env bun
/**
 * Directioner Binary Smoke Test
 *
 * Verifies the compiled Directioner binary:
 * 1. Reports a valid semver version
 * 2. Shows Directioner branding (not Beyonders) in --help output
 * 3. Excludes mode flags (--free, --max, --plan) from --help
 * 4. Excludes the hosted `login` command (BYOK has no account)
 * 5. Shows provider setup guidance when nothing is configured
 * 6. Renders the Directioner title screen (ASCII logo) in tmux
 *
 * Prerequisites:
 *   bun directioner/cli/build.ts <version>   # build the binary
 *   brew install tmux                     # for title-screen test
 *
 * Run:
 *   bun test directioner/cli/smoke-test.test.ts
 */

import { execFileSync, execSync, spawn, spawnSync } from 'child_process'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

import { describe, test, expect, afterEach } from 'bun:test'

const REPO_ROOT = path.join(__dirname, '..', '..')
const BINARY_PATH = path.join(REPO_ROOT, 'cli', 'bin', 'directioner')
const TIMEOUT_MS = 20_000

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripAnsiCodes(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
}

function isTmuxAvailable(): boolean {
  if (process.env.CI === 'true' || process.env.CI === '1') return false
  try {
    execSync(
      'which tmux && tmux new-session -d -s __directioner_tmux_check__ && tmux kill-session -t __directioner_tmux_check__',
      { stdio: 'pipe', timeout: 5000 },
    )
    return true
  } catch {
    return false
  }
}

function tmux(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('tmux', args, { stdio: 'pipe' })
    let stdout = ''
    let stderr = ''
    proc.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    proc.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`tmux failed (exit ${code}): ${stderr}`))
    })
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function runBinary(args: string[]): string {
  return execFileSync(BINARY_PATH, args, {
    encoding: 'utf-8',
    timeout: 10_000,
    env: { ...process.env, NO_COLOR: '1' },
  })
}

const binaryExists = existsSync(BINARY_PATH)
const tmuxAvailable = isTmuxAvailable()

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(!binaryExists)('Directioner Binary Smoke Tests', () => {
  test(
    '--version outputs a valid semver version',
    () => {
      const output = stripAnsiCodes(runBinary(['--version'])).trim()
      // The binary may print env info before the version; grab the last line
      const lastLine =
        output
          .split('\n')
          .filter((l) => l.trim())
          .pop() ?? ''
      expect(lastLine.trim()).toMatch(/^\d+\.\d+\.\d+/)
    },
    TIMEOUT_MS,
  )

  test(
    '--help shows Directioner branding',
    () => {
      const output = stripAnsiCodes(runBinary(['--help']))

      // CLI name is "directioner"
      expect(output).toContain('Usage: directioner')
      // Description names the BYOK contract: the user's own provider.
      expect(output).toContain('terminal coding agent on the provider you configure')
      // Must NOT contain the Beyonders CLI name in the usage line
      expect(output).not.toContain('Usage: beyonders')
    },
    TIMEOUT_MS,
  )

  test(
    '--help excludes mode flags (Directioner is free-only)',
    () => {
      const output = stripAnsiCodes(runBinary(['--help']))

      // Mode flags should not be present in Directioner
      expect(output).not.toMatch(/--free\b/)
      expect(output).not.toMatch(/--max\b/)
      expect(output).not.toMatch(/--plan\b/)
      expect(output).not.toMatch(/--lite\b/)
    },
    TIMEOUT_MS,
  )

  test(
    'has no login command (BYOK needs no account)',
    () => {
      const output = stripAnsiCodes(runBinary(['--help']))

      // Directioner's provider config *is* its inference source, so there is no
      // account to sign in to. `--help` must not advertise a login command.
      expect(output).not.toContain('login')
      // The provider selector replaces it.
      expect(output).toContain('--provider')
    },
    TIMEOUT_MS,
  )

  test(
    'shows provider setup guidance when no provider is configured',
    () => {
      // Point the config lookup at an empty directory so the run cannot pick up
      // a real profile, then start with no argument. The first-run path must
      // explain how to configure a provider rather than demanding a login.
      const emptyConfigDir = mkdtempSync(
        path.join(tmpdir(), 'directioner-smoke-config-'),
      )
      try {
        const result = spawnSync(BINARY_PATH, [], {
          encoding: 'utf-8',
          timeout: 10_000,
          env: {
            ...process.env,
            DIRECTIONER_CONFIG_DIR: emptyConfigDir,
            HOSTED_CONFIG_DIR: emptyConfigDir,
            NO_COLOR: '1',
          },
        })
        const output = stripAnsiCodes(
          `${result.stdout ?? ''}${result.stderr ?? ''}`,
        )

        expect(output).toContain('No provider is configured yet')
        expect(output).toContain('config.json')
        expect(output).toContain('never written to disk')
        expect(output).not.toContain('Press ENTER to login')
      } finally {
        rmSync(emptyConfigDir, { recursive: true, force: true })
      }
    },
    TIMEOUT_MS,
  )

  // -------------------------------------------------------------------------
  // tmux title-screen test
  // -------------------------------------------------------------------------

  describe.skipIf(!tmuxAvailable)('tmux title screen', () => {
    let sessionName = ''

    afterEach(async () => {
      if (sessionName) {
        try {
          await tmux(['kill-session', '-t', sessionName])
        } catch {
          // session may have already exited
        }
        sessionName = ''
      }
    })

    test(
      'displays Directioner ASCII logo on startup',
      async () => {
        sessionName = `directioner-smoke-${Date.now()}`

        // Start the binary in a detached tmux session
        await tmux([
          'new-session',
          '-d',
          '-s',
          sessionName,
          '-x',
          '120',
          '-y',
          '35',
          BINARY_PATH,
        ])

        // Poll until the title screen renders (ASCII art uses block chars)
        let cleanOutput = ''
        for (let attempt = 0; attempt < 20; attempt++) {
          await sleep(500)
          const raw = await tmux(['capture-pane', '-t', sessionName, '-p'])
          cleanOutput = stripAnsiCodes(raw)

          // Block characters from the ASCII logo indicate the title screen rendered
          if (cleanOutput.includes('██')) break
        }

        // Bail with a descriptive error if the title screen never appeared
        if (!cleanOutput.includes('██')) {
          throw new Error(
            `Directioner title screen did not render within 10s. Captured output:\n${cleanOutput}`,
          )
        }

        // Verify it's the DIRECTIONER logo, not BEYONDERS.
        // The Directioner 'F' character's third line starts with the crossbar:
        //   █████╗  ██████╔╝
        // whereas Beyonders 'C' has:
        //   ██║     ██║   ██║
        // We check for the F + R pattern on line 3 of the logo.
        expect(cleanOutput).toContain('█████╗  ██████╔╝')

        // The Beyonders logo's distinctive C+O opening should NOT appear
        expect(cleanOutput).not.toContain('██╔════╝██╔═══██╗')
      },
      TIMEOUT_MS,
    )
  })
})

// Show skip messages so test output is informative
if (!binaryExists) {
  describe('Directioner Binary Required', () => {
    test.skip(
      'Build the binary first: bun directioner/cli/build.ts <version>',
      () => {},
    )
  })
}

if (binaryExists && !tmuxAvailable) {
  describe('tmux Required for Title Screen Test', () => {
    test.skip(
      'Install tmux: brew install tmux (macOS) or apt-get install tmux (Linux)',
      () => {},
    )
  })
}
