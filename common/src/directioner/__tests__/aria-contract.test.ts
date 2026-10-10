import { describe, expect, test } from 'bun:test'
import {
  ARIA_COMPATIBILITY_MATRIX,
  SUPPORTED_ARIA_CONTRACT_VERSION,
  ariaCompatibilityReport,
  backendStatusForCliState,
  checkAriaContractVersion,
  checkCompatibility,
  cliStateForBackendStatus,
  parseAriaCapabilities,
  parseAriaChatResponse,
  parseAriaError,
  reconstructAriaChatStream,
  type BackendTaskStatus,
  type CliTaskState,
} from '../aria-contract'

describe('aria contract: version is the integer 1', () => {
  test('the supported version is the integer 1, not a string', () => {
    expect(SUPPORTED_ARIA_CONTRACT_VERSION).toBe(1)
    expect(typeof SUPPORTED_ARIA_CONTRACT_VERSION).toBe('number')
  })

  test('equal integer versions are compatible', () => {
    expect(checkCompatibility(1, 1)).toEqual({ compatible: true })
  })

  test('a different version is refused rather than downgraded', () => {
    expect(checkCompatibility(2, 1).compatible).toBe(false)
    expect(checkCompatibility(0, 1).compatible).toBe(false)
  })

  test('a non-integer version is refused', () => {
    expect(checkCompatibility(1.1, 1).compatible).toBe(false)
  })

  test('a body missing contract_version is refused', () => {
    expect(checkAriaContractVersion({}).compatible).toBe(false)
    expect(checkAriaContractVersion({ contract_version: '1' }).compatible).toBe(false)
    expect(checkAriaContractVersion({ contract_version: 1 }).compatible).toBe(true)
  })
})

describe('aria contract: real endpoint shapes are accepted', () => {
  test('a capabilities response parses', () => {
    const value = {
      contract_version: 1,
      backend_version: 'directioner-platform-backend/0.1.0',
      stt_languages: ['en-GB'],
      tts_languages: ['en-GB'],
      voices: [{ id: 'v1', name: 'Voice', language: 'en-GB', accent: { tag: 'en-gb' } }],
      streaming_stt: false,
      streaming_chat: true,
      streaming_tts: false,
    }
    const parsed = parseAriaCapabilities(value)
    expect(parsed.ok).toBe(true)
  })

  test('a chat response parses with a nullable route', () => {
    expect(parseAriaChatResponse({ contract_version: 1, text: 'hi', route: null }).ok).toBe(true)
    expect(parseAriaChatResponse({ contract_version: 1, text: 'hi' }).ok).toBe(true)
  })

  test('a flat error body parses', () => {
    expect(
      parseAriaError({ contract_version: 1, code: 'rate_limited', message: 'slow down' }).ok,
    ).toBe(true)
  })
})

describe('aria contract: the removed fabricated envelope is refused', () => {
  // The old baseline spoke {contractVersion:"1.0.0", requestId, kind, payload}.
  // Aria has never spoken it, and the backend removed it. It must not validate.
  const fabricated = {
    contractVersion: '1.0.0',
    requestId: 'aria-00000000-0000-4000-8000-000000000001',
    kind: 'speech.synthesize',
    payload: { text: 'hi' },
  }

  test('capabilities parser refuses it', () => {
    expect(parseAriaCapabilities(fabricated).ok).toBe(false)
  })

  test('chat response parser refuses it', () => {
    expect(parseAriaChatResponse(fabricated).ok).toBe(false)
  })

  test('error parser refuses it', () => {
    expect(parseAriaError(fabricated).ok).toBe(false)
  })
})

describe('aria contract: streaming reconstruction', () => {
  const delta = (text: string) => ({ contract_version: 1, is_final: false, delta: text })
  const final = () => ({ contract_version: 1, is_final: true, delta: '' })

  test('concatenates incremental deltas up to the final event', () => {
    const result = reconstructAriaChatStream([delta('Hello. '), delta('How can I help?'), final()])
    expect(result).toEqual({ ok: true, value: 'Hello. How can I help?' })
  })

  test('a stream with no final event is incomplete, not a short reply', () => {
    const result = reconstructAriaChatStream([delta('partial '), delta('answer')])
    expect(result.ok).toBe(false)
  })

  test('text after the final event is ignored', () => {
    const result = reconstructAriaChatStream([delta('ok'), final(), delta('ignored')])
    expect(result).toEqual({ ok: true, value: 'ok' })
  })

  test('an incompatible event version refuses the whole stream', () => {
    const result = reconstructAriaChatStream([{ contract_version: 2, is_final: true, delta: '' }])
    expect(result.ok).toBe(false)
  })
})

describe('aria contract: task status mapping is total one way and honest the other', () => {
  const backendStatuses: readonly BackendTaskStatus[] = [
    'draft',
    'awaiting_approval',
    'approved',
    'running',
    'succeeded',
    'failed',
    'cancelled',
  ]

  test('every backend status maps to a CLI state', () => {
    for (const status of backendStatuses) {
      expect(typeof cliStateForBackendStatus(status)).toBe('string')
    }
  })

  test('non-representable CLI states are refused, not coerced', () => {
    for (const state of ['paused', 'cancelling', 'recovering'] as CliTaskState[]) {
      const result = backendStatusForCliState(state)
      expect(result.ok).toBe(false)
    }
  })

  test('representable CLI states map back to their backend status', () => {
    expect(backendStatusForCliState('created')).toEqual({ ok: true, status: 'draft' })
    expect(backendStatusForCliState('completed')).toEqual({ ok: true, status: 'succeeded' })
    expect(backendStatusForCliState('waiting_for_user')).toEqual({
      ok: true,
      status: 'awaiting_approval',
    })
  })
})

describe('aria contract: the matrix is complete and honest', () => {
  test('every row names evidence and a disposition', () => {
    for (const row of ARIA_COMPATIBILITY_MATRIX) {
      expect(row.concept.length).toBeGreaterThan(0)
      expect(row.evidence.kind.length).toBeGreaterThan(0)
      expect(row.disposition.length).toBeGreaterThan(0)
    }
  })

  test('the report never claims a blocked concept is implemented', () => {
    const report = ariaCompatibilityReport()
    for (const blocked of report.blockedConcepts) {
      expect(report.verifiedConcepts).not.toContain(blocked)
    }
  })

  test('the report carries the integer contract version', () => {
    expect(ariaCompatibilityReport().contractVersion).toBe(1)
  })

  test('the wire-contract row now cites Aria’s real Rust contract, not a baseline', () => {
    const row = ARIA_COMPATIBILITY_MATRIX.find((r) => r.concept.startsWith('wire contract'))
    expect(row).toBeDefined()
    expect(row?.evidence.kind).toBe('verified-repo')
    if (row?.evidence.kind === 'verified-repo') {
      expect(row.evidence.repo).toBe('aditya-munday/Aria')
      expect(row.evidence.path).toContain('contract.rs')
    }
  })
})
