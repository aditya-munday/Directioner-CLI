import { describe, expect, test } from 'bun:test'
import {
  ARIA_COMPATIBILITY_MATRIX,
  SUPPORTED_ARIA_CONTRACT_VERSION,
  ariaCompatibilityReport,
  backendStatusForCliState,
  checkCompatibility,
  cliStateForBackendStatus,
  parseAriaEnvelope,
  parseContractVersion,
  type BackendTaskStatus,
  type CliTaskState,
} from '../aria-contract'

describe('aria contract: version compatibility', () => {
  test('equal versions are compatible', () => {
    expect(checkCompatibility('1.0.0', '1.0.0')).toEqual({ compatible: true })
  })

  test('an older minor is compatible (backend understands every field)', () => {
    expect(checkCompatibility('1.0.0', '1.2.0').compatible).toBe(true)
    expect(checkCompatibility('1.1.0', '1.2.0').compatible).toBe(true)
  })

  test('a newer minor is refused rather than silently ignored', () => {
    const result = checkCompatibility('1.3.0', '1.2.0')
    expect(result.compatible).toBe(false)
    expect(result.reason).toContain('newer')
  })

  test('a major mismatch is refused', () => {
    const result = checkCompatibility('2.0.0', '1.9.9')
    expect(result.compatible).toBe(false)
    expect(result.reason).toContain('Major version mismatch')
  })

  test('patch differences never matter', () => {
    expect(checkCompatibility('1.2.1', '1.2.9').compatible).toBe(true)
    expect(checkCompatibility('1.2.9', '1.2.1').compatible).toBe(true)
  })

  test('a malformed version is an explicit error, not a silent pass', () => {
    expect(() => parseContractVersion('1.0')).toThrow(/MAJOR.MINOR.PATCH/)
    expect(() => parseContractVersion('v1.0.0')).toThrow()
    expect(() => checkCompatibility('nonsense', '1.0.0')).toThrow()
  })

  test('the supported version is a valid MAJOR.MINOR.PATCH', () => {
    expect(() => parseContractVersion(SUPPORTED_ARIA_CONTRACT_VERSION)).not.toThrow()
  })
})

describe('aria contract: envelope gate is honest about provenance', () => {
  const valid = {
    contractVersion: '1.0.0',
    requestId: 'req-12345678',
    kind: 'speech.synthesize',
    payload: { text: 'hello' },
  }

  test('a valid envelope parses but is tagged baseline-unverified', () => {
    const result = parseAriaEnvelope(valid)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.provenance).toBe('baseline-unverified')
      expect(result.envelope.kind).toBe('speech.synthesize')
    }
  })

  test('an incompatible contract version is refused', () => {
    const result = parseAriaEnvelope({ ...valid, contractVersion: '2.0.0' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('Major version mismatch')
  })

  test('a short request id is refused', () => {
    expect(parseAriaEnvelope({ ...valid, requestId: 'x' }).ok).toBe(false)
  })

  test('a missing payload is refused', () => {
    const { payload: _drop, ...rest } = valid
    expect(parseAriaEnvelope(rest).ok).toBe(false)
  })

  test('a non-object envelope is refused', () => {
    expect(parseAriaEnvelope(null).ok).toBe(false)
    expect(parseAriaEnvelope('a string').ok).toBe(false)
    expect(parseAriaEnvelope([]).ok).toBe(false)
  })

  test('unknown top-level metadata does not break parsing (forward compat)', () => {
    const result = parseAriaEnvelope({ ...valid, extra: { anything: true } })
    expect(result.ok).toBe(true)
  })

  test('an array payload is refused (payload must be a record)', () => {
    expect(parseAriaEnvelope({ ...valid, payload: [1, 2, 3] }).ok).toBe(false)
  })
})

