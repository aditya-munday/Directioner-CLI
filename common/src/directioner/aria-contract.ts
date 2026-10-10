/**
 * Aria <-> Directioner-CLI compatibility: the verified boundary.
 *
 * =========================================================================
 * CORRECTION (supersedes the earlier revision of this module)
 * =========================================================================
 *
 * An earlier revision concluded that Aria had no wire contract and mirrored the
 * backend's `src/contracts/aria.ts` baseline. That conclusion was wrong for two
 * reasons, and this module corrects both:
 *
 * 1. It inspected only Aria's DEFAULT branch, whose tip is a Python "Stage 0"
 *    voice pipeline (`aria/core/**`). That is a real but different lineage.
 *    Aria's native product lineage is Rust, on `stage-2-native-desktop` and
 *    `feature/phase-4-conversational-ai` (`crates/aria-backend/src/contract.rs`).
 *    There, Aria DOES define a network contract: endpoints under `/v1`,
 *    `contract_version` as the integer `1`, endpoint-specific bodies, a flat
 *    error body, and incremental NDJSON chat streaming.
 *
 * 2. The backend baseline it mirrored (`{contractVersion:"1.0.0", requestId,
 *    kind, payload}`) was itself authored without Aria and was removed from the
 *    backend. Aria has never spoken that shape.
 *
 * The compatibility matrix below is restated with Aria's real contract as the
 * reference. The old Python Stage-0 facts are kept only where they remain true
 * and relevant (privacy, the execution boundary); they are no longer described
 * as "Aria's whole contract".
 *
 * HARD RULES ENCODED HERE
 *
 *   - Text is never authority.
 *   - Aria is optional: a task created directly in the CLI needs no Aria
 *     session, conversation id, voice connection, or website session.
 *   - A device id in a request is never an access token; ownership is resolved
 *     from a verified principal server-side.
 *   - The CLI does not invent Aria wire fields and call them compatible.
 */

// ---------------------------------------------------------------------------
// 1. Aria contract version (integer, exactly as the backend and Aria model it)
//
// Aria's `check_version` compares `contract_version` for exact equality and
// treats any other value as a hard error, never a silent downgrade. It is a
// single integer today, so this module models it as one rather than inventing a
// MAJOR.MINOR.PATCH scheme the peer does not use.
// ---------------------------------------------------------------------------

/** The Aria wire contract version this client is written against. */
export const SUPPORTED_ARIA_CONTRACT_VERSION = 1

export interface CompatibilityResult {
  readonly compatible: boolean
  readonly reason?: string
}

/**
 * Compatibility holds only when the two integers are equal. Aria rejects a
 * different version outright, so accepting a "compatible" different value here
 * would let the CLI believe a request succeeded when Aria would have refused it.
 */
export function checkCompatibility(
  offered: number,
  supported: number = SUPPORTED_ARIA_CONTRACT_VERSION,
): CompatibilityResult {
  if (!Number.isInteger(offered)) {
    return { compatible: false, reason: `contract_version must be an integer; got ${String(offered)}.` }
  }
  if (offered !== supported) {
    return {
      compatible: false,
      reason: `contract_version ${offered} does not match supported ${supported}.`,
    }
  }
  return { compatible: true }
}

// ---------------------------------------------------------------------------
// 2. Provenance: every fact says where it came from
// ---------------------------------------------------------------------------

/**
 * Where a compatibility claim came from. A claim read from a real remote file
 * is not the same as a locally-authored baseline.
 */
export type EvidenceSource =
  /** Read directly from the named repository path. */
  | { kind: 'verified-repo'; repo: string; path: string }
  /** A local baseline authored without access to the real source. */
  | { kind: 'baseline-unverified'; note: string }
  /** The concept does not exist anywhere yet. */
  | { kind: 'absent'; note: string }

export type CapabilityDisposition =
  | 'VERIFIED_IMPLEMENTED'
  | 'IMPLEMENTED_BUT_PARTIALLY_VERIFIED'
  | 'DESIGNED'
  | 'PLANNED'
  | 'BLOCKED_BY_EXTERNAL_DEPENDENCY'

export interface CompatibilityRow {
  concept: string
  ariaActual: string
  cliActual: string
  requiredChange: string
  verification: string
  evidence: EvidenceSource
  disposition: CapabilityDisposition
}

