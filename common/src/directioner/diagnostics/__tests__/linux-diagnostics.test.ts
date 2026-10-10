import { describe, expect, test } from 'bun:test'

import {
  diagnoseBootState,
  diagnoseDriverBinding,
  diagnoseHardware,
  diagnoseKernelArch,
  diagnoseKernelLog,
  diagnoseKernelModules,
  diagnoseKernelParameter,
  diagnoseKernelRelease,
  diagnoseModuleInfo,
  diagnosePackageInfo,
  diagnoseServiceStatus,
  isValidPackageName,
  isValidSubject,
} from '../linux'
import { redactDiagnosticText, REDACTED } from '../redaction'

import type {
  DiagnosticEnvironment,
  DirOutcome,
  ReadOutcome,
  RunOutcome,
  RunSpec,
} from '../types'

// ---------------------------------------------------------------------------
// A deterministic, injectable environment. Nothing here touches the system.
// ---------------------------------------------------------------------------

interface FakeOptions {
  platform?: string
  files?: Record<string, string>
  unreadable?: Set<string>
  links?: Record<string, string>
  dirs?: Record<string, string[]>
  runs?: Record<string, RunOutcome>
}

function makeEnv(
  opts: FakeOptions = {},
): DiagnosticEnvironment & { runSpecs: RunSpec[] } {
  const runSpecs: RunSpec[] = []
  const files = opts.files ?? {}
  const links = opts.links ?? {}
  return {
    platform: opts.platform ?? 'linux',
    arch: 'x64',
    now: () => '2026-10-10T00:00:00.000Z',
    readTextFile: (path, maxBytes): ReadOutcome => {
      if (opts.unreadable?.has(path)) {
        return { ok: false, errorClass: 'permission_denied' }
      }
      if (!(path in files)) return { ok: false, errorClass: 'missing_source' }
      const text = files[path]
      const truncated = text.length > maxBytes
      return {
        ok: true,
        text: truncated ? text.slice(0, maxBytes) : text,
        truncated,
      }
    },
    exists: (path) =>
      path in files || path in (opts.dirs ?? {}) || path in links,
    readLink: (path) => links[path] ?? null,
    readDir: (path): DirOutcome =>
      opts.dirs?.[path]
        ? { ok: true, entries: opts.dirs[path] }
        : { ok: false, errorClass: 'missing_source' },
    run: async (spec): Promise<RunOutcome> => {
      runSpecs.push(spec)
      return (
        opts.runs?.[spec.executable] ?? {
          ok: false,
          errorClass: 'missing_executable',
        }
      )
    },
    runSpecs,
  }
}

const EXE = {
  uname: '/usr/bin/uname',
  lspci: '/usr/bin/lspci',
  systemctl: '/usr/bin/systemctl',
  journalctl: '/usr/bin/journalctl',
  modinfo: '/usr/sbin/modinfo',
}

function okRun(stdout: string, stderr = '', truncated = false): RunOutcome {
  return { ok: true, status: 0, stdout, stderr, truncated }
}

const HOSTILE = [
  '"; rm -rf / #',
  'foo; bar',
  'a$(whoami)',
  '`id`',
  '../../etc/passwd',
  'name with spaces',
  'a\nb',
  '',
  '-flag',
  '日本語',
  'a'.repeat(200),
]

// ---------------------------------------------------------------------------

describe('evidence discipline: never invent data', () => {
  test('non-Linux platform yields unavailable, not an empty-but-ok reading', async () => {
    const env = makeEnv({ platform: 'darwin', files: { '/proc/modules': 'x' } })
    const result = await diagnoseKernelModules(env)
    expect(result.status).toBe('unavailable')
    expect(result.data).toBeNull()
    expect(result.errorClass).toBe('unsupported')
    expect(result.limitations.length).toBeGreaterThan(0)
  })

  test('missing /proc/modules is unavailable, never "no modules loaded"', async () => {
    const env = makeEnv()
    const result = await diagnoseKernelModules(env)
    expect(result.status).toBe('unavailable')
    expect(result.data).toBeNull()
    expect(result.findings).toEqual([])
  })

  test('unreadable /proc/modules reports permission denial explicitly', async () => {
    const env = makeEnv({ unreadable: new Set(['/proc/modules']) })
    const result = await diagnoseKernelModules(env)
    expect(result.status).toBe('denied')
    expect(result.errorClass).toBe('permission_denied')
  })

  test('missing systemctl is unavailable, never "no failed units"', async () => {
    const env = makeEnv()
    const result = await diagnoseBootState(env)
    expect(result.status).toBe('unavailable')
    expect(result.errorClass).toBe('missing_executable')
    expect(result.data).toBeNull()
  })

  test('kernel release source is the allowlisted uname path', async () => {
    const env = makeEnv({
      runs: { [EXE.uname]: okRun('Linux 6.8.0-45-generic x86_64') },
    })
    const result = await diagnoseKernelRelease(env)
    expect(result.status).toBe('ok')
    expect(result.data?.release).toBe('6.8.0-45-generic')
    expect(result.source.source).toBe('/usr/bin/uname')
    expect(result.source.kind).toBe('executable')
    expect(env.runSpecs[0].executable).toBe('/usr/bin/uname')
    expect(env.runSpecs[0].args).toEqual(['-srm'])
  })
})

