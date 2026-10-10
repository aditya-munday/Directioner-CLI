/**
 * Aria ⇄ Directioner-CLI compatibility — the verified boundary, not a proposal.
 *
 * WHY THIS FILE EXISTS
 *
 * Aria is a separate voice assistant that must be able to *request* work that
 * the CLI can perform, without either owning a private task engine. For that to
 * be true, the two clients have to agree on a shared vocabulary and a shared
 * authority rule. This module is the CLI-side, machine-checkable record of what
 * that agreement actually is today — including what is *not* there yet.
 *
 * WHAT WAS ACTUALLY VERIFIED (2026-10-10)
 *
 * Aria's real repository is `aditya-munday/Aria` (GitHub, private), a **Python**
 * project (`aria-voice`, `aria.core.*`). It is at Stage 0: a deterministic,
 * headless voice pipeline (wake → VAD → STT → reasoning → TTS) running over a
 * WAV fixture with stubbed providers. It contains:
 *
 *   - an in-process `PipelineEvent` hierarchy (`aria/core/pipeline/events.py`):
 *     wake/VAD/STT/LLM/TTS/state-transition events. These are *local* events,
 *     not a cross-client wire protocol.
 *   - a SQLite memory schema (`aria/core/memory/schema.py`) with an
 *     `intent_audit_log` (intent_id, intent_type, risk_level, payload_json,
 *     confirmed_by_user, status).
 *   - an absolute execution boundary: Aria never executes OS actions, imports
 *     no capability daemon, and constructs no `CapabilityKind` (enforced by
 *     `tests/security/test_stage0_security_boundary.py`).
 *
 * Aria has **no network task/session/envelope contract**, and **no** Rust
 * `aria-backend::contract` module or `docs/BACKEND-CONTRACT.md` (those were a
 * design proposal, not this repo). The old `aria.core.intent.directioner_client`
 * that earlier documents describe was **removed**; the security test asserts it
 * no longer exists.
 *
 * The shared network contract therefore lives in the backend repo
 * `aditya-munday/Directioner-Platform-Backend` (`src/contracts/aria.ts`,
 * `src/contracts/aria-envelope.ts`), which itself marks its Aria fixtures as
 * **BASELINE — requires reconciliation** because no Aria wire contract existed
 * when they were authored. This module mirrors the *rules* (version
 * compatibility, envelope shape, task vocabulary) and records that the Aria
 * side of them is unverified.
 *
 * HARD RULES ENCODED HERE
 *
 *   - Text is never authority (same rule as `platform-contract.ts`).
 *   - Aria is optional: a task created directly in the CLI needs no Aria
 *     session, conversation id, voice connection, or website session.
 *   - A device id in a request is never an access token; ownership is resolved
 *     from a verified principal server-side.
 *   - The CLI does not invent Aria wire fields and call them compatible.
 */

// ---------------------------------------------------------------------------
// 1. Contract version compatibility
//
// Mirrors the backend's `checkCompatibility` (src/contracts/aria.ts) exactly.
// It is duplicated on the client on purpose: the CLI must be able to refuse an
// incompatible peer locally, before a request leaves the machine, and a shared
// dependency on backend code that does not exist is not possible. The two
// implementations must agree; `aria-contract.test.ts` pins the rules.
// ---------------------------------------------------------------------------

export interface ContractVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
}

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/