const ARIA = 'aditya-munday/Aria'
const BACKEND = 'aditya-munday/Directioner-Platform-Backend'
const CLI = 'aditya-munday/Directioner-CLI'

/**
 * The compatibility matrix, restated against Aria's real Rust contract.
 * Kept as data so a test can assert it is complete and honestly dispositioned.
 */
export const ARIA_COMPATIBILITY_MATRIX: readonly CompatibilityRow[] = [
  {
    concept: 'identity (account/user)',
    ariaActual:
      'Aria holds only a user session token (crates/aria-backend/src/token.rs); it authenticates the user to the backend, never a provider or OS service.',
    cliActual:
      'AccountId/UserId types in platform-contract.ts. No client, no HTTP, no sign-in flow implemented.',
    requiredChange:
      'Both clients authenticate through the backend identity layer (Supabase-backed) and each resolves a verified principal server-side.',
    verification:
      'Backend auth middleware + device ownership tests; a CLI adapter that never trusts a request-supplied user id.',
    evidence: { kind: 'verified-repo', repo: ARIA, path: 'crates/aria-backend/src/token.rs' },
    disposition: 'DESIGNED',
  },
  {
    concept: 'device registration',
    ariaActual:
      'No device concept today. Aria is a native app with a session token, not an installation identity.',
    cliActual:
      'DirectionerDevice + DeviceRegistrationState types in platform-contract.ts. No registration client.',
    requiredChange:
      'Register each installation (platform aria | directioner_cli) against the caller\'s own account. Device id is never an access token.',
    verification:
      'Backend device contract: assertDeviceOwnership throws not-found for another owner; a spoofed device id grants nothing.',
    evidence: { kind: 'verified-repo', repo: BACKEND, path: 'src/modules/auth/device.ts' },
    disposition: 'DESIGNED',
  },
  {
    concept: 'session',
    ariaActual:
      'A session bearer token held in memory, never persisted to settings/history/diagnostics/logs (crates/aria-backend/src/token.rs).',
    cliActual:
      'DirectionerSession + SessionState types. Reference transport models expiry/revocation for tests only.',
    requiredChange:
      'Aria and the CLI each hold a backend session; logout/revocation is validated server-side (a stateless JWT alone cannot see a revocation).',
    verification:
      'Backend session validator: transport failure is 503, not "logged out"; CLI tests for AUTH_EXPIRED vs SESSION_REVOKED.',
    evidence: { kind: 'verified-repo', repo: BACKEND, path: 'src/modules/auth/session.ts' },
    disposition: 'DESIGNED',
  },
  {
    concept: 'wire contract (envelope & version)',
    ariaActual:
      'Versioned `/v1` endpoints; `contract_version` is the integer 1 and is echoed on every response; a mismatch is a hard error, never a downgrade (crates/aria-backend/src/contract.rs).',
    cliActual:
      'This module: integer version gate + endpoint-specific request/response recognition.',
    requiredChange:
      'The CLI must gate on the integer version and the real endpoint shapes, not the removed string envelope.',
    verification:
      'aria-contract.test.ts: integer gate, refusal of the removed `{contractVersion:"1.0.0", requestId, kind, payload}` envelope, and capability/chat shape acceptance.',
    evidence: { kind: 'verified-repo', repo: ARIA, path: 'crates/aria-backend/src/contract.rs' },
    disposition: 'IMPLEMENTED_BUT_PARTIALLY_VERIFIED',
  },
  {
    concept: 'chat / reasoning',
    ariaActual:
      'POST /v1/chat -> { contract_version, text, route? } and streaming /v1/chat/stream with incremental NDJSON deltas terminated by is_final (crates/aria-backend/src/contract.rs).',
    cliActual:
      'This module recognises both shapes and reconstructs a stream; no live client wired yet.',
    requiredChange:
      'When the CLI drives Aria-backed reasoning, it must concatenate deltas and terminate only on is_final.',
    verification:
      'aria-contract.test.ts: streaming reconstruction is exact; a missing final frame is not treated as a complete answer.',
    evidence: { kind: 'verified-repo', repo: ARIA, path: 'crates/aria-backend/src/contract.rs' },
    disposition: 'IMPLEMENTED_BUT_PARTIALLY_VERIFIED',
  },
  {
    concept: 'speech (recognition & synthesis)',
    ariaActual:
      'POST /v1/stt and /v1/tts (+ NDJSON /v1/stt/stream and /v1/tts/stream). Audio is a { sample_rate, channels, samples_le_base64 } payload of little-endian i16 PCM. Recognition streams replace the transcript and end with is_final; synthesis streams carry contiguous zero-based sequence numbers and end with an empty-audio is_final frame (crates/aria-backend/src/contract.rs).',
    cliActual:
      'This module mirrors the audio payload, STT/TTS request/response shapes, and both stream reconstructions; no live HTTP client wired yet.',
    requiredChange:
      'When the CLI consumes Aria speech, it must decode LE i16, apply replace semantics to recognition, and refuse a truncated synthesis stream.',
    verification:
      'aria-contract.test.ts: PCM round-trips, replace-semantics reconstruction, contiguous synthesis sequences, and a refused truncated stream.',
    evidence: { kind: 'verified-repo', repo: ARIA, path: 'crates/aria-backend/src/contract.rs' },
    disposition: 'IMPLEMENTED_BUT_PARTIALLY_VERIFIED',
  },
  {
    concept: 'routes / OS delegation',
    ariaActual:
      'A `RouteDto { capability, requires_confirmation }` hint on a reply, and a `DirectionerGateway` port whose only production impl is `NotIntegrated` (crates/aria-core/src/integration.rs). A route is a hint, never an authorization.',
    cliActual:
      'Task/approval vocabulary in platform-contract.ts; no gateway client.',
    requiredChange:
      'Aria relays a hint; the CLI/backend performs and authorizes. A route must never be treated as an approval or an authorization.',
    verification:
      'This module treats `route` as a hint only; backend approvals tests own the authority.',
    evidence: { kind: 'verified-repo', repo: ARIA, path: 'crates/aria-core/src/integration.rs' },
    disposition: 'DESIGNED',
  },
  {
    concept: 'task',
    ariaActual:
      'No task object. Aria produces proposals through the gateway port; it does not own a task engine.',
    cliActual:
      'DirectionerTask + TaskState in platform-contract.ts, with an executable-spec state machine in the reference transport.',
    requiredChange:
      'One shared logical task. Aria-originated work and CLI-originated work are the same object; CLI-origin metadata (session) is optional, never required.',
    verification:
      'Backend tasks table + optimistic-concurrency transitions; CLI mapping tests (this module).',
    evidence: {
      kind: 'verified-repo',
      repo: BACKEND,
      path: 'src/modules/database/repositories/task-repository.ts',
    },
    disposition: 'IMPLEMENTED_BUT_PARTIALLY_VERIFIED',
  },
  {
    concept: 'task status vocabulary',
    ariaActual: 'None.',
    cliActual:
      'TaskState (created/queued/running/waiting_for_user/.../cancelled/failed/completed).',
    requiredChange:
      'A tested mapping between the backend task status and the CLI TaskState; non-representable CLI states stay explicit.',
    verification: 'Mapping unit tests, including the non-representable states.',
    evidence: { kind: 'verified-repo', repo: BACKEND, path: 'src/modules/tasks/task.ts' },
    disposition: 'IMPLEMENTED_BUT_PARTIALLY_VERIFIED',
  },
  {
    concept: 'events / streaming',
    ariaActual:
      'Chat/STT/TTS streaming uses newline-delimited JSON with an is_final terminator per stream (crates/aria-backend/src/contract.rs). Aria\'s in-process PipelineEvent hierarchy is separate and local.',
    cliActual:
      'TaskEvent + TaskEventType, append-only with a monotonic per-task sequence and an idempotency key.',
    requiredChange:
      'Do not unify Aria\'s local pipeline events with the shared task journal; the shared stream is the backend TaskEvent journal.',
    verification:
      'CLI transport tests: monotonic sequences, duplicate-delivery idempotency, sinceSequence pagination.',
    evidence: { kind: 'verified-repo', repo: BACKEND, path: 'src/modules/tasks/task.ts' },
    disposition: 'DESIGNED',
  },
  {
    concept: 'actions',
    ariaActual:
      'None. Aria relays a route hint only; its gateway default never performs an action and never fabricates success (crates/aria-core/src/integration.rs).',
    cliActual:
      'Tool/command event types in TaskEventType; the privileged-operation boundary lives in the OS-capability work.',
    requiredChange:
      'Actions are coordinated through the shared task/event model; execution authority stays with Directioner-OS.',
    verification:
      'Aria gateway default test (no action, no fabricated success) + CLI test that an action event never executes.',
    evidence: { kind: 'verified-repo', repo: ARIA, path: 'crates/aria-core/src/integration.rs' },
    disposition: 'DESIGNED',
  },
  {
    concept: 'approvals',
    ariaActual:
      'A `requires_confirmation` hint and an approval id on a gateway outcome; the decision is made on the Directioner side. An audit row is not authority.',
    cliActual:
      'ApprovalRequest/ApprovalRecord types; an approval is only ever *decided*, never created by a client.',
    requiredChange:
      'A shared approval object bound to one operation and scope, with an explicit decision.',
    verification:
      'CLI reference transport tests: undecided-by-default, no replay, no scope widening.',
    evidence: { kind: 'verified-repo', repo: ARIA, path: 'crates/aria-core/src/integration.rs' },
    disposition: 'IMPLEMENTED_BUT_PARTIALLY_VERIFIED',
  },
  {
    concept: 'results / verification',
    ariaActual:
      'An `is_final` flag distinguishes a settled transcript/reply from a partial one; an empty reply is an error, not success.',
    cliActual:
      'OperationOutcome (ok|queued|failed) and VerificationVerdict incl. inconclusive.',
    requiredChange:
      'A result is never "done" because an acknowledgement arrived; verification distinguishes confirmed / not_confirmed / inconclusive.',
    verification: 'CLI verification tests; absent evidence is never success.',
    evidence: { kind: 'verified-repo', repo: CLI, path: 'common/src/directioner/platform-contract.ts' },
    disposition: 'IMPLEMENTED_BUT_PARTIALLY_VERIFIED',
  },
  {
    concept: 'cancellation',
    ariaActual:
      'A CancellationToken threaded through requests; a stream ends truthfully rather than presenting partial output as the answer.',
    cliActual:
      'cancelTask + cancelling/cancelled states; the reference transport rejects cancelling a terminal task.',
    requiredChange:
      'Cancellation is a request, not proof the work stopped. Define which state is authoritative under a cancel/complete race.',
    verification: 'CLI conformance tests: cancellation race resolves to a defined, truthful state.',
    evidence: { kind: 'verified-repo', repo: CLI, path: 'common/src/directioner/platform-contract.ts' },
    disposition: 'IMPLEMENTED_BUT_PARTIALLY_VERIFIED',
  },
  {
    concept: 'reconnection / sync',
    ariaActual: 'None at the CLI boundary; Aria has no task journal.',
    cliActual:
      'syncEvents distinguishes queued from done; a cloud failure on sync is "queued", never "ok".',
    requiredChange:
      'Clients resume from a sequence cursor without replaying an already-completed destructive operation.',
    verification: 'CLI tests: reconnect syncs queued events; a stale event cannot resurrect a terminal task.',
    evidence: { kind: 'verified-repo', repo: CLI, path: 'common/src/directioner/platform-contract.ts' },
    disposition: 'IMPLEMENTED_BUT_PARTIALLY_VERIFIED',
  },
  {
    concept: 'audit references',
    ariaActual:
      'Diagnostics support a correlation id; tokens and credentials are redacted before logging.',
    cliActual:
      'CorrelationId + EventId on every event; operationId on every operation.',
    requiredChange:
      'A shared correlation id propagated across CLI, Aria, backend, and OS so their audit logs join.',
    verification:
      'Backend system-authority request carries a caller correlation id; CLI events carry correlationId.',
    evidence: { kind: 'verified-repo', repo: BACKEND, path: 'src/modules/system-authority/operations.ts' },
    disposition: 'DESIGNED',
  },
  {
    concept: 'content retention',
    ariaActual:
      'A session token is never persisted; Python-lineage Aria also keeps conversation history in SQLite with an explicit purge.',
    cliActual:
      'DataClassification (LOCAL_ONLY / SYNC_METADATA / CLOUD_ALLOWED / ...) marks what may leave the machine.',
    requiredChange:
      'Task/event metadata may sync; raw transcripts and audio must not be retained by the shared model unless the user opted in.',
    verification:
      'No transcript field on TaskEvent; a test that shared metadata cannot carry conversation content.',
    evidence: { kind: 'verified-repo', repo: ARIA, path: 'crates/aria-backend/src/token.rs' },
    disposition: 'DESIGNED',
  },
]