describe('subject validation: hostile input never reaches an argument', () => {
  test('module names with metacharacters are refused with validation_failed', async () => {
    for (const name of HOSTILE) {
      const env = makeEnv()
      const result = await diagnoseModuleInfo(env, name)
      expect(result.status).toBe('error')
      expect(result.errorClass).toBe('validation_failed')
      expect(env.runSpecs.length).toBe(0)
    }
  })

  test('service unit names with metacharacters are refused without running systemctl', async () => {
    for (const unit of HOSTILE) {
      const env = makeEnv({ files: { '/usr/bin/systemctl': 'x' } })
      const result = await diagnoseServiceStatus(env, unit)
      expect(result.errorClass).toBe('validation_failed')
      expect(env.runSpecs.length).toBe(0)
    }
  })

  test('kernel parameter traversal is refused', async () => {
    for (const p of ['ev il', '..', 'a..b', 'a/b', 'net.ipv4./forward', '$(x)']) {
      const env = makeEnv()
      const result = await diagnoseKernelParameter(env, p)
      expect(result.errorClass).toBe('validation_failed')
    }
  })

  test('a legitimate parameter maps to its /proc/sys path', async () => {
    const env = makeEnv({ files: { '/proc/sys/net/ipv4/ip_forward': '1\n' } })
    const result = await diagnoseKernelParameter(env, 'net.ipv4.ip_forward')
    expect(result.status).toBe('ok')
    expect(result.data?.value).toBe('1')
    expect(result.source.source).toBe('/proc/sys')
  })

  test('isValidSubject accepts real atoms, rejects separators', () => {
    expect(isValidSubject('nvme')).toBe(true)
    expect(isValidSubject('0000:00:1f.6')).toBe(true)
    expect(isValidSubject('foo@bar')).toBe(true)
    expect(isValidSubject('foo/bar')).toBe(false)
    expect(isValidSubject('foo bar')).toBe(false)
    expect(isValidSubject('')).toBe(false)
  })

  test('isValidPackageName allows Debian version chars but not paths', () => {
    expect(isValidPackageName('libc6-dev')).toBe(true)
    expect(isValidPackageName('pkg+extra~rc1')).toBe(true)
    expect(isValidPackageName('a/b')).toBe(false)
    expect(isValidPackageName('a b')).toBe(false)
  })
})

describe('missing executables and degraded environments', () => {
  test('lspci absent -> hardware report unavailable with clear class', async () => {
    const env = makeEnv()
    const result = await diagnoseHardware(env, 'pci')
    expect(result.status).toBe('unavailable')
    expect(result.errorClass).toBe('missing_executable')
    expect(result.data).toBeNull()
  })

  test('journalctl absent -> kernel log unavailable, no fabricated lines', async () => {
    const env = makeEnv()
    const result = await diagnoseKernelLog(env)
    expect(result.status).toBe('unavailable')
    expect(result.errorClass).toBe('missing_executable')
    expect(result.data).toBeNull()
  })

  test('no package manager -> unavailable rather than a guess', async () => {
    const env = makeEnv()
    const result = await diagnosePackageInfo(env, 'bash')
    expect(result.status).toBe('unavailable')
    expect(result.errorClass).toBe('unsupported')
  })

  test('malformed uname output is malformed_output, not a partial reading', async () => {
    const env = makeEnv({ runs: { [EXE.uname]: okRun('') } })
    const result = await diagnoseKernelRelease(env)
    expect(result.status).toBe('error')
    expect(result.errorClass).toBe('malformed_output')
    expect(result.data).toBeNull()
  })
})

