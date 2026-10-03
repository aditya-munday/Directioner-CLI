/**
 * Directioner platform contract — the client-side, provider-neutral types the
 * CLI is written against for the future Directioner backend.
 *
 * WHY THIS FILE EXISTS
 *
 * The production customer architecture is:
 *
 *   Directioner account → authenticated CLI → Directioner backend →
 *   Directioner model/service gateway → server-side provider credentials.
 *
 * The customer never holds a provider key, and the CLI never names a model
 * vendor in its application layer. The CLI knows about *Directioner services*;
 * it does not know which provider answers a request. That boundary has to exist
 * in the types before it can exist in the code, otherwise provider names leak
 * into the application layer the moment someone adds a fast path.
 *
 * WHAT IS REAL HERE
 *
 * Only types, constants, and pure helpers. There is no HTTP client, no
 * endpoint URL, no fake backend, and no network call. The backend does not
 * exist. Every symbol in this file is a contract for code that is not written
 * yet; nothing here is claimed to be implemented.
 *
 * The one piece of real behaviour that already exists is the BYOK path
 * (`cli/src/utils/directioner-byok.ts`, `common/src/constants/directioner-*`).
 * BYOK is a development/test capability (see D3 in
 * `docs/directioner-open-decisions.md`), not the production customer path, and
 * it is deliberately NOT referenced from this file: the production contract
 * must not depend on the development adapter.
 *
 * IMPORTANT INVARIANT
 *
 * Text is never authority. Nothing in this contract lets a model, a repository
 * file, a tool result, or an MCP server produce an `Approval`. Approvals are
 * objects issued by the authorization system (the backend), and the only thing
 * a client can do with one is *submit a decision the user actually made*.
 */

// ---------------------------------------------------------------------------
// 1. Identifiers
//
// Each id identifies one thing, in one scope, and is never accepted as
// authority outside that scope. A `deviceId` presented where a `sessionId` is
// expected is a rejection, not a lookup. See the architecture doc §6.
// ---------------------------------------------------------------------------

/** The billing/ownership unit. The tenant boundary for every backend check. */
export type AccountId = string
/** An actor within an account. */
export type UserId = string
/** A registered local installation. */
export type DeviceId = string
/** A bounded, revocable authenticated context on one device. */
export type SessionId = string
/** One durable unit of work. Stable across clients and restarts. */
export type TaskId = string
/** One end-to-end request chain (client → backend → provider). */
export type CorrelationId = string
/** One append-only journal entry. */
export type EventId = string
/** One approval object issued by the authorization system. */
export type ApprovalId = string
/** One OS/privileged operation the task is asking authority to perform. */
export type OperationId = string

/** Identity of the client making a request. A request is always attributed. */
export type ClientKind = 'cli' | 'website' | 'aria' | 'desktop' | 'gui'

// ---------------------------------------------------------------------------
// 2. Error model
//
// The distinction that matters: a failure is reported as *what actually
// failed*, never collapsed into "model failed". "Authentication expired" and
// "device revoked" are different recoveries from "provider down", and once the
// website and Aria share the task system, a misclassification is a wrong
// instruction to a user on a different surface.
// ---------------------------------------------------------------------------

export type DirectionerErrorCode =
  // Identity / session
  | 'AUTH_REQUIRED'
  | 'AUTH_EXPIRED'
  | 'DEVICE_REVOKED'
  | 'SESSION_REVOKED'
  // Backend / service reachability
  | 'BACKEND_UNAVAILABLE'
  | 'MODEL_SERVICE_UNAVAILABLE'
  | 'UNSUPPORTED_VERSION'
  // Authorization / entitlement / limits
  | 'ENTITLEMENT_DENIED'
  | 'RATE_LIMITED'
  | 'APPROVAL_REQUIRED'
  // Task / sync
  | 'TASK_NOT_FOUND'
  | 'TASK_STATE_INVALID'
  | 'SYNC_FAILED'
  | 'LOCAL_EXECUTION_FAILED'

/**
 * The recovery a caller should attempt, derived from the code rather than
 * re-derived at each call site. Keeping it here stops two surfaces from
 * disagreeing about whether `AUTH_EXPIRED` is "retry" or "re-login".
 */
export type DirectionerErrorRecovery =
  | 'authenticate' // needs a human sign-in
  | 'register_device' // needs device pairing
  | 'retry' // transient; safe to retry
  | 'wait' // rate limited; retry after a delay
  | 'upgrade' // entitlement
  | 'resync' // re-run sync
  | 'fatal' // no automatic recovery