export function parseContractVersion(value: string): ContractVersion {
  const match = VERSION_PATTERN.exec(value.trim())
  if (match === null) {
    throw new Error(
      `Invalid contract version "${value}"; expected MAJOR.MINOR.PATCH.`,
    )
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

export interface CompatibilityResult {
  readonly compatible: boolean
  readonly reason?: string
}

/**
 * Compatibility holds when the majors match and the caller's minor is not newer
 * than the supported one — the backend understands every field the caller may
 * send. A newer minor means the caller may send fields we cannot interpret, so
 * it is refused rather than silently ignored.
 */
export function checkCompatibility(
  offered: string,
  supported: string,
): CompatibilityResult {
  const a = parseContractVersion(offered)
  const b = parseContractVersion(supported)

  if (a.major !== b.major) {
    return {
      compatible: false,
      reason: `Major version mismatch: caller offered ${offered}, supported ${supported}.`,
    }
  }
  if (a.minor > b.minor) {
    return {
      compatible: false,
      reason: `Caller minor version ${a.minor} is newer than supported ${b.minor}.`,
    }
  }
  return { compatible: true }
}

/** The Aria wire contract version this client is written against. */
export const SUPPORTED_ARIA_CONTRACT_VERSION = '1.0.0'

// ---------------------------------------------------------------------------
// 2. Provenance — every fact says where it came from
// ---------------------------------------------------------------------------

/**
 * Where a compatibility claim came from. The distinction is the whole point:
 * a claim read from a real remote file is not the same as a baseline that was
 * authored locally because no source was available.
 */
export type EvidenceSource =
  /** Read directly from the named repository's files. */
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

/**
 * One row of the compatibility matrix. `ariaActual`/`cliActual` are prose for
 * humans; `evidence` is what makes them checkable.
 */
export interface CompatibilityRow {
  /** e.g. 'identity', 'tasks', 'events', 'approvals', 'cancellation'. */
  concept: string
  /** What Aria actually has today, or an explicit "none". */
  ariaActual: string
  /** What the CLI actually has today. */
  cliActual: string
  /** The concrete change required to make them interoperate. */
  requiredChange: string
  /** How the change is (or will be) verified. */
  verification: string
  evidence: EvidenceSource
  disposition: CapabilityDisposition
}

const ARIA = 'aditya-munday/Aria'
const BACKEND = 'aditya-munday/Directioner-Platform-Backend'
const CLI = 'aditya-munday/Directioner-CLI'

/**
 * The compatibility matrix. Kept as data so a test can assert it is complete
 * and honestly dispositioned, rather than living only in prose that drifts.
 */
export const ARIA_COMPATIBILITY_MATRIX: readonly CompatibilityRow[] = [
  {
    concept: 'identity (account/user)',
    ariaActual:
      'No account or user model. No authentication; Stage 0 runs on a WAV fixture with no provider keys and no sign-in.',
    cliActual:
      'AccountId/UserId types exist in platform-contract.ts. No client, no HTTP, no sign-in flow implemented.',
    requiredChange:
      'Both clients authenticate through the backend identity layer (Supabase-backed). The CLI and Aria each resolve a verified principal server-side.',
    verification:
      'Backend auth middleware + device ownership tests; a CLI adapter that never trusts a request-supplied user id.',
    evidence: {
      kind: 'verified-repo',
      repo: ARIA,
      path: 'aria/core/stage0/pipeline.py (no auth)',
    },
    disposition: 'BLOCKED_BY_EXTERNAL_DEPENDENCY',
  },
  {
    concept: 'device registration',
    ariaActual:
      'No device concept. Aria is a single local process with no installation identity.',
    cliActual:
      'DirectionerDevice + DeviceRegistrationState types in platform-contract.ts. No registration client.',
    requiredChange:
      'Register each installation (platform aria | directioner_cli) against the caller\'s own account. Device id is never an access token.',
    verification:
      'Backend device contract: assertDeviceOwnership throws not-found for another owner; a test that a spoofed device id grants nothing.',
    evidence: {
      kind: 'verified-repo',
      repo: BACKEND,
      path: 'src/modules/auth/device.ts',
    },
    disposition: 'DESIGNED',
  },
  {
    concept: 'session',
    ariaActual:
      'In-process pipeline state only (PipelineState: idle/listening/thinking/…). No session record, no token, no expiry.',
    cliActual:
      'DirectionerSession + SessionState types. Reference transport models expiry/revocation for tests only.',
    requiredChange:
      'Aria and the CLI each hold a backend session; logout/revocation is validated server-side (a stateless JWT alone cannot see a revocation).',
    verification:
      'Backend session validator: transport failure is 503, not "logged out"; CLI tests for AUTH_EXPIRED vs SESSION_REVOKED.',
    evidence: {
      kind: 'verified-repo',
      repo: BACKEND,
      path: 'src/modules/auth/session.ts',
    },
    disposition: 'BLOCKED_BY_EXTERNAL_DEPENDENCY',
  },
  {
    concept: 'task',
    ariaActual:
      'No task object. The removed directioner_client used to hold an intent; that module no longer exists.',
    cliActual:
      'DirectionerTask + TaskState in platform-contract.ts, with an executable-spec state machine in the reference transport.',
    requiredChange:
      'One shared logical task. Aria-originated work and CLI-originated work are the same object; CLI-origin metadata (session) is optional, never required.',
    verification:
      'Backend tasks table (id,user_id,title,status,version) + optimistic-concurrency transitions; CLI mapping tests (this module).',
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
      'TaskState (created/queued/running/waiting_for_user/…/cancelled/failed/completed).',
    requiredChange:
      'A tested, lossy-where-necessary mapping between the backend task status and the CLI TaskState. Non-representable CLI states must be explicit, not coerced.',
    verification: 'Mapping unit tests, including the non-representable states.',
    evidence: {
      kind: 'verified-repo',
      repo: BACKEND,
      path: 'src/modules/tasks/task.ts',
    },
    disposition: 'IMPLEMENTED_BUT_PARTIALLY_VERIFIED',
  },
  {
    concept: 'events / streaming',
    ariaActual:
      'In-process PipelineEvent hierarchy (wake/VAD/STT/LLM/TTS/state) on an asyncio EventBus. Not a wire protocol.',
    cliActual:
      'TaskEvent + TaskEventType, append-only with a monotonic per-task sequence and an idempotency key.',
    requiredChange:
      'Aria\'s local pipeline events are not the shared event stream. The shared stream is the backend TaskEvent journal. Do not unify the two vocabularies.',
    verification:
      'CLI transport tests: monotonic sequences, duplicate-delivery idempotency, sinceSequence pagination.',
    evidence: {
      kind: 'verified-repo',
      repo: ARIA,
      path: 'aria/core/pipeline/events.py',
    },
    disposition: 'DESIGNED',
  },
  {
    concept: 'actions',
    ariaActual:
      'None. Aria emits text tokens only and, by security test, never tool calls that execute anything.',
    cliActual:
      'Tool/command event types in TaskEventType; the privileged-operation boundary lives in the OS-capability work (separate branch).',
    requiredChange:
      'Actions are coordinated through the shared task/event model; execution authority stays with Directioner-OS. No new raw-exec mechanism.',
    verification:
      'Aria security-boundary test (no capability daemon import) + CLI test that an action event never executes.',
    evidence: {
      kind: 'verified-repo',
      repo: ARIA,
      path: 'tests/security/test_stage0_security_boundary.py',
    },
    disposition: 'DESIGNED',
  },
  {
    concept: 'approvals',
    ariaActual:
      'No approval object. An `intent_audit_log` records confirmed_by_user as a boolean, but that is an audit row, not an authorizing object.',
    cliActual:
      'ApprovalRequest/ApprovalRecord types; policy that an approval is only ever *decided*, never created by a client.',
    requiredChange:
      'A shared approval object bound to one operation and scope, with an explicit decision. A boolean in an audit row is not authority.',
    verification:
      'CLI reference transport tests: undecided-by-default, no replay, no scope widening, decision source recorded.',
    evidence: {
      kind: 'verified-repo',
      repo: ARIA,
      path: 'aria/core/memory/schema.py (intent_audit_log)',
    },
    disposition: 'IMPLEMENTED_BUT_PARTIALLY_VERIFIED',
  },
  {
    concept: 'results / verification',
    ariaActual: 'None.',
    cliActual:
      'OperationOutcome (ok|queued|failed) and, in the OS-capability work, VerificationVerdict incl. inconclusive.',
    requiredChange:
      'A result is never "done" because an acknowledgement arrived. Verification distinguishes confirmed / not_confirmed / inconclusive.',
    verification: 'CLI verification tests; absent evidence is never success.',
    evidence: {
      kind: 'verified-repo',
      repo: CLI,
      path: 'common/src/directioner/platform-contract.ts',
    },
    disposition: 'IMPLEMENTED_BUT_PARTIALLY_VERIFIED',
  },
  {
    concept: 'cancellation',
    ariaActual: 'None (no task to cancel).',
    cliActual:
      'cancelTask + cancelling/cancelled states; the reference transport rejects cancelling a terminal task.',
    requiredChange:
      'Cancellation is a request, not proof the work stopped. Define which state is authoritative under a cancel/complete race.',
    verification:
      'CLI conformance tests: cancellation race resolves to a defined, truthful state.',
    evidence: {
      kind: 'verified-repo',
      repo: CLI,
      path: 'common/src/directioner/platform-contract.ts (TaskState, cancelTask)',
    },
    disposition: 'IMPLEMENTED_BUT_PARTIALLY_VERIFIED',
  },
  {
    concept: 'reconnection / sync',
    ariaActual: 'None.',
    cliActual:
      'syncEvents distinguishes queued from done; a cloud failure on sync is "queued", never "ok".',
    requiredChange:
      'Clients resume from a sequence cursor without replaying an already-completed destructive operation.',
    verification:
      'CLI tests: reconnect syncs queued events; a stale event cannot resurrect a terminal task.',
    evidence: {
      kind: 'verified-repo',
      repo: CLI,
      path: 'common/src/directioner/platform-contract.ts (SyncState, syncEvents)',
    },
    disposition: 'IMPLEMENTED_BUT_PARTIALLY_VERIFIED',
  },
  {
    concept: 'audit references',
    ariaActual:
      'intent_audit_log rows (intent_id, risk_level, status, created_at).',
    cliActual:
      'CorrelationId + EventId on every event; operationId on every operation.',
    requiredChange:
      'A shared correlation id propagated across CLI, Aria, backend, and OS so their audit logs join. No client invents its own id space for another\'s records.',
    verification:
      'Backend system-authority request carries a caller correlation id; CLI events carry correlationId.',
    evidence: {
      kind: 'verified-repo',
      repo: BACKEND,
      path: 'src/modules/system-authority/operations.ts',
    },
    disposition: 'DESIGNED',
  },
  {
    concept: 'wire envelope',
    ariaActual:
      'None. There is no Aria network contract in the Aria repo.',
    cliActual:
      'A mirror of the backend envelope gate (ariaEnvelopeSchema + version check), tagged baseline.',
    requiredChange:
      'Reconcile the backend\'s baseline fixture against Aria\'s real contract once Aria defines one; until then the envelope is unverified.',
    verification:
      'A fixture-driven test once a real Aria contract exists — not yet possible.',
    evidence: {
      kind: 'baseline-unverified',
      note:
        'Backend contracts/aria/README.md states the fixtures were authored locally because no Aria source was available.',
    },
    disposition: 'BLOCKED_BY_EXTERNAL_DEPENDENCY',
  },
  {
    concept: 'content retention',
    ariaActual:
      'Conversation history, user_facts, and preferences in SQLite, with explicit eviction bounds and a clear_all_memory() privacy purge.',
    cliActual:
      'DataClassification (LOCAL_ONLY / SYNC_METADATA / CLOUD_ALLOWED / …) marks what may leave the machine.',
    requiredChange:
      'Task/event metadata may sync; raw transcripts and audio must not be retained by the shared model unless the user opted in. Preserve Aria\'s purge semantics.',
    verification:
      'No transcript field on TaskEvent; a test that shared metadata cannot carry conversation content.',
    evidence: {
      kind: 'verified-repo',
      repo: ARIA,
      path: 'aria/core/memory/schema.py',
    },
    disposition: 'DESIGNED',
  },
]

// ---------------------------------------------------------------------------
// 3. Task status mapping (backend ⇄ CLI)
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

/**
 * Backend status → CLI state. Total: every backend status has a CLI state.
 * Both vocabularies describe the same lifecycle, so this direction loses
 * nothing.
 */
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
 * CLI state → backend status. Deliberately partial: the CLI has states the
 * backend vocabulary does not model (`paused`, `cancelling`, `recovering`,
 * `waiting_for_provider`). Coercing them to a nearby backend status would
 * silently change meaning — a paused task is not "running" — so they map to an
 * explicit refusal that names the gap.
 *
 * `waiting_for_provider` maps to `running` deliberately: the backend treats the
 * task as in-flight; "waiting on a provider" is a client-local rendering of
 * that, not a distinct server state.
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
// 4. Aria envelope gate (mirror of the backend, tagged baseline)
// ---------------------------------------------------------------------------

export interface AriaEnvelope {
  contractVersion: string
  requestId: string
  kind: string
  payload: Record<string, unknown>
}

export type EnvelopeParseResult =
  | { ok: true; envelope: AriaEnvelope; provenance: 'baseline-unverified' }
  | { ok: false; reason: string }

/**
 * Validate an Aria wire envelope and its contract version. This is the CLI-side
 * mirror of the backend gate. The returned `provenance` is always
 * `baseline-unverified`: the envelope shape is a locally-authored baseline, not
 * a verified Aria contract, and callers must not treat a parse success as
 * evidence of Aria compatibility.
 */
export function parseAriaEnvelope(
  value: unknown,
  supportedVersion: string = SUPPORTED_ARIA_CONTRACT_VERSION,
): EnvelopeParseResult {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, reason: 'envelope is not an object' }
  }
  const e = value as Record<string, unknown>
  if (typeof e.contractVersion !== 'string') {
    return { ok: false, reason: 'contractVersion is missing or not a string' }
  }
  let compatibility: CompatibilityResult
  try {
    compatibility = checkCompatibility(e.contractVersion, supportedVersion)
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
  if (!compatibility.compatible) {
    return { ok: false, reason: compatibility.reason ?? 'incompatible contract' }
  }
  if (
    typeof e.requestId !== 'string' ||
    e.requestId.length < 8 ||
    e.requestId.length > 128
  ) {
    return { ok: false, reason: 'requestId must be 8..128 characters' }
  }
  if (typeof e.kind !== 'string' || e.kind.length < 1 || e.kind.length > 100) {
    return { ok: false, reason: 'kind must be 1..100 characters' }
  }
  if (typeof e.payload !== 'object' || e.payload === null || Array.isArray(e.payload)) {
    return { ok: false, reason: 'payload must be an object' }
  }
  return {
    ok: true,
    envelope: {
      contractVersion: e.contractVersion,
      requestId: e.requestId,
      kind: e.kind,
      payload: e.payload as Record<string, unknown>,
    },
    provenance: 'baseline-unverified',
  }
}

// ---------------------------------------------------------------------------
// 5. Honest capability report
// ---------------------------------------------------------------------------

export interface CapabilityReport {
  readonly contractVersion: string
  readonly matrix: readonly CompatibilityRow[]
  /** Concepts with at least one verified fact. */
  readonly verifiedConcepts: readonly string[]
  /** Concepts blocked on a component that does not exist yet. */
  readonly blockedConcepts: readonly string[]
}

/**
 * Summarize what is actually verified about Aria–CLI compatibility. This is the
 * honest self-report the CLI can print; it never claims a blocked concept is
 * implemented.
 */
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