// ---------------------------------------------------------------------------
// 3. Task status mapping (backend <-> CLI)
// ---------------------------------------------------------------------------

/** The backend task status vocabulary (verified: backend src/modules/tasks/task.ts). */
export type BackendTaskStatus =
  | 'draft'
  | 'awaiting_approval'
  | 'approved'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

/** The CLI task state vocabulary (verified: platform-contract.ts). */
export type CliTaskState =
  | 'created'
  | 'queued'
  | 'running'
  | 'waiting_for_user'
  | 'waiting_for_provider'
  | 'paused'
  | 'cancelling'
  | 'cancelled'
  | 'failed'
  | 'recovering'
  | 'completed'

const BACKEND_TO_CLI: Record<BackendTaskStatus, CliTaskState> = {
  draft: 'created',
  awaiting_approval: 'waiting_for_user',
  approved: 'queued',
  running: 'running',
  succeeded: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
}

export function cliStateForBackendStatus(status: BackendTaskStatus): CliTaskState {
  return BACKEND_TO_CLI[status]
}

export type StatusMappingResult =
  | { ok: true; status: BackendTaskStatus }
  | { ok: false; reason: string }

/**
 * CLI state -> backend status. Deliberately partial: `paused`, `cancelling`,
 * `recovering` and `waiting_for_provider` are client-local and have no backend
 * status. Coercing them would silently change meaning, so they map to an
 * explicit refusal that names the gap. `waiting_for_provider` maps to `running`
 * deliberately: the backend treats the task as in-flight.
 */