const ERROR_RECOVERY: Record<DirectionerErrorCode, DirectionerErrorRecovery> = {
  AUTH_REQUIRED: 'authenticate',
  AUTH_EXPIRED: 'authenticate',
  DEVICE_REVOKED: 'register_device',
  SESSION_REVOKED: 'authenticate',
  BACKEND_UNAVAILABLE: 'retry',
  MODEL_SERVICE_UNAVAILABLE: 'retry',
  UNSUPPORTED_VERSION: 'fatal',
  ENTITLEMENT_DENIED: 'upgrade',
  RATE_LIMITED: 'wait',
  APPROVAL_REQUIRED: 'fatal',
  TASK_NOT_FOUND: 'fatal',
  TASK_STATE_INVALID: 'fatal',
  SYNC_FAILED: 'resync',
  LOCAL_EXECUTION_FAILED: 'fatal',
}

export function recoveryForError(
  code: DirectionerErrorCode,
): DirectionerErrorRecovery {
  return ERROR_RECOVERY[code]
}

/**
 * A classified failure. `message` is user-facing and must never contain a
 * secret or a raw provider payload. `retryable` is true only when a blind
 * retry is safe; `RATE_LIMITED` is retryable *after* `retryAfterMs`.
 */
export interface DirectionerServiceError {
  code: DirectionerErrorCode
  /** Human-facing, already safe to display. */
  message: string
  retryable: boolean
  /** Present for RATE_LIMITED. */
  retryAfterMs?: number
  /** Correlation id, for support — never content. */
  correlationId?: CorrelationId
}

/**
 * Classify an error code into a `DirectionerServiceError`. Pure; the caller
 * supplies the message so the copy stays at the surface where it is shown.
 */
export function classifyError(
  code: DirectionerErrorCode,
  message: string,
  opts?: { retryAfterMs?: number; correlationId?: CorrelationId },
): DirectionerServiceError {
  const recovery = recoveryForError(code)
  return {
    code,
    message,
    retryable: recovery === 'retry' || recovery === 'wait',
    retryAfterMs: opts?.retryAfterMs,
    correlationId: opts?.correlationId,
  }
}

// ---------------------------------------------------------------------------
// 3. Account / device / session
//
// Authentication is a browser/device-authorization flow. The CLI never asks
// the user to paste an account secret, never copies a browser token by hand,
// and never stores a permanent raw secret. The refresh credential, once it
// exists, belongs in OS secure storage — a reference to it, not the value,
// belongs in the local database.
// ---------------------------------------------------------------------------

export interface DirectionerAccount {
  accountId: AccountId
  userId: UserId
  /** Display only. Not an identity. */
  displayName?: string
}

export type DeviceRegistrationState =
  | 'unregistered'
  | 'pending_pairing'
  | 'active'
  | 'suspended'
  | 'revoked'

export interface DirectionerDevice {
  deviceId: DeviceId
  accountId: AccountId
  state: DeviceRegistrationState
  /** Free-form, user-visible label, e.g. a hostname. */
  label?: string
  registeredAt?: string
}

export type SessionState = 'active' | 'expired' | 'revoked'

export interface DirectionerSession {
  sessionId: SessionId
  deviceId: DeviceId
  accountId: AccountId
  state: SessionState
  /** ISO-8601. Access tokens are short-lived; this is not a refresh lifetime. */
  expiresAt: string
}

/**
 * A device-authorization grant, as the CLI sees it. The CLI displays
 * `userCode` and opens `verificationUrl`; it then polls `status`. It never
 * receives the user's account password.
 */
export interface DeviceAuthorizationGrant {
  /** Short code the user types on the website. */
  userCode: string
  /** Where the user approves the device. */
  verificationUrl: string
  /** ISO-8601. The grant is refused after this. */
  expiresAt: string
}

export type DeviceAuthorizationStatus =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'expired'

// ---------------------------------------------------------------------------
// 4. Task / session / event
//
// ONE task model. The terminal, the website, and a future Aria all drive the
// same objects. There is deliberately no "CLI task" versus "website task".
// ---------------------------------------------------------------------------

/**
 * A workspace pins what a task was planned against, so a resume after the
 * repository changed is detected rather than applied blindly.
 */
export interface WorkspaceRef {
  /** Repository root as the task saw it. */
  path: string
  /** Opaque repository identity, so a moved/renamed repo is still the same. */
  repositoryId?: string
  branch?: string
  worktree?: string
}

export type TaskState =
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

export interface DirectionerTask {
  taskId: TaskId
  accountId: AccountId
  deviceId: DeviceId
  sessionId: SessionId
  /** The natural-language request, as the user made it. */
  request: string
  workspace: WorkspaceRef
  state: TaskState
  createdAt: string
  updatedAt: string
}

/**
 * Event types. Append-only; an event is immutable once written. The list is
 * the initial vocabulary, not a closed set — consumers ignore unknown types
 * rather than failing.
 */
