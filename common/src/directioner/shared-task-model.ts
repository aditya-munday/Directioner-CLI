/**
 * Shared Directioner task / session / event model — provider- and client-neutral.
 *
 * WHY THIS FILE EXISTS
 *
 * The terminal, the website, and Aria must drive *one* logical task, not three
 * incompatible task engines. `platform-contract.ts` defines the shapes; this
 * module defines the *behaviour* those shapes need to interoperate safely:
 * how an event mutates a task, what a duplicate or a stale event does, what a
 * cancellation request actually proves, and how an approval is bound to the
 * task it was issued for.
 *
 * It is deliberately pure: no I/O, no clock beyond what is passed in, no
 * network. It reuses the real vocabulary from `platform-contract.ts` rather
 * than inventing a second one. It is the client-side core that a future real
 * adapter — and an Aria-originated request after it is validated by the
 * backend — both reduce to.
 *
 * THE RULES
 *
 *   1. Direct CLI work is first-class. A task has no required Aria session,
 *      conversation id, or voice connection; `origin` may be `'cli'` and
 *      `sessionId`/`deviceId` may be absent.
 *   2. An event is applied at most once. Same `eventId`, or a `sequence` at or
 *      below the high-water mark, is a duplicate or stale — never a new state.
 *   3. A stale event never overwrites newer authoritative state, and never
 *      revives a terminal task.
 *   4. A cancellation *request* is not proof the work stopped. Only a
 *      `task.cancelled` event confirms it; a completion that beats the request
 *      is reported as completed-with-pending-request, not as cancelled.
 *   5. An acknowledgement is not a result. Receiving `approval.granted` never
 *      by itself makes a task `completed`; a `verification` verdict is the only
 *      thing that confirms an effect.
 *   6. An approval binds to one task and one operation. It cannot be replayed
 *      onto another task, and text claiming approval is not an approval.
 *   7. Receiving an event never executes anything. This module has no executor.
 */

import type {
  AccountId,
  ApprovalDecision,
  ApprovalId,
  ApprovalRecord,
  ClientKind,
  DeviceId,
  EventId,
  OperationId,
  SessionId,
  TaskEvent,
  TaskEventType,
  TaskId,
  TaskState,
} from './platform-contract'

// ---------------------------------------------------------------------------
// 1. Task identity — direct CLI work carries no Aria session
// ---------------------------------------------------------------------------

/**
 * Where a task came from. `'cli'` and `'aria'` drive the *same* model; the
 * origin is metadata, never a routing authority.
 */
export type TaskOrigin = ClientKind

export interface SharedTask {
  taskId: TaskId
  accountId: AccountId
  /** Absent for purely local CLI work with no cloud identity yet. */
  deviceId?: DeviceId
  /** Absent unless the task is bound to an authenticated session. */
  sessionId?: SessionId
  /** Which client created it. Metadata only. */
  origin: TaskOrigin
  /**
   * The originating Aria/website conversation, when there is one. Optional by
   * construction: a CLI task must not require it.
   */
  conversationId?: string
  request: string
  state: TaskState
  /** Monotonic per task; the event high-water mark this view reflects. */
  lastSequence: number
  /** The contract version this task was created under. */
  contractVersion: string
  createdAt: string
  updatedAt: string
  /** Operations this task has proposed, for audit — not for authorization. */
  operationRefs: readonly OperationId[]
  /** Approvals issued for this task, by id. */
  approvalRefs: readonly ApprovalId[]
}

/**
 * A request to create a task, however it arrived. `origin` distinguishes a
 * direct CLI task from an Aria-originated one, but nothing else about the model
 * changes: both produce the same `SharedTask`.
 */
export interface CreateTaskInput {
  taskId: TaskId
  accountId: AccountId
  origin: TaskOrigin
  request: string
  contractVersion: string
  now: string
  deviceId?: DeviceId
  sessionId?: SessionId
  conversationId?: string
}

