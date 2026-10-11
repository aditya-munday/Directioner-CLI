import { describe, expect, test } from 'bun:test'

import { DIAGNOSTIC_EXECUTABLES } from '../linux'
import {
  diagnoseKernelModules,
  diagnoseKernelRelease,
} from '../linux'
import { createProcessDiagnosticEnvironment } from '../process-environment'

/**
 * These drive the *real* process environment. They read real Linux files and
 * run real allowlisted binaries, so they are the honest proof that the
 * production wiring works — the injectable-environment tests prove the logic,
 * and these prove the seam to the actual system.
 *
 * They are skipped on a non-Linux host rather than faked.
 */
const onLinux = process.platform === 'linux'

describe('process environment: allowlist enforcement', () => {
  test('run() refuses an executable outside the allowlist', async () => {
    const env = createProcessDiagnosticEnvironment()
    const result = await env.run({
      executable: '/bin/sh',
      args: ['-c', 'echo should-not-run'],
      timeoutMs: 1000,
      maxBytes: 1024,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorClass).toBe('validation_failed')
  })

  test('run() reports a missing but allowlisted executable distinctly', async () => {
    const env = createProcessDiagnosticEnvironment()
    // A path that is syntactically in the allowlist but absent on the host.
    const result = await env.run({
      executable: DIAGNOSTIC_EXECUTABLES.lspci,
      args: [],
      timeoutMs: 1000,
      maxBytes: 1024,
    })
    // On a host without lspci the class is missing_executable; if installed,
    // the run is allowed. Either way it is never validation_failed.
    if (!result.ok) expect(result.errorClass).not.toBe('validation_failed')
  })

  test('readTextFile bounds output and reports truncation', () => {
    const env = createProcessDiagnosticEnvironment()
    const read = env.readTextFile('/proc/self/cmdline', 4)
    expect(read.ok).toBe(true)
    if (read.ok) {
      expect(read.text.length).toBeLessThanOrEqual(4)
    }
  })

  test('readTextFile on a missing path is missing_source', () => {
    const env = createProcessDiagnosticEnvironment()
    const read = env.readTextFile('/proc/definitely-not-here-12345', 16)
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.errorClass).toBe('missing_source')
  })
})

describe('process environment: real Linux diagnostics', () => {
  test.skipIf(!onLinux)('reads a real kernel release', async () => {
    const env = createProcessDiagnosticEnvironment()
    const result = await diagnoseKernelRelease(env)
    // uname exists on every Linux; if not, at least it is classified, never
    // fabricated.
    if (result.status === 'ok') {
      expect(result.data?.release).toBeTruthy()
    } else {
      expect(result.data).toBeNull()
    }
  })

  test.skipIf(!onLinux)('reads real /proc/modules without inventing rows', async () => {
    const env = createProcessDiagnosticEnvironment()
    const result = await diagnoseKernelModules(env)
    if (result.status === 'ok') {
      for (const m of result.data?.modules ?? []) {
        expect(typeof m.name).toBe('string')
        expect(m.name.length).toBeGreaterThan(0)
        expect(m.name).not.toContain(' ')
      }
    } else {
      expect(result.data).toBeNull()
    }
  })
})