describe('aria contract: task status mapping', () => {
  const BACKEND: BackendTaskStatus[] = [
    'draft',
    'awaiting_approval',
    'approved',
    'running',
    'succeeded',
    'failed',
    'cancelled',
  ]

  test('every backend status maps to a CLI state (total in that direction)', () => {
    for (const status of BACKEND) {
      const cli = cliStateForBackendStatus(status)
      expect(typeof cli).toBe('string')
    }
  })

  test('terminal backend statuses map to terminal CLI states', () => {
    expect(cliStateForBackendStatus('succeeded')).toBe('completed')
    expect(cliStateForBackendStatus('failed')).toBe('failed')
    expect(cliStateForBackendStatus('cancelled')).toBe('cancelled')
  })

  test('awaiting_approval maps to waiting_for_user, not running', () => {
    expect(cliStateForBackendStatus('awaiting_approval')).toBe('waiting_for_user')
  })

  test('representable CLI states round-trip to a backend status', () => {
    const representable: CliTaskState[] = [
      'created',
      'queued',
      'running',
      'waiting_for_user',
      'waiting_for_provider',
      'cancelled',
      'failed',
      'completed',
    ]
    for (const state of representable) {
      const result = backendStatusForCliState(state)
      expect(result.ok).toBe(true)
    }
  })

  test('client-local CLI states are refused, not coerced', () => {
    for (const state of ['paused', 'cancelling', 'recovering'] as CliTaskState[]) {
      const result = backendStatusForCliState(state)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toContain(state)
    }
  })

  test('a paused task is never silently reported as running', () => {
    const result = backendStatusForCliState('paused')
    expect(result.ok).toBe(false)
  })
})

describe('aria contract: compatibility matrix is complete and honest', () => {
  const REQUIRED_CONCEPTS = [
    'identity (account/user)',
    'device registration',
    'session',
    'task',
    'task status vocabulary',
    'events / streaming',
    'actions',
    'approvals',
    'results / verification',
    'cancellation',
    'reconnection / sync',
    'audit references',
    'wire envelope',
    'content retention',
  ]

  test('covers every concept the brief requires', () => {
    const concepts = ARIA_COMPATIBILITY_MATRIX.map((row) => row.concept)
    for (const required of REQUIRED_CONCEPTS) {
      expect(concepts).toContain(required)
    }
  })

  test('every row carries evidence and a disposition', () => {
    for (const row of ARIA_COMPATIBILITY_MATRIX) {
      expect(row.requiredChange.length).toBeGreaterThan(0)
      expect(row.verification.length).toBeGreaterThan(0)
      expect(['verified-repo', 'baseline-unverified', 'absent']).toContain(
        row.evidence.kind,
      )
    }
  })

  test('verified-repo evidence names a repo and a path', () => {
    for (const row of ARIA_COMPATIBILITY_MATRIX) {
      if (row.evidence.kind === 'verified-repo') {
        expect(row.evidence.repo.length).toBeGreaterThan(0)
        expect(row.evidence.path.length).toBeGreaterThan(0)
      }
    }
  })

  test('the wire envelope is not claimed as verified', () => {
    const row = ARIA_COMPATIBILITY_MATRIX.find((r) => r.concept === 'wire envelope')
    expect(row?.disposition).toBe('BLOCKED_BY_EXTERNAL_DEPENDENCY')
    expect(row?.evidence.kind).toBe('baseline-unverified')
  })

  test('no row claims VERIFIED_IMPLEMENTED for a concept that has no live backend', () => {
    // The backend is not deployed; nothing cross-client can be fully verified.
    const fullyVerified = ARIA_COMPATIBILITY_MATRIX.filter(
      (r) => r.disposition === 'VERIFIED_IMPLEMENTED',
    )
    expect(fullyVerified).toHaveLength(0)
  })

  test('the report separates verified from blocked concepts', () => {
    const report = ariaCompatibilityReport()
    expect(report.verifiedConcepts.length).toBeGreaterThan(0)
    expect(report.blockedConcepts.length).toBeGreaterThan(0)
    expect(report.blockedConcepts).toContain('wire envelope')
    // The two sets never overlap.
    for (const concept of report.verifiedConcepts) {
      expect(report.blockedConcepts).not.toContain(concept)
    }
  })
})