export function createSharedTask(input: CreateTaskInput): SharedTask {
  return {
    taskId: input.taskId,
    accountId: input.accountId,
    ...(input.deviceId !== undefined ? { deviceId: input.deviceId } : {}),
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
    origin: input.origin,
    ...(input.conversationId !== undefined
      ? { conversationId: input.conversationId }
      : {}),
    request: input.request,
    state: 'created',
    lastSequence: 0,
    contractVersion: input.contractVersion,
    createdAt: input.now,
    updatedAt: input.now,
    operationRefs: [],
    approvalRefs: [],
  }
}

/**
 * A task may only be claimed by its owning account. `deviceAccountId` must be
 * a server-side lookup, never a request field, so a spoofed device id cannot
 * become authority.
 */
export function assertTaskOwnership(
  taskAccountId: AccountId,
  principalAccountId: AccountId,
): void {
  if (taskAccountId !== principalAccountId) {
    // Not-found semantics, matching the backend: do not confirm existence of
    // another tenant's task.
    throw new Error('Task not found.')
  }
}

// ---------------------------------------------------------------------------
// 2. Device routing — an id is not a token
// ---------------------------------------------------------------------------

export interface DeviceBinding {
  deviceId: DeviceId
  accountId: AccountId
  clientKind: ClientKind
  revoked: boolean
}

export type RoutingDecision =
  | { ok: true }
  | { ok: false; reason: 'account_mismatch' | 'device_revoked' }

/**
 * Whether a task may be routed to a device. Authorization is derived from the
 * *verified* account on both sides plus revocation state — never from a device
 * id supplied in a request. A revoked device receives no new authorized work.
 */