const CLI_TO_BACKEND: Partial<Record<CliTaskState, BackendTaskStatus>> = {
  created: 'draft',
  queued: 'approved',
  running: 'running',
  waiting_for_user: 'awaiting_approval',
  waiting_for_provider: 'running',
  cancelled: 'cancelled',
  failed: 'failed',
  completed: 'succeeded',
}

export function backendStatusForCliState(state: CliTaskState): StatusMappingResult {
  const status = CLI_TO_BACKEND[state]
  if (status === undefined) {
    return {
      ok: false,
      reason: `CLI state '${state}' has no backend task status; it is a client-local state and must be resolved before syncing.`,
    }
  }
  return { ok: true, status }
}

// ---------------------------------------------------------------------------
// 4. Aria endpoint shapes (mirror of the real /v1 contract)
// ---------------------------------------------------------------------------

/** A synthesis/reasoning route hint. A hint only, never an authorization. */
export interface AriaRoute {
  readonly capability: string
  readonly requires_confirmation: boolean
}

/** A voice as Aria's capabilities advertises it. Accent is an object, not a string. */
export interface AriaVoice {
  readonly id: string
  readonly name: string
  readonly language: string
  readonly accent?: { readonly tag: string }
}

export interface AriaCapabilities {
  readonly contract_version: number
  readonly backend_version: string
  readonly stt_languages: readonly string[]
  readonly tts_languages: readonly string[]
  readonly voices: readonly AriaVoice[]
  readonly streaming_stt: boolean
  readonly streaming_chat: boolean
  readonly streaming_tts: boolean
}

