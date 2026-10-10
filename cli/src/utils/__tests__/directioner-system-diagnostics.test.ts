import { describe, expect, test } from 'bun:test'

import { runSystemDiagnostics } from '../directioner-system-diagnostics'

import type {
  DiagnosticEnvironment,
  DirOutcome,
  ReadOutcome,
  RunOutcome,
} from '@beyonders/common/directioner/diagnostics'

function makeEnv(overrides: Partial<DiagnosticEnvironment> = {}): DiagnosticEnvironment {
  return {
    platform: 'linux',
    arch: 'x64',
    now: () => '2026-10-10T00:00:00.000Z',
    readTextFile: (path): ReadOutcome =>
      path === '/proc/modules'
        ? { ok: true, text: 'e1000e 1234 0 - Live 0x0\n', truncated: false }
        : { ok: false, errorClass: 'missing_source' },
    exists: (path) => path === '/usr/bin/uname' || path === '/usr/bin/systemctl',
    readLink: () => null,
    readDir: (): DirOutcome => ({ ok: true, entries: [] }),
    run: async (spec): Promise<RunOutcome> => {
      if (spec.executable === '/usr/bin/uname') {
        return {
          ok: true,
          status: 0,
          stdout: spec.args.includes('-srm')
            ? 'Linux 6.8.0-45-generic x86_64\n'
            : 'Linux x86_64\n',
          stderr: '',
          truncated: false,
        }
      }
      if (spec.executable === '/usr/bin/systemctl') {
        return { ok: true, status: 0, stdout: '', stderr: '', truncated: false }
      }
      return { ok: false, errorClass: 'missing_executable' }
    },
    ...overrides,
  }
}

describe('system diagnostics report', () => {
  test('renders real readings with sources and is ok when everything reads', async () => {
    const report = await runSystemDiagnostics({ env: makeEnv() })
    const text = report.lines.join('\n')
    expect(text).toContain('### Directioner system diagnostics')
    expect(text).toContain('### kernel.release')
    expect(text).toContain('source: executable /usr/bin/uname')
    expect(text).toContain('6.8.0-45-generic')
    expect(text).toContain('### kernel.modules')
    // `lspci` is absent by construction, so it is listed as unreadable, not as
    // an empty hardware section.
    expect(text).toContain('Could not read:')
    expect(text).toContain('hardware.pci')
    expect(report.ok).toBe(true)
  })

  test('the report never prints a value for an unreadable probe', async () => {
    const report = await runSystemDiagnostics({
      env: makeEnv({
        readTextFile: (): ReadOutcome => ({
          ok: false,
          errorClass: 'permission_denied',
        }),
      }),
    })
    const text = report.lines.join('\n')
    expect(text).toContain('kernel.modules')
    expect(text).toContain('denied')
    // No fabricated module line.
    expect(text).not.toContain('e1000e')
  })

  test('a malformed reachable source marks the report not-ok', async () => {
    const report = await runSystemDiagnostics({
      env: makeEnv({
        run: async (spec): Promise<RunOutcome> =>
          spec.executable === '/usr/bin/uname'
            ? { ok: true, status: 0, stdout: '', stderr: '', truncated: false }
            : { ok: false, errorClass: 'missing_executable' },
      }),
    })
    expect(report.ok).toBe(false)
    expect(report.unavailable.some((u) => u.id.startsWith('kernel.'))).toBe(true)
  })

  test('non-Linux host degrades honestly', async () => {
    const report = await runSystemDiagnostics({
      env: makeEnv({ platform: 'darwin' }),
    })
    const text = report.lines.join('\n')
    expect(text).toContain('Platform: darwin')
    expect(report.unavailable.length).toBeGreaterThan(0)
  })
})