export type TaskEventType =
  | 'task.created'
  | 'task.started'
  | 'task.paused'
  | 'task.resumed'
  | 'task.updated'
  | 'task.cancelled'
  | 'task.failed'
  | 'task.recovered'
  | 'task.completed'
  | 'model.requested'
  | 'model.stream_started'
  | 'model.stream_ended'
  | 'tool.requested'
  | 'tool.started'
  | 'tool.completed'
  | 'file.changed'
  | 'command.started'
  | 'command.completed'
  | 'approval.requested'
  | 'approval.granted'
  | 'approval.denied'
  | 'device.registered'
  | 'session.started'
  | 'session.revoked'
  | 'security.event'

/**
 * One journal entry. `sequence` is monotonic per task (not wall clock), which
 * is what makes ordering and gap detection possible during sync. `payload` is
 * type-specific and small; it is never a dumping ground for conversation JSON.
 */
export interface TaskEvent {
  eventId: EventId
  taskId: TaskId
  /** Monotonic per task. The sync cursor is built from this. */
  sequence: number
  type: TaskEventType
  timestamp: string
  correlationId: CorrelationId
  /** Stable key so a duplicate delivery is idempotent at the backend. */
  idempotencyKey: string
  payload?: Record<string, unknown>
}

/** A message the user or the agent added to a task. */
export interface TaskMessage {
  taskId: TaskId
  role: 'user' | 'agent' | 'system'
  content: string
  createdAt: string
}

// ---------------------------------------------------------------------------
// 5. Approvals
//
// An approval is an object, not a string. It binds to one operation and a
// scope, and it expires. "The user said yes once" is not a session-wide grant.
// Only the authorization system issues one; a client may only *submit the
// user's decision* about an existing approval.
// ---------------------------------------------------------------------------

export type RiskTier = 'low' | 'medium' | 'high' | 'critical'

export interface ApprovalRequest {
  approvalId: ApprovalId
  taskId: TaskId
  operationId: OperationId
  riskTier: RiskTier
  /** What the approval covers. Never "everything". */
  scope: string
  requestedAt: string
  expiresAt: string
}

export type ApprovalDecision = 'granted' | 'denied'

/**
 * Who decided. Recorded so "the user approved this" is auditable and cannot be
 * asserted anonymously by a repository, a model, or an MCP server.
 */
export type ApprovalDecisionSource = 'user' | 'policy' | 'timeout'

export interface ApprovalRecord extends ApprovalRequest {
  decision: ApprovalDecision
  decisionSource: ApprovalDecisionSource
  decidedAt: string
}

// ---------------------------------------------------------------------------
// 6. Model / service request — provider-neutral
//
// The client requests a *capability*. The backend chooses provider, model,
// fallback, routing, cost, and rate limit. The client must never need to know
// any of those, and must never construct a provider URL.
// ---------------------------------------------------------------------------

export type ModelCapability =
  | 'text'
  | 'tool_calling'
  | 'structured_output'
  | 'streaming'
  | 'vision'
  | 'large_context'
  | 'reasoning'
  | 'code_generation'
  | 'embeddings'

/**
 * A request for Directioner model service. It names capabilities and a
 * preference, never a vendor or a model id. `prefer` is a hint the backend may
 * ignore; it cannot override entitlement, health, or cost policy.
 */
export interface ModelServiceRequest {
  capabilities: ModelCapability[]
  prefer?: {
    /** e.g. 'low_cost' | 'low_latency' — backend-defined vocabulary. */
    profile?: string
    /** Requested context size; the backend may refuse or downgrade. */
    minContextTokens?: number
  }
}

/**
 * What the backend is willing to serve. `modelLabel` is a Directioner-facing
 * label for display; it is not a provider model id and the client must not
 * parse it.
 */
export interface ModelServiceGrant {
  /** Opaque handle for this grant. */
  grantId: string
  capabilities: ModelCapability[]
  /** Display label only. Not a provider model id. */
  modelLabel: string
  /** Whether this request will be metered against entitlement/quota. */
  metered: boolean
}

// ---------------------------------------------------------------------------
// 7. Entitlements
//
// Authentication, authorization, entitlement, and billing are four separate
// decisions. The client displays them; the backend enforces them. A value here
// is a cache and is never authority.
// ---------------------------------------------------------------------------

export interface DirectionerEntitlements {
  accountId: AccountId
  /** Capabilities the account may request. */
  allowedCapabilities: ModelCapability[]
  /** Whether a subscription is active. Not the same as "authenticated". */
  subscriptionActive: boolean
  /** Remaining quota, as the backend last reported it. Advisory. */
  remainingQuota?: number
  /** ISO-8601, when the backend value was read. */
  asOf: string
}

// ---------------------------------------------------------------------------
// 8. Local state and sync
//
// The local client keeps a durable journal and cache. The local database is a
// cache and a record, never an authority: nothing in it can authorize an
// action, and a tampered local counter grants nothing.
// ---------------------------------------------------------------------------