export interface AriaChatRequest {
  readonly contract_version: number
  readonly messages: readonly { readonly role: 'system' | 'user' | 'assistant'; readonly content: string }[]
  readonly conversation_id?: string
  readonly language?: string
}

export interface AriaChatResponse {
  readonly contract_version: number
  readonly text: string
  readonly route?: AriaRoute | null
}

/** One settled reasoning delta. `delta` is incremental; `is_final` ends the stream. */
export interface AriaChatStreamEvent {
  readonly contract_version: number
  readonly is_final: boolean
  readonly delta: string
  readonly route?: AriaRoute | null
}

/** Aria's flat error body (not the /api/v1 nested problem body). */
export interface AriaErrorBody {
  readonly contract_version: number
  readonly code: string
  readonly message: string
}

export type CheckResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validate a value against Aria's `contract_version` field: it must be present,
 * an integer, and equal to the supported version. This is the single gate every
 * endpoint shape below uses.
 */
export function checkAriaContractVersion(
  value: Record<string, unknown>,
  supported: number = SUPPORTED_ARIA_CONTRACT_VERSION,
): CompatibilityResult {
  const version = value.contract_version
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return { compatible: false, reason: 'contract_version must be an integer.' }
  }
  return checkCompatibility(version, supported)
}

export function parseAriaCapabilities(
  value: unknown,
  supported: number = SUPPORTED_ARIA_CONTRACT_VERSION,
): CheckResult<AriaCapabilities> {
  if (!isRecord(value)) return { ok: false, reason: 'capabilities is not an object' }
  const compat = checkAriaContractVersion(value, supported)
  if (!compat.compatible) return { ok: false, reason: compat.reason ?? 'incompatible contract' }
  if (typeof value.backend_version !== 'string') {
    return { ok: false, reason: 'backend_version must be a string' }
  }
  if (!Array.isArray(value.voices)) return { ok: false, reason: 'voices must be an array' }
  return { ok: true, value: value as unknown as AriaCapabilities }
}