describe('timeouts, cancellation, truncation', () => {
  test('a timeout is surfaced as timeout, not as an empty success', async () => {
    const env = makeEnv({
      files: { '/usr/bin/systemctl': 'x' },
      runs: { [EXE.systemctl]: { ok: false, errorClass: 'timeout' } },
    })
    const result = await diagnoseBootState(env)
    expect(result.status).toBe('timeout')
    expect(result.errorClass).toBe('timeout')
  })

  test('cancellation is surfaced as cancelled', async () => {
    const env = makeEnv({
      files: { '/usr/bin/journalctl': 'x' },
      runs: { [EXE.journalctl]: { ok: false, errorClass: 'cancelled' } },
    })
    const result = await diagnoseKernelLog(env)
    expect(result.status).toBe('cancelled')
    expect(result.errorClass).toBe('cancelled')
  })

  test('large kernel log output is truncated and flagged', async () => {
    const env = makeEnv({
      files: { '/usr/bin/journalctl': 'x' },
      runs: { [EXE.journalctl]: okRun('line\n'.repeat(1000), '', true) },
    })
    const result = await diagnoseKernelLog(env)
    expect(result.status).toBe('ok')
    expect(result.data?.truncated).toBe(true)
    expect(result.warnings.some((w) => /truncat/i.test(w))).toBe(true)
  })

  test('truncated /proc/modules is flagged in warnings', async () => {
    const env = makeEnv({ files: { '/proc/modules': 'm '.repeat(200_000) } })
    const result = await diagnoseKernelModules(env)
    expect(result.status).toBe('ok')
    expect(result.warnings.some((w) => /truncat/i.test(w))).toBe(true)
  })
})

describe('device and driver diagnostics', () => {
  test('an unbound device reports driver.unbound, not a fabricated driver', async () => {
    const env = makeEnv({ dirs: { '/sys/bus/pci/devices/0000:00:1f.6': [] } })
    const result = await diagnoseDriverBinding(env, '0000:00:1f.6')
    expect(result.status).toBe('ok')
    expect(result.data?.driver).toBeNull()
    expect(result.findings[0].code).toBe('driver.unbound')
  })

  test('a bound device reports the driver basename from the symlink', async () => {
    const env = makeEnv({
      dirs: { '/sys/bus/pci/devices/0000:00:1f.6': [] },
      links: {
        '/sys/bus/pci/devices/0000:00:1f.6/driver':
          '../../../bus/pci/drivers/e1000e',
      },
    })
    const result = await diagnoseDriverBinding(env, '0000:00:1f.6')
    expect(result.data?.driver).toBe('e1000e')
    expect(result.findings[0].code).toBe('driver.bound')
  })

  test('missing sysfs device path is missing_source, not "no driver"', async () => {
    const env = makeEnv()
    const result = await diagnoseDriverBinding(env, '0000:00:1f.6')
    expect(result.status).toBe('unavailable')
    expect(result.errorClass).toBe('missing_source')
  })

  test('hostile device id is refused before any sysfs read', async () => {
    const env = makeEnv()
    const result = await diagnoseDriverBinding(env, '/etc/passwd')
    expect(result.errorClass).toBe('validation_failed')
  })
})

describe('service and module state', () => {
  test('a failed unit is reported with error severity', async () => {
    const env = makeEnv({
      files: { '/usr/bin/systemctl': 'x' },
      runs: {
        [EXE.systemctl]: okRun(
          'LoadState=loaded\nActiveState=failed\nSubState=failed\nUnitFileState=enabled\n',
        ),
      },
    })
    const result = await diagnoseServiceStatus(env, 'nginx.service')
    expect(result.status).toBe('ok')
    expect(result.data?.activeState).toBe('failed')
    expect(result.findings[0].severity).toBe('error')
  })

  test('systemctl output with no LoadState is malformed, not "inactive"', async () => {
    const env = makeEnv({
      files: { '/usr/bin/systemctl': 'x' },
      runs: { [EXE.systemctl]: okRun('') },
    })
    const result = await diagnoseServiceStatus(env, 'nginx.service')
    expect(result.errorClass).toBe('malformed_output')
  })

  test('a not-found unit is missing_source, not a status', async () => {
    const env = makeEnv({
      files: { '/usr/bin/systemctl': 'x' },
      runs: { [EXE.systemctl]: okRun('LoadState=not-found\n') },
    })
    const result = await diagnoseServiceStatus(env, 'ghost.service')
    expect(result.errorClass).toBe('missing_source')
  })

  test('systemctl prose on a non-systemd host is unavailable, never failed units', async () => {
    const prose =
      "System has not been booted with systemd as init system (PID 1). Can't operate.\nFailed to connect to system scope bus via local transport: Host is down\n"
    const env = makeEnv({
      files: { '/usr/bin/systemctl': 'x' },
      runs: { [EXE.systemctl]: okRun(prose) },
    })
    const result = await diagnoseBootState(env)
    expect(result.status).toBe('unavailable')
    expect(result.data).toBeNull()
    expect(result.findings).toEqual([])
  })

  test('systemctl prose is unavailable for a single-unit status too', async () => {
    const env = makeEnv({
      files: { '/usr/bin/systemctl': 'x' },
      runs: {
        [EXE.systemctl]: okRun(
          'Failed to connect to bus: No such file or directory\n',
        ),
      },
    })
    const result = await diagnoseServiceStatus(env, 'nginx.service')
    expect(result.status).toBe('unavailable')
  })

  test('a real failed-unit row is still parsed', async () => {
    const env = makeEnv({
      files: { '/usr/bin/systemctl': 'x' },
      runs: {
        [EXE.systemctl]: okRun(
          'nginx.service loaded failed failed A high performance web server\n',
        ),
      },
    })
    const result = await diagnoseBootState(env)
    expect(result.status).toBe('ok')
    expect(result.data?.failedUnits.map((u) => u.unit)).toEqual(['nginx.service'])
  })

  test('unexpected /proc/modules line shape does not crash or invent modules', async () => {
    const env = makeEnv({
      files: { '/proc/modules': 'garbage\n\nfoo 1234 0 - Live 0x0\n' },
    })
    const result = await diagnoseKernelModules(env)
    expect(result.status).toBe('ok')
    expect(result.data?.modules.map((m) => m.name)).toEqual(['foo'])
  })

  test('module metadata reports license, filename and load state', async () => {
    const env = makeEnv({
      files: { '/proc/modules': 'e1000e 1234 1 - Live 0x0\n' },
      runs: {
        [EXE.modinfo]: okRun(
          'filename: /lib/modules/6.8/kernel/drivers/net/e1000e.ko\nlicense: GPL\ndescription: Intel PRO/1000\n',
        ),
      },
    })
    const result = await diagnoseModuleInfo(env, 'e1000e')
    expect(result.data?.loaded).toBe(true)
    expect(result.data?.license).toBe('GPL')
    expect(result.data?.filename).toContain('e1000e.ko')
  })
})