export function canRouteToDevice(
  taskAccountId: AccountId,
  device: DeviceBinding,
): RoutingDecision {
  if (device.accountId !== taskAccountId) {
    return { ok: false, reason: 'account_mismatch' }
  }
  if (device.revoked) {
    return { ok: false, reason: 'device_revoked' }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// 3. Event application — idempotent, order-aware, terminal-sticky
// ---------------------------------------------------------------------------

export type CancellationState =
  | 'none'
  | 'requested'
  | 'confirmed'
  | 'unknown'

export type VerificationState =
  | 'unverified'
  | 'confirmed'
  | 'not_confirmed'
  | 'inconclusive'

/**
 * The projection of a task from its event journal. This is a *view*: it is
 * rebuilt by folding events, and it records how much of the journal it has seen
 * so a gap (partial stream) is distinguishable from a complete one.
 */
export interface TaskProjection {
  taskId: TaskId
  state: TaskState
  /** Highest event sequence folded in. */
  lastSequence: number
  /** True when a sequence gap was observed; the view may be incomplete. */
  partial: boolean
  cancellation: CancellationState
  verification: VerificationState
  /** Sequence of the first terminal event, if the task has ended. */
  terminalSequence?: number
  updatedAt: string
  /** Applied event ids, so a redelivery is a no-op. */
  readonly seenEventIds: ReadonlySet<EventId>
  /** Applied idempotency keys, for deliveries that reuse a key but not an id. */
  readonly seenKeys: ReadonlySet<string>
}

export function projectTask(task: SharedTask): TaskProjection {
  return {
    taskId: task.taskId,
    state: task.state,
    lastSequence: task.lastSequence,
    partial: false,
    cancellation: 'none',
    verification: 'unverified',
    updatedAt: task.updatedAt,
    seenEventIds: new Set(),
    seenKeys: new Set(),
  }
}

export type EventApplyOutcome =
  /** A newer event advanced the projection. */
  | { kind: 'applied'; projection: TaskProjection }
  /** The exact event (or key) was already applied; no change. */
  | { kind: 'duplicate'; projection: TaskProjection }
  /** Older than the high-water mark: ignored; state is unchanged. */
  | { kind: 'out_of_order'; projection: TaskProjection; reason: string }
  /** Structurally unacceptable (wrong task, illegal move). Unchanged. */
  | { kind: 'rejected'; projection: TaskProjection; reason: string }

const TERMINAL_STATES: ReadonlySet<TaskState> = new Set([
  'completed',
  'cancelled',
  'failed',
])

export function isTerminal(state: TaskState): boolean {
  return TERMINAL_STATES.has(state)
}

/** The state a lifecycle event moves the task to, or `null` for metadata events. */
function lifecycleTarget(type: TaskEventType): TaskState | null {
  switch (type) {
    case 'task.created':
      return 'created'
    case 'task.started':
      return 'running'
    case 'task.paused':
      return 'paused'
    case 'task.resumed':
      return 'running'
    case 'task.recovered':
      return 'recovering'
    case 'task.completed':
      return 'completed'
    case 'task.failed':
      return 'failed'
    case 'task.cancelled':
      return 'cancelled'
    default:
      return null
  }
}

/**
 * Fold one event into a projection.
 *
 * Order of checks matters: identity → duplicate → stale → terminal → apply.
 * A duplicate is recognised by event id *or* idempotency key, so both a
 * redelivery and a key-reusing retry are no-ops.
 */
export function applyEvent(
  projection: TaskProjection,
  event: TaskEvent,
): EventApplyOutcome {
  if (event.taskId !== projection.taskId) {
    return { kind: 'rejected', projection, reason: 'event belongs to another task' }
  }
  if (
    projection.seenEventIds.has(event.eventId) ||
    projection.seenKeys.has(event.idempotencyKey)
  ) {
    return { kind: 'duplicate', projection }
  }
  // Stale: at or below the high-water mark. Never overwrites newer state.
  if (event.sequence <= projection.lastSequence) {
    return {
      kind: 'out_of_order',
      projection,
      reason: `event sequence ${event.sequence} <= high-water ${projection.lastSequence}`,
    }
  }
  // A terminal task is closed; a later event cannot reopen it or change it.
  if (isTerminal(projection.state)) {
    return {
      kind: 'rejected',
      projection,
      reason: `task is terminal (${projection.state}); a later event cannot reopen it`,
    }
  }

  // A gap means we did not see every prior event — the stream is partial.
  const gapDetected = event.sequence > projection.lastSequence + 1

  const seenEventIds = new Set(projection.seenEventIds)
  seenEventIds.add(event.eventId)
  const seenKeys = new Set(projection.seenKeys)
  seenKeys.add(event.idempotencyKey)

  let state = projection.state
  let cancellation = projection.cancellation
  let verification = projection.verification
  let terminalSequence = projection.terminalSequence

  const target = lifecycleTarget(event.type)
  if (target !== null) {
    state = target
  }

  // An acknowledgement is not a result: approval events never complete a task.
  if (event.type === 'approval.granted' || event.type === 'approval.denied') {
    // approval.granted is recorded elsewhere; it never implies completion.
  }
  if (event.type === 'task.cancelled') {
    cancellation = 'confirmed'
  }
  // A completion that lands while a cancel was requested: the task completed,
  // the request did not take effect. Report both facts, not a false "cancelled".
  if (event.type === 'task.completed' && projection.cancellation === 'requested') {
    cancellation = 'unknown'
  }
  if (isTerminal(state)) {
    terminalSequence = event.sequence
  }

  return {
    kind: 'applied',
    projection: {
      ...projection,
      state,
      lastSequence: event.sequence,
      partial: gapDetected,
      cancellation,
      verification,
      ...(terminalSequence !== undefined ? { terminalSequence } : {}),
      updatedAt: event.timestamp,
      seenEventIds,
      seenKeys,
    },
  }
}

/** Fold a whole journal in order. Convenience for rebuilding a view. */
export function projectEvents(
  task: SharedTask,
  events: readonly TaskEvent[],
): TaskProjection {
  let projection = projectTask(task)
  for (const event of events) {
    const outcome = applyEvent(projection, event)
    projection = outcome.projection
  }
  return projection
}

// ---------------------------------------------------------------------------
// 4. Cancellation — a request is not a result
// ---------------------------------------------------------------------------

export type CancellationRequestOutcome =
  | { ok: true; projection: TaskProjection }
  | { ok: false; reason: 'already_terminal' | 'already_requested' }

/**
 * Record that a cancellation was *requested*. This does not and cannot assert
 * that the work stopped — only a `task.cancelled` event does that. It moves a
 * running task to `cancelling` and nothing else.
 */
export function requestCancellation(
  projection: TaskProjection,
  _now: string,
): CancellationRequestOutcome {
  if (isTerminal(projection.state)) {
    return { ok: false, reason: 'already_terminal' }
  }
  if (projection.cancellation === 'requested') {
    return { ok: false, reason: 'already_requested' }
  }
  return {
    ok: true,
    projection: {
      ...projection,
      state: 'cancelling',
      cancellation: 'requested',
    },
  }
}

// ---------------------------------------------------------------------------
// 5. Verification — absence of evidence is not success
// ---------------------------------------------------------------------------

export type VerificationVerdict = 'confirmed' | 'not_confirmed' | 'inconclusive'

/**
 * Apply a verification verdict. Only `confirmed` marks the effect as proven;
 * a missing or unreadable check is `inconclusive`, never `confirmed`. This
 * mirrors the operation-boundary rule.
 */
export function applyVerification(
  projection: TaskProjection,
  verdict: VerificationVerdict,
): TaskProjection {
  const verification: VerificationState =
    verdict === 'confirmed'
      ? 'confirmed'
      : verdict === 'not_confirmed'
        ? 'not_confirmed'
        : 'inconclusive'
  return { ...projection, verification }
}

// ---------------------------------------------------------------------------
// 6. Approval binding — one approval, one task, one operation
// ---------------------------------------------------------------------------

export type ApprovalBindingResult =
  | { ok: true }
  | {
      ok: false
      reason:
        | 'wrong_task'
        | 'wrong_operation'
        | 'scope_mismatch'
        | 'not_granted'
        | 'expired'
    }

/**
 * A clock the caller must supply from trusted state — its own wall clock, never
 * a timestamp carried inside the event or approval being judged. If the gate
 * read `approval.expiresAt` against a "now" the input could set, the input
 * could keep a stale approval alive indefinitely.
 */
export interface TrustedClock {
  now: string
}

function isAfter(instant: string, reference: string): boolean {
  const a = Date.parse(instant)
  const b = Date.parse(reference)
  if (Number.isNaN(a) || Number.isNaN(b)) return false
  return a > b
}

/**
 * Whether an approval record authorizes a specific operation on a specific
 * task. An approval issued for task A cannot be presented for task B, and one
 * issued for operation X cannot authorize operation Y. This is the client-side
 * half of the same rule the operation boundary enforces.
 *
 * `clock` is required so the expiry check uses the caller's trusted wall clock,
 * not a timestamp an attacker could put in the approval. An approval that was
 * never granted does not authorize, and neither does one whose `expiresAt` has
 * passed. Callers that predate the clock can read `approval.expiresAt` and pass
 * the same string they would have used.
 */
export function assertApprovalBinding(
  approval: ApprovalRecord,
  taskId: TaskId,
  operationId: OperationId,
  scope: string,
  clock: TrustedClock,
): ApprovalBindingResult {
  if (approval.taskId !== taskId) {
    return { ok: false, reason: 'wrong_task' }
  }
  if (approval.operationId !== operationId) {
    return { ok: false, reason: 'wrong_operation' }
  }
  if (approval.scope !== scope) {
    return { ok: false, reason: 'scope_mismatch' }
  }
  // An approval is only authority once the user granted it. A pending request,
  // or one policy denied, is not authorization.
  if (approval.decision !== 'granted') {
    return { ok: false, reason: 'not_granted' }
  }
  // Expiry: time outranks the grant. A granted approval past `expiresAt` is
  // spent, however it is presented.
  if (approval.expiresAt && isAfter(clock.now, approval.expiresAt)) {
    return { ok: false, reason: 'expired' }
  }
  return { ok: true }
}

/**
 * Text is never authority. This helper exists so call sites can be explicit:
 * it always returns `false`. A transcript, a model message, or a tool result
 * is not an approval object, however it is worded.
 */
export function isTextAnApproval(_text: string): false {
  return false
}

/**
 * A client may only *record the user's decision* about an approval that
 * already exists; it may never fabricate one. This mirrors the platform
 * contract: approvals are issued by the authorization system.
 */
export function recordApprovalDecision(
  approval: ApprovalRecord,
  decision: ApprovalDecision,
  decidedAt: string,
): ApprovalRecord {
  if (approval.decidedAt !== '') {
    throw new Error('Approval has already been decided.')
  }
  return {
    ...approval,
    decision,
    decisionSource: 'user',
    decidedAt,
  }
}

// ---------------------------------------------------------------------------
// 7. Error taxonomy for the shared client
// ---------------------------------------------------------------------------

/**
 * Failure kinds a cross-client operation can produce. Each is a distinct
 * recovery, so a caller never has to guess whether to re-authenticate, retry,
 * or stop. These names are the client's; the wire codes they map from live in
 * `platform-contract.ts`.
 */
export type SharedClientErrorKind =
  | 'authentication_required'
  | 'session_expired'
  | 'device_revoked'
  | 'backend_unavailable'
  | 'task_not_found'
  | 'session_not_found'
  | 'contract_version_unsupported'
  | 'invalid_state_transition'
  | 'duplicate_operation'
  | 'approval_required'
  | 'authorization_denied'
  | 'task_cancelled'
  | 'task_interrupted'
  | 'os_integration_unavailable'
  | 'verification_unavailable'
  | 'result_uncertain'
  | 'malformed_event'

export type SharedClientRecovery =
  | 'authenticate'
  | 'register_device'
  | 'retry'
  | 'wait'
  | 'resync'
  | 'report'
  | 'stop'

const ERROR_RECOVERY: Record<SharedClientErrorKind, SharedClientRecovery> = {
  authentication_required: 'authenticate',
  session_expired: 'authenticate',
  device_revoked: 'register_device',
  backend_unavailable: 'retry',
  task_not_found: 'stop',
  session_not_found: 'authenticate',
  contract_version_unsupported: 'stop',
  invalid_state_transition: 'stop',
  duplicate_operation: 'stop',
  approval_required: 'report',
  authorization_denied: 'stop',
  task_cancelled: 'stop',
  task_interrupted: 'resync',
  os_integration_unavailable: 'report',
  verification_unavailable: 'report',
  result_uncertain: 'resync',
  malformed_event: 'report',
}

export function recoveryForSharedError(kind: SharedClientErrorKind): SharedClientRecovery {
  return ERROR_RECOVERY[kind]
}

// ---------------------------------------------------------------------------
// 8. Privacy — metadata may sync, content may not
// ---------------------------------------------------------------------------

/**
 * The event payload fields the shared model is permitted to carry. Conversation
 * text, transcripts, and audio belong to the client's local store under its own
 * retention policy (Aria's SQLite purge); they must never ride the shared
 * metadata stream. This list is a guard, not a schema: `assertMetadataPayload`
 * rejects a payload that tries to smuggle content.
 */
const FORBIDDEN_PAYLOAD_KEYS: ReadonlySet<string> = new Set([
  'transcript',
  'audio',
  'audioBytes',
  'rawPrompt',
  'conversation',
  'messages',
])

export type PayloadCheck =
  | { ok: true }
  | { ok: false; reason: string }

/**
 * Reject a shared-metadata payload that carries conversation content. Task and
 * event metadata is synchronizable; transcripts and audio are not. This keeps
 * the shared model from silently making every voice transcript persistent.
 */
export function assertMetadataPayload(payload: Record<string, unknown>): PayloadCheck {
  for (const key of Object.keys(payload)) {
    if (FORBIDDEN_PAYLOAD_KEYS.has(key)) {
      return {
        ok: false,
        reason: `payload key '${key}' is conversation content and must not be synced`,
      }
    }
  }
  return { ok: true }
}