export function parseAriaChatResponse(
  value: unknown,
  supported: number = SUPPORTED_ARIA_CONTRACT_VERSION,
): CheckResult<AriaChatResponse> {
  if (!isRecord(value)) return { ok: false, reason: 'chat response is not an object' }
  const compat = checkAriaContractVersion(value, supported)
  if (!compat.compatible) return { ok: false, reason: compat.reason ?? 'incompatible contract' }
  if (typeof value.text !== 'string') return { ok: false, reason: 'text must be a string' }
  return { ok: true, value: value as unknown as AriaChatResponse }
}

export function parseAriaError(
  value: unknown,
  supported: number = SUPPORTED_ARIA_CONTRACT_VERSION,
): CheckResult<AriaErrorBody> {
  if (!isRecord(value)) return { ok: false, reason: 'error body is not an object' }
  const compat = checkAriaContractVersion(value, supported)
  if (!compat.compatible) return { ok: false, reason: compat.reason ?? 'incompatible contract' }
  if (typeof value.code !== 'string') return { ok: false, reason: 'code must be a string' }
  if (typeof value.message !== 'string') return { ok: false, reason: 'message must be a string' }
  return { ok: true, value: value as unknown as AriaErrorBody }
}

/**
 * Reconstruct a reply from a stream of NDJSON Aria chat events. Only events
 * whose `is_final` is false contribute text; the stream is complete only when a
 * final event is seen. A stream with no final event is NOT a complete answer,
 * mirroring Aria's own rule (an unfinished stream is an error, not a short
 * reply).
 */
export function reconstructAriaChatStream(
  events: readonly unknown[],
  supported: number = SUPPORTED_ARIA_CONTRACT_VERSION,
): CheckResult<string> {
  let text = ''
  let finalSeen = false
  for (const event of events) {
    if (!isRecord(event)) return { ok: false, reason: 'stream event is not an object' }
    const compat = checkAriaContractVersion(event, supported)
    if (!compat.compatible) return { ok: false, reason: compat.reason ?? 'incompatible contract' }
    if (typeof event.delta !== 'string' || typeof event.is_final !== 'boolean') {
      return { ok: false, reason: 'stream event needs a string delta and boolean is_final' }
    }
    if (event.is_final) {
      finalSeen = true
      break
    }
    text += event.delta
  }
  if (!finalSeen) {
    return { ok: false, reason: 'stream ended without a final event; the reply is incomplete' }
  }
  return { ok: true, value: text }
}

// ---------------------------------------------------------------------------
// 4b. Aria speech endpoint shapes (mirror of the real /v1 contract)
//
// The backend serves POST /v1/stt, /v1/stt/stream, /v1/tts and /v1/tts/stream.
// These shapes are mirrored here so a client can recognise them without
// re-deriving the wire rules. The rules that matter on the wire:
//
//   - Audio is little-endian i16 PCM, base64-encoded, with the rate and channel
//     count stated explicitly. A single-channel frame is one i16 per sample.
//   - Recognition streams use *replace* semantics: each event carries the
//     transcript so far, and the stream is complete only when is_final is true.
//   - Synthesis streams carry contiguous, zero-based sequence numbers and end
//     with an empty-audio final frame, so a truncated stream is never mistaken
//     for a complete answer.
// ---------------------------------------------------------------------------

/** An Aria PCM audio payload (little-endian i16, base64). */
export interface AriaAudioPayload {
  readonly sample_rate: number
  readonly channels: number
  readonly samples_le_base64: string
}

export interface AriaSttRequest {
  readonly contract_version: number
  readonly audio: AriaAudioPayload
  readonly language?: string | null
}