/** Per-datum classification. Decides where a datum may go. */
export type DataClassification =
  | 'LOCAL_ONLY'
  | 'SYNC_METADATA'
  | 'CLOUD_ALLOWED'
  | 'EXPLICIT_USER_UPLOAD'
  | 'SECRET'

/** The local tables the future implementation will use (see architecture §12). */
export type LocalStateTable =
  | 'migrations'
  | 'account'
  | 'device'
  | 'session'
  | 'task'
  | 'task_event'
  | 'workspace'
  | 'approval'
  | 'tool_execution'
  | 'provider_state'
  | 'sync_cursor'
  | 'local_action_log'

/**
 * Sync state for one task. `acknowledgedThrough` is the highest event
 * `sequence` the backend has confirmed; anything above it is pending.
 */
export interface SyncState {
  taskId: TaskId
  acknowledgedThrough: number
  pendingCount: number
  /** Last sync failure, if any. Present so "queued" is never shown as "done". */
  lastError?: DirectionerServiceError
}

/**
 * The outcome of an operation, distinguished so a queued request is never
 * reported as a completed one.
 */
export type OperationOutcome<T> =
  | { status: 'ok'; value: T }
  | { status: 'queued'; value: T; sync: SyncState }
  | { status: 'failed'; error: DirectionerServiceError }

/**
 * Whether an operation needs the cloud. Local-only operations must keep
 * working offline; cloud-dependent ones must fail with a named reason.
 */
export type OperationDependency = 'local_only' | 'cloud_required'

// ---------------------------------------------------------------------------
// 9. The client contract
//
// This is the interface the CLI application layer depends on. It is
// provider-neutral by construction: no method names a vendor, and no method
// returns a provider URL or credential.
//
// IMPLEMENTATION STATE: not implemented. There is no backend and no HTTP
// client here. A future adapter implements this interface against the real
// Directioner backend; a development-only adapter may implement the BYOK path
// separately. Nothing in this file connects to anything.
// ---------------------------------------------------------------------------

export interface DirectionerClient {
  // --- identity ---------------------------------------------------------
  /** Begin a device-authorization sign-in; returns what to show the user. */
  authenticate(): Promise<OperationOutcome<DeviceAuthorizationGrant>>
  /** Poll a pending device-authorization grant. */
  pollDeviceAuthorization(
    userCode: string,
  ): Promise<OperationOutcome<DeviceAuthorizationStatus>>
  /** Register this installation once the user has approved it. */
  registerDevice(label?: string): Promise<OperationOutcome<DirectionerDevice>>
  /** The signed-in account, or a failure if not authenticated. */
  getAccount(): Promise<OperationOutcome<DirectionerAccount>>
  /** Current session, or a failure classified as AUTH_REQUIRED/EXPIRED. */
  getSession(): Promise<OperationOutcome<DirectionerSession>>
  /** End the session locally and revoke it server-side. */
  logout(): Promise<OperationOutcome<void>>
  /** Whether this device is still trusted (false → DEVICE_REVOKED). */
  isDeviceActive(): Promise<OperationOutcome<boolean>>

  // --- entitlements -----------------------------------------------------
  getEntitlements(): Promise<OperationOutcome<DirectionerEntitlements>>

  // --- model service ----------------------------------------------------
  /**
   * Ask the backend what it will serve for a capability request. The client
   * never chooses a provider or a model id.
   */
  requestModelService(
    request: ModelServiceRequest,
  ): Promise<OperationOutcome<ModelServiceGrant>>

  // --- tasks ------------------------------------------------------------
  createTask(request: {
    request: string
    workspace: WorkspaceRef
  }): Promise<OperationOutcome<DirectionerTask>>
  sendTaskInput(input: {
    taskId: TaskId
    message: string
  }): Promise<OperationOutcome<TaskMessage>>
  getTask(taskId: TaskId): Promise<OperationOutcome<DirectionerTask>>
  getTaskEvents(taskId: TaskId, sinceSequence?: number): Promise<
    OperationOutcome<{ events: TaskEvent[]; sync: SyncState }>
  >
  cancelTask(taskId: TaskId): Promise<OperationOutcome<DirectionerTask>>

  // --- approvals --------------------------------------------------------
  /**
   * Submit the *user's* decision about an existing approval. This is the only
   * way an approval is decided; a client cannot create one.
   */
  submitApproval(decision: {
    approvalId: ApprovalId
    decision: ApprovalDecision
  }): Promise<OperationOutcome<ApprovalRecord>>

  // --- sync -------------------------------------------------------------
  /** Push unacknowledged local events and pull backend state. */
  syncEvents(taskId: TaskId): Promise<OperationOutcome<SyncState>>
}
