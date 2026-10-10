import { describe, expect, test } from 'bun:test'
import {
  ARIA_COMPATIBILITY_MATRIX,
  SUPPORTED_ARIA_CONTRACT_VERSION,
  ariaCompatibilityReport,
  backendStatusForCliState,
  checkAriaContractVersion,
  checkCompatibility,
  cliStateForBackendStatus,
  decodeAriaPcm,
  encodeAriaPcm,
  parseAriaCapabilities,
  parseAriaChatResponse,
  parseAriaError,
  parseAriaSttResponse,
  parseAriaTtsResponse,
  reconstructAriaChatStream,
  reconstructAriaSttStream,
  reconstructAriaTtsStream,
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

  test('the matrix names the speech surface the backend serves', () => {
    const row = ARIA_COMPATIBILITY_MATRIX.find((r) => r.concept.startsWith('speech'))
    expect(row).toBeDefined()
    expect(row?.disposition).toBe('IMPLEMENTED_BUT_PARTIALLY_VERIFIED')
  })
})

describe('aria contract: speech shapes and stream rules', () => {
  // (1,2,3,4) as little-endian i16, base64.
  const PCM_4 = 'AQACAAMABAA='
  // (100,-100,200,-200,300,-300,400,-400) as little-endian i16, base64.
  const PCM_8 = 'ZACc/8gAOP8sAdT+kAFw/g=='

  test('an stt response parses with an optional confidence', () => {
    expect(parseAriaSttResponse({ contract_version: 1, text: 'hi', confidence: 0.9 }).ok).toBe(true)
    expect(parseAriaSttResponse({ contract_version: 1 }).ok).toBe(false)
  })

  test('a tts response parses and requires a valid audio payload', () => {
    const ok = parseAriaTtsResponse({
      contract_version: 1,
      audio: { sample_rate: 16000, channels: 1, samples_le_base64: PCM_8 },
    })
    expect(ok.ok).toBe(true)
    expect(parseAriaTtsResponse({ contract_version: 1 }).ok).toBe(false)
    expect(
      parseAriaTtsResponse({
        contract_version: 1,
        audio: { sample_rate: 16000, channels: 0, samples_le_base64: PCM_8 },
      }).ok,
    ).toBe(false)
  })

  test('the speech parsers refuse the removed fabricated envelope', () => {
    const fabricated = { contractVersion: '1.0.0', requestId: 'x', kind: 'speech.synthesize' }
    expect(parseAriaSttResponse(fabricated).ok).toBe(false)
    expect(parseAriaTtsResponse(fabricated).ok).toBe(false)
  })

  test('little-endian i16 PCM round-trips through encode and decode', () => {
    const samples = new Int16Array([1, 2, 3, 4])
    const payload = encodeAriaPcm(samples, 16000)
    expect(payload.samples_le_base64).toBe(PCM_4)
    const decoded = decodeAriaPcm(payload)
    expect(decoded.ok).toBe(true)
    if (decoded.ok) expect(Array.from(decoded.value)).toEqual([1, 2, 3, 4])
  })

  test('negative samples survive the signed round-trip', () => {
    const samples = new Int16Array([100, -100, 200, -200, 300, -300, 400, -400])
    const payload = encodeAriaPcm(samples, 16000)
    expect(payload.samples_le_base64).toBe(PCM_8)
    const decoded = decodeAriaPcm(payload)
    expect(decoded.ok).toBe(true)
    if (decoded.ok) expect(Array.from(decoded.value)).toEqual(Array.from(samples))
  })

  test('an odd-byte audio payload is refused', () => {
    const decoded = decodeAriaPcm({ sample_rate: 16000, channels: 1, samples_le_base64: 'AQAC' })
    expect(decoded.ok).toBe(false)
  })

  test('malformed base64 is refused rather than throwing', () => {
    // `atob` throws on malformed base64; the parser must surface that as a
    // CheckResult refusal so callers can handle it like any other bad payload.
    const decoded = decodeAriaPcm({
      sample_rate: 16000,
      channels: 1,
      samples_le_base64: 'not base64!!!',
    })
    expect(decoded.ok).toBe(false)
    if (!decoded.ok) expect(decoded.reason).toContain('base64')
  })

  test('an empty audio payload decodes to no samples (terminal TTS frame)', () => {
    // Empty PCM is legal on a synthesis terminal frame.
    const decoded = decodeAriaPcm({ sample_rate: 16000, channels: 1, samples_le_base64: '' })
    expect(decoded.ok).toBe(true)
    if (decoded.ok) expect(decoded.value.length).toBe(0)
  })

  test('recognition stream uses replace semantics up to the final event', () => {
    const events = [
      { contract_version: 1, is_final: false, text: 'hello' },
      { contract_version: 1, is_final: false, text: 'hello world' },
      { contract_version: 1, is_final: true, text: 'hello world' },
    ]
    expect(reconstructAriaSttStream(events)).toEqual({ ok: true, value: 'hello world' })
  })

  test('a recognition stream with no final event is incomplete, not a short transcript', () => {
    const events = [{ contract_version: 1, is_final: false, text: 'partial' }]
    expect(reconstructAriaSttStream(events).ok).toBe(false)
  })

  test('synthesis stream concatenates contiguous chunks and ends on the final frame', () => {
    const events = [
      {
        contract_version: 1,
        sequence: 0,
        is_final: false,
        audio: { sample_rate: 16000, channels: 1, samples_le_base64: PCM_4 },
      },
      {
        contract_version: 1,
        sequence: 1,
        is_final: false,
        audio: { sample_rate: 16000, channels: 1, samples_le_base64: PCM_4 },
      },
      {
        contract_version: 1,
        sequence: 2,
        is_final: true,
        audio: { sample_rate: 16000, channels: 1, samples_le_base64: '' },
      },
    ]
    const result = reconstructAriaTtsStream(events)
    expect(result.ok).toBe(true)
    if (result.ok) expect(Array.from(result.value)).toEqual([1, 2, 3, 4, 1, 2, 3, 4])
  })

  test('an out-of-order synthesis chunk is a contract violation, not silently reordered', () => {
    const events = [
      {
        contract_version: 1,
        sequence: 0,
        is_final: false,
        audio: { sample_rate: 16000, channels: 1, samples_le_base64: PCM_4 },
      },
      {
        contract_version: 1,
        sequence: 2,
        is_final: true,
        audio: { sample_rate: 16000, channels: 1, samples_le_base64: '' },
      },
    ]
    expect(reconstructAriaTtsStream(events).ok).toBe(false)
  })

  test('a truncated synthesis stream is refused, not presented as complete audio', () => {
    const events = [
      {
        contract_version: 1,
        sequence: 0,
        is_final: false,
        audio: { sample_rate: 16000, channels: 1, samples_le_base64: PCM_4 },
      },
    ]
    expect(reconstructAriaTtsStream(events).ok).toBe(false)
  })

  test('a synthesis chunk with malformed base64 is refused, not thrown', () => {
    const events = [
      {
        contract_version: 1,
        sequence: 0,
        is_final: false,
        audio: { sample_rate: 16000, channels: 1, samples_le_base64: 'not base64!!!' },
      },
    ]
    const result = reconstructAriaTtsStream(events)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('base64')
  })

  test('the empty terminal frame terminates the stream and contributes no samples', () => {
    const events = [
      {
        contract_version: 1,
        sequence: 0,
        is_final: false,
        audio: { sample_rate: 16000, channels: 1, samples_le_base64: PCM_4 },
      },
      // The backend's final frame carries no audio; it is a terminator, not a chunk.
      {
        contract_version: 1,
        sequence: 1,
        is_final: true,
        audio: { sample_rate: 16000, channels: 1, samples_le_base64: '' },
      },
    ]
    const result = reconstructAriaTtsStream(events)
    expect(result.ok).toBe(true)
    if (result.ok) expect(Array.from(result.value)).toEqual([1, 2, 3, 4])
  })

  test('an empty non-terminal chunk is refused, not treated as silence', () => {
    const events = [
      {
        contract_version: 1,
        sequence: 0,
        is_final: false,
        audio: { sample_rate: 16000, channels: 1, samples_le_base64: '' },
      },
      {
        contract_version: 1,
        sequence: 1,
        is_final: true,
        audio: { sample_rate: 16000, channels: 1, samples_le_base64: '' },
      },
    ]
    expect(reconstructAriaTtsStream(events, 1, { rejectEmptyNonTerminal: true }).ok).toBe(false)
  })

  test('events after the terminal frame cannot extend the audio', () => {
    const events = [
      {
        contract_version: 1,
        sequence: 0,
        is_final: false,
        audio: { sample_rate: 16000, channels: 1, samples_le_base64: PCM_4 },
      },
      {
        contract_version: 1,
        sequence: 1,
        is_final: true,
        audio: { sample_rate: 16000, channels: 1, samples_le_base64: '' },
      },
      // A producer that keeps emitting past its terminal frame must not extend
      // the utterance; the terminal frame is authoritative.
      {
        contract_version: 1,
        sequence: 2,
        is_final: false,
        audio: { sample_rate: 16000, channels: 1, samples_le_base64: PCM_4 },
      },
    ]
    const result = reconstructAriaTtsStream(events)
    expect(result.ok).toBe(true)
    if (result.ok) expect(Array.from(result.value)).toEqual([1, 2, 3, 4])
  })

  test('the speech parsers refuse an unsupported contract version', () => {
    expect(
      parseAriaSttResponse({ contract_version: 2, text: 'hi' }).ok,
    ).toBe(false)
    expect(
      parseAriaTtsResponse({
        contract_version: 2,
        audio: { sample_rate: 16000, channels: 1, samples_le_base64: PCM_8 },
      }).ok,
    ).toBe(false)
  })

  test('the stt stream refuses an unsupported contract version mid-stream', () => {
    const events = [
      { contract_version: 1, is_final: false, text: 'hello' },
      { contract_version: 2, is_final: true, text: 'hello world' },
    ]
    expect(reconstructAriaSttStream(events).ok).toBe(false)
  })
})