export interface AriaSttResponse {
  readonly contract_version: number
  readonly text: string
  readonly language?: string | null
  readonly confidence?: number | null
}

/** One streamed recognition event. `text` is the transcript so far (replace). */
export interface AriaSttStreamEvent {
  readonly contract_version: number
  readonly is_final: boolean
  readonly text: string
  readonly language?: string | null
}

export interface AriaTtsRequest {
  readonly contract_version: number
  readonly text: string
  readonly language?: string | null
  readonly voice?: string | null
  readonly speed: number
  readonly sample_rate: number
}

export interface AriaTtsResponse {
  readonly contract_version: number
  readonly audio: AriaAudioPayload
}

/** One streamed synthesis chunk. `sequence` is contiguous and zero-based. */
export interface AriaTtsStreamEvent {
  readonly contract_version: number
  readonly sequence: number
  readonly is_final: boolean
  readonly audio: AriaAudioPayload
}

function checkAudioPayload(value: unknown): CheckResult<AriaAudioPayload> {
  if (!isRecord(value)) return { ok: false, reason: 'audio is not an object' }
  if (typeof value.sample_rate !== 'number' || !Number.isInteger(value.sample_rate)) {
    return { ok: false, reason: 'audio.sample_rate must be an integer' }
  }
  if (
    typeof value.channels !== 'number' ||
    !Number.isInteger(value.channels) ||
    value.channels < 1
  ) {
    return { ok: false, reason: 'audio.channels must be a positive integer' }
  }
  if (typeof value.samples_le_base64 !== 'string') {
    return { ok: false, reason: 'audio.samples_le_base64 must be a string' }
  }
  return { ok: true, value: value as unknown as AriaAudioPayload }
}

export function parseAriaSttResponse(
  value: unknown,
  supported: number = SUPPORTED_ARIA_CONTRACT_VERSION,
): CheckResult<AriaSttResponse> {
  if (!isRecord(value)) return { ok: false, reason: 'stt response is not an object' }
  const compat = checkAriaContractVersion(value, supported)
  if (!compat.compatible) return { ok: false, reason: compat.reason ?? 'incompatible contract' }
  if (typeof value.text !== 'string') return { ok: false, reason: 'text must be a string' }
  return { ok: true, value: value as unknown as AriaSttResponse }
}

export function parseAriaTtsResponse(
  value: unknown,
  supported: number = SUPPORTED_ARIA_CONTRACT_VERSION,
): CheckResult<AriaTtsResponse> {
  if (!isRecord(value)) return { ok: false, reason: 'tts response is not an object' }
  const compat = checkAriaContractVersion(value, supported)
  if (!compat.compatible) return { ok: false, reason: compat.reason ?? 'incompatible contract' }
  const audio = checkAudioPayload(value.audio)
  if (!audio.ok) return { ok: false, reason: audio.reason }
  return { ok: true, value: value as unknown as AriaTtsResponse }
}

/** Decode an Aria PCM payload into interleaved i16 samples (little-endian). */
export function decodeAriaPcm(payload: AriaAudioPayload): CheckResult<Int16Array> {
  const binary = atob(payload.samples_le_base64)
  if (binary.length % 2 !== 0) {
    return { ok: false, reason: 'audio payload has an odd byte count for i16 PCM' }
  }
  const samples = new Int16Array(binary.length / 2)
  for (let i = 0; i < samples.length; i += 1) {
    const lo = binary.charCodeAt(i * 2)
    const hi = binary.charCodeAt(i * 2 + 1)
    const unsigned = lo | (hi << 8)
    // Sign-extend the 16-bit little-endian value.
    samples[i] = unsigned >= 0x8000 ? unsigned - 0x10000 : unsigned
  }
  return { ok: true, value: samples }
}

/** Encode interleaved i16 samples into an Aria PCM payload (little-endian). */
export function encodeAriaPcm(
  samples: Int16Array,
  sampleRate: number,
  channels = 1,
): AriaAudioPayload {
  let binary = ''
  for (const sample of samples) {
    const unsigned = sample < 0 ? sample + 0x10000 : sample
    binary += String.fromCharCode(unsigned & 0xff, (unsigned >> 8) & 0xff)
  }
  return { sample_rate: sampleRate, channels, samples_le_base64: btoa(binary) }
}