describe('redaction', () => {
  test('redacts provider tokens, assignments, and private keys', () => {
    const input = [
      'token=ghp_' + 'a'.repeat(36),
      'API_KEY: sk-' + 'b'.repeat(30),
      'POSTGRES_PASSWORD=supersecretvalue',
      'Authorization: Bearer abcdefghijklmnopqrstuvwx',
      'postgres://user:hunter2@db.internal/app',
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----',
    ].join('\n')
    const { text, records } = redactDiagnosticText(input)
    expect(text).not.toContain('supersecretvalue')
    expect(text).not.toContain('hunter2')
    expect(text).not.toContain('MIIEow')
    expect(text).toContain(REDACTED)
    expect(records.map((r) => r.kind)).toContain('private_key')
    expect(records.map((r) => r.kind)).toContain('secret_assignment')
  })

  test('kernel log redaction is flagged in warnings', async () => {
    const env = makeEnv({
      files: { '/usr/bin/journalctl': 'x' },
      runs: { [EXE.journalctl]: okRun('secret=ghp_' + 'c'.repeat(36) + '\n') },
    })
    const result = await diagnoseKernelLog(env)
    expect(result.data?.redacted).toBe(true)
    expect(result.data?.lines.join('\n')).not.toContain('ghp_')
    expect(result.warnings.some((w) => /redact/i.test(w))).toBe(true)
  })

  test('redaction is deterministic', () => {
    const input = 'A_TOKEN=abcdefgh1234'
    expect(redactDiagnosticText(input).text).toBe(
      redactDiagnosticText(input).text,
    )
  })
})

describe('architectural invariants', () => {
  test('every result carries provenance and an injected timestamp', async () => {
    const env = makeEnv({ runs: { [EXE.uname]: okRun('Linux 6.8 x86_64') } })
    const results = await Promise.all([
      diagnoseKernelRelease(env),
      diagnoseKernelArch(env),
      diagnoseKernelModules(env),
      diagnoseBootState(env),
      diagnoseKernelLog(env),
      diagnosePackageInfo(env, 'bash'),
    ])
    for (const r of results) {
      expect(typeof r.source.source).toBe('string')
      expect(r.source.source.length).toBeGreaterThan(0)
      expect(r.observedAt).toBe('2026-10-10T00:00:00.000Z')
      expect(Array.isArray(r.limitations)).toBe(true)
    }
  })

  test('no run is ever given a shell-shaped executable or huge argument', async () => {
    const env = makeEnv({
      files: { '/usr/bin/systemctl': 'x' },
      runs: { [EXE.systemctl]: okRun('') },
    })
    await diagnoseBootState(env)
    for (const spec of env.runSpecs) {
      expect(spec.executable.startsWith('/usr/bin/')).toBe(true)
      for (const arg of spec.args) {
        expect(typeof arg).toBe('string')
        expect(arg.length).toBeLessThan(256)
      }
    }
  })
})