/**
 * Reconstruct a transcript from a stream of Aria NDJSON recognition events.
 * Aria uses replace semantics: each non-final event supersedes the previous, so
 * only the last event's text is the transcript. The stream is complete only when
 * a final event is seen; a stream with no final event is incomplete, not a short
 * transcript, mirroring Aria's own rule.
 */
export function reconstructAriaSttStream(
  events: readonly unknown[],
  supported: number = SUPPORTED_ARIA_CONTRACT_VERSION,
): CheckResult<string> {
  let text = ''
  let finalSeen = false
  for (const event of events) {
    if (!isRecord(event)) return { ok: false, reason: 'stream event is not an object' }
    const compat = checkAriaContractVersion(event, supported)
    if (!compat.compatible) return { ok: false, reason: compat.reason ?? 'incompatible contract' }
    if (typeof event.text !== 'string' || typeof event.is_final !== 'boolean') {
      return { ok: false, reason: 'stream event needs a string text and boolean is_final' }
    }
    // Replace, not append: the event carries the transcript so far.
    text = event.text
    if (event.is_final) {
      finalSeen = true
      break
    }
  }
  if (!finalSeen) {
    return { ok: false, reason: 'stream ended without a final event; the transcript is incomplete' }
  }
  return { ok: true, value: text }
}

/**
 * Reconstruct synthesized audio from a stream of Aria NDJSON synthesis events.
 * Sequences must be contiguous and zero-based, and the stream is complete only
 * when an event with `is_final: true` is seen. The final frame is typically
 * empty; it is the terminator, not audio.
 */
export function reconstructAriaTtsStream(
  events: readonly unknown[],
  supported: number = SUPPORTED_ARIA_CONTRACT_VERSION,
): CheckResult<Int16Array> {
  const parts: Int16Array[] = []
  let expectedSequence = 0
  let finalSeen = false
  for (const event of events) {
    if (!isRecord(event)) return { ok: false, reason: 'stream event is not an object' }
    const compat = checkAriaContractVersion(event, supported)
    if (!compat.compatible) return { ok: false, reason: compat.reason ?? 'incompatible contract' }
    if (typeof event.sequence !== 'number' || event.sequence !== expectedSequence) {
      return {
        ok: false,
        reason: `synthesis chunk out of order: expected ${expectedSequence}, got ${String(event.sequence)}`,
      }
    }
    expectedSequence += 1
    const audio = checkAudioPayload(event.audio)
    if (!audio.ok) return { ok: false, reason: audio.reason }
    const decoded = decodeAriaPcm(audio.value)
    if (!decoded.ok) return { ok: false, reason: decoded.reason }
    if (typeof event.is_final !== 'boolean') {
      return { ok: false, reason: 'stream event needs a boolean is_final' }
    }
    if (event.is_final) {
      finalSeen = true
      break
    }
    parts.push(decoded.value)
  }
  if (!finalSeen) {
    return { ok: false, reason: 'stream ended without a final event; the audio is incomplete' }
  }
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const combined = new Int16Array(total)
  let offset = 0
  for (const part of parts) {
    combined.set(part, offset)
    offset += part.length
  }
  return { ok: true, value: combined }
}

// ---------------------------------------------------------------------------
// 5. Honest capability report
// ---------------------------------------------------------------------------

export interface CapabilityReport {
  readonly contractVersion: number
  readonly matrix: readonly CompatibilityRow[]
  /** Concepts with at least one verified or partial fact. */
  readonly verifiedConcepts: readonly string[]
  /** Concepts blocked on a component that does not exist yet. */
  readonly blockedConcepts: readonly string[]
}

export function ariaCompatibilityReport(): CapabilityReport {
  const verifiedConcepts = ARIA_COMPATIBILITY_MATRIX.filter(
    (row) =>
      row.disposition === 'VERIFIED_IMPLEMENTED' ||
      row.disposition === 'IMPLEMENTED_BUT_PARTIALLY_VERIFIED',
  ).map((row) => row.concept)
  const blockedConcepts = ARIA_COMPATIBILITY_MATRIX.filter(
    (row) => row.disposition === 'BLOCKED_BY_EXTERNAL_DEPENDENCY',
  ).map((row) => row.concept)
  return {
    contractVersion: SUPPORTED_ARIA_CONTRACT_VERSION,
    matrix: ARIA_COMPATIBILITY_MATRIX,
    verifiedConcepts,
    blockedConcepts,
  }
}
