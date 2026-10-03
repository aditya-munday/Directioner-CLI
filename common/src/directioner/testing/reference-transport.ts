/**
 * TEST-ONLY reference transport for the Directioner platform contract.
 *
 * ---------------------------------------------------------------------------
 * THIS IS NOT A BACKEND. THIS IS NOT PRODUCTION CODE.
 * ---------------------------------------------------------------------------
 *
 * There is no Directioner backend. This file exists so the client-side half of
 * `platform-contract.ts` can be exercised end-to-end — schema, lifecycle,
 * error classification, idempotency — before the real service exists. It is an
 * in-memory deterministic double. It opens no socket, holds no credential,
 * names no provider, and is not exported from any production entry point.
 *
 * Isolation rules, enforced by `reference-transport.test.ts`:
 *
 *   - It lives under `directioner/testing/`, which production code must not
 *     import. Nothing in `cli/`, `sdk/`, or `packages/` may import it.
 *   - Its device-authorization grant uses an obviously fake code and the
 *     `example.invalid` TLD (RFC 2606), so it can never resolve and can never
 *     be mistaken for a live URL.
 *   - Every provider-ish value is a Directioner-facing label, never a vendor.
 *
 * What it DOES prove (and therefore what a real adapter must also satisfy):
 *   - the `DirectionerClient` method set is complete and type-checks
 *   - task lifecycle transitions are explicit and invalid ones are rejected
 *   - events are append-only, monotonic, and idempotent by key
 *   - an approval cannot be forged by text, replayed, or widened
 *   - sync distinguishes "queued" from "done" and never collapses them
 *   - offline/cloud failure is a named error, not a silent success
 *
 * When the real backend lands, the adapter that talks to it must pass the same
 * contract tests this transport does. The transport is the executable spec.
 */

import {
  classifyError,
  type ApprovalDecision,
  type ApprovalRecord,
  type DeviceAuthorizationGrant,
  type DeviceAuthorizationStatus,
  type DirectionerAccount,
  type DirectionerClient,
  type DirectionerDevice,
  type DirectionerEntitlements,
  type DirectionerServiceError,
  type DirectionerSession,
  type DirectionerTask,
  type ModelServiceGrant,
  type ModelServiceRequest,
  type OperationOutcome,
  type RiskTier,
  type SyncState,
  type TaskEvent,
  type TaskEventType,
  type TaskMessage,
  type TaskState,
  type WorkspaceRef,
} from '../platform-contract'

/** Deterministic clock so ordering and expiry are testable without sleeping. */
export interface ReferenceClock {
  now(): number
}

export const SYSTEM_CLOCK: ReferenceClock = { now: () => Date.now() }

/**
 * Lifecycle transitions the contract allows. Anything not listed is rejected
 * with `TASK_STATE_INVALID` rather than silently applied — a state machine
 * that accepts every transition cannot tell "resumed" from "completed".
 *
 * Terminal states have no outgoing edges, except `failed`, which may recover.
 * A completed task is not reopened by a stray event; that is a new task.
 */
export const TASK_TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  created: ['queued', 'cancelling', 'failed'],
  queued: ['running', 'cancelling', 'failed'],
  running: [
    'waiting_for_user',
    'waiting_for_provider',
    'paused',
    'cancelling',
    'recovering',
    'completed',
    'failed',
  ],
  waiting_for_user: ['running', 'cancelling', 'failed'],
  waiting_for_provider: ['running', 'cancelling', 'failed'],
  paused: ['running', 'cancelling', 'failed'],
  cancelling: ['cancelled', 'failed'],
  cancelled: [],
  failed: ['recovering'],
  recovering: ['running', 'failed', 'cancelling'],
  completed: [],
}

export function canTransition(from: TaskState, to: TaskState): boolean {
  return TASK_TRANSITIONS[from].includes(to)
}

export interface ReferenceTransportOptions {
  clock?: ReferenceClock
  /** Access-token lifetime in ms; defaults to one hour. */
  sessionTtlMs?: number
  /** How long a device-authorization grant stays open. */
  deviceGrantTtlMs?: number
  /** How long an approval stays valid once requested. */
  approvalTtlMs?: number
  /**
   * When set, every cloud-dependent call fails with this error — the offline /
   * backend-down simulation. Local-only calls are unaffected, which is the
   * distinction the contract exists to make.
   */
  failCloudWith?: DirectionerServiceError
}

interface InternalState {
  account: DirectionerAccount | null
  device: DirectionerDevice | null
  session: DirectionerSession | null
  grant: {
    code: string
    expiresAt: number
    status: DeviceAuthorizationStatus
  } | null
  tasks: Map<string, DirectionerTask>
  events: Map<string, TaskEvent[]>
  /** idempotencyKey -> eventId, per task, so a duplicate delivery is a no-op. */
  eventKeys: Map<string, Map<string, string>>
  messages: Map<string, TaskMessage[]>
  approvals: Map<string, ApprovalRecord>
  sequence: Map<string, number>
}

const FAKE_VERIFICATION_URL = 'https://device.example.invalid/activate'
const FAKE_USER_CODE = 'TEST-CODE-0000'
const FAKE_ACCOUNT: DirectionerAccount = {
  accountId: 'acct_test_0000',
  userId: 'user_test_0000',
  displayName: 'Test Account',
}

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

function id(prefix: string, n: number): string {
  return `${prefix}_test_${String(n).padStart(4, '0')}`
}

/**
 * An in-memory, deterministic implementation of `DirectionerClient`.
 *
 * Not exported from any production barrel. Import it directly from
 * `directioner/testing/reference-transport` in tests only.
 */
export class ReferenceTransport implements DirectionerClient {
  private readonly clock: ReferenceClock
  private readonly sessionTtlMs: number
  private readonly deviceGrantTtlMs: number
  private readonly approvalTtlMs: number
  private failCloudWith?: DirectionerServiceError
  private readonly state: InternalState
  private counter = 0
  private taskCounter = 0
  private approvalCounter = 0

  constructor(options: ReferenceTransportOptions = {}) {
    this.clock = options.clock ?? SYSTEM_CLOCK
    this.sessionTtlMs = options.sessionTtlMs ?? 60 * 60 * 1000
    this.deviceGrantTtlMs = options.deviceGrantTtlMs ?? 15 * 60 * 1000
    this.approvalTtlMs = options.approvalTtlMs ?? 5 * 60 * 1000
    this.failCloudWith = options.failCloudWith
    this.state = {
      account: null,
      device: null,
      session: null,
      grant: null,
      tasks: new Map(),
      events: new Map(),
      eventKeys: new Map(),
      messages: new Map(),
      approvals: new Map(),
      sequence: new Map(),
    }
  }

  // --- test seams (not part of DirectionerClient) --------------------------

  /** Drive a task to an arbitrary state. Test-only; bypasses transitions. */
  __seedTaskState(taskId: string, state: TaskState): void {
    const task = this.state.tasks.get(taskId)
    if (!task) throw new Error(`no such task: ${taskId}`)
    task.state = state
    task.updatedAt = iso(this.clock.now())
  }

  /**
   * Request an approval for a task, as the backend would. Test-only.
   *
   * The returned/stored record is *undecided*: `decidedAt` is empty until
   * `submitApproval` records the user's decision. There is deliberately no
   * default "granted" — a request is not an approval.
   */
  __requestApproval(params: {
    taskId: string
    operationId: string
    scope: string
    riskTier?: RiskTier
  }): ApprovalRecord {
    this.approvalCounter += 1
    const now = this.clock.now()
    const request: ApprovalRecord = {
      approvalId: id('appr', this.approvalCounter),
      taskId: params.taskId,
      operationId: params.operationId,
      riskTier: params.riskTier ?? 'medium',
      scope: params.scope,
      requestedAt: iso(now),
      expiresAt: iso(now + this.approvalTtlMs),
      decision: 'denied',
      decisionSource: 'policy',
      decidedAt: '',
    }
    this.state.approvals.set(request.approvalId, request)
    this.appendEvent(params.taskId, 'approval.requested', {
      approvalId: request.approvalId,
      operationId: request.operationId,
      riskTier: request.riskTier,
    })
    return request
  }

  __getStoredApproval(approvalId: string): ApprovalRecord | undefined {
    return this.state.approvals.get(approvalId)
  }

  __taskEventCount(taskId: string): number {
    return this.state.events.get(taskId)?.length ?? 0
  }

  /** Test-only: simulate the user approving the device on the website. */
  __approveDeviceAuthorization(): void {
    if (this.state.grant) this.state.grant.status = 'approved'
  }

  /** Test-only: simulate the user denying the device. */
  __denyDeviceAuthorization(): void {
    if (this.state.grant) this.state.grant.status = 'denied'
  }

  /** Test-only: revoke the device server-side. */
  __revokeDevice(): void {
    if (this.state.device) this.state.device.state = 'revoked'
  }

  /** Test-only: expire the current session. */
  __expireSession(): void {
    if (this.state.session) {
      this.state.session.expiresAt = iso(this.clock.now() - 1)
    }
  }

  /**
   * Test-only: simulate the connection going away (or coming back) after the
   * session is already established. `failCloudWith` at construction models a
   * client that is offline before it ever signs in; this models losing the
   * network mid-session, which is the case the "queued vs done" distinction
   * exists for.
   */
  __setCloudFailure(error: DirectionerServiceError | undefined): void {
    this.failCloudWith = error
  }

  // --- identity ------------------------------------------------------------

  async authenticate(): Promise<OperationOutcome<DeviceAuthorizationGrant>> {
    const cloudFailure = this.cloudFailure()
    if (cloudFailure) return { status: 'failed', error: cloudFailure }
    const now = this.clock.now()
    this.state.grant = {
      code: FAKE_USER_CODE,
      expiresAt: now + this.deviceGrantTtlMs,
      status: 'pending',
    }
    return {
      status: 'ok',
      value: {
        userCode: FAKE_USER_CODE,
        verificationUrl: FAKE_VERIFICATION_URL,
        expiresAt: iso(now + this.deviceGrantTtlMs),
      },
    }
  }

  async pollDeviceAuthorization(
    userCode: string,
  ): Promise<OperationOutcome<DeviceAuthorizationStatus>> {
    const cloudFailure = this.cloudFailure()
    if (cloudFailure) return { status: 'failed', error: cloudFailure }
    const grant = this.state.grant
    if (!grant || grant.code !== userCode) {
      return {
        status: 'failed',
        error: classifyError('AUTH_REQUIRED', 'Unknown device code'),
      }
    }
    if (this.clock.now() >= grant.expiresAt) {
      grant.status = 'expired'
    }
    return { status: 'ok', value: grant.status }
  }

  async registerDevice(
    label?: string,
  ): Promise<OperationOutcome<DirectionerDevice>> {
    const cloudFailure = this.cloudFailure()
    if (cloudFailure) return { status: 'failed', error: cloudFailure }
    if (this.state.grant?.status !== 'approved') {
      return {
        status: 'failed',
        error: classifyError(
          'AUTH_REQUIRED',
          'Device authorization has not been approved',
        ),
      }
    }
    this.counter += 1
    const now = this.clock.now()
    this.state.account = FAKE_ACCOUNT
    this.state.device = {
      deviceId: id('device', this.counter),
      accountId: FAKE_ACCOUNT.accountId,
      state: 'active',
      label,
      registeredAt: iso(now),
    }
    this.state.session = {
      sessionId: id('sess', this.counter),
      deviceId: this.state.device.deviceId,
      accountId: FAKE_ACCOUNT.accountId,
      state: 'active',
      expiresAt: iso(now + this.sessionTtlMs),
    }
    return { status: 'ok', value: this.state.device }
  }

  async getAccount(): Promise<OperationOutcome<DirectionerAccount>> {
    const cloudFailure = this.cloudFailure()
    if (cloudFailure) return { status: 'failed', error: cloudFailure }
    if (!this.state.account) {
      return {
        status: 'failed',
        error: classifyError('AUTH_REQUIRED', 'Not signed in'),
      }
    }
    return { status: 'ok', value: this.state.account }
  }

  async getSession(): Promise<OperationOutcome<DirectionerSession>> {
    const cloudFailure = this.cloudFailure()
    if (cloudFailure) return { status: 'failed', error: cloudFailure }
    const session = this.state.session
    if (!session) {
      return {
        status: 'failed',
        error: classifyError('AUTH_REQUIRED', 'No session'),
      }
    }
    if (session.state === 'revoked') {
      return {
        status: 'failed',
        error: classifyError('SESSION_REVOKED', 'Session was revoked'),
      }
    }
    if (this.clock.now() >= Date.parse(session.expiresAt)) {
      session.state = 'expired'
      return {
        status: 'failed',
        error: classifyError('AUTH_EXPIRED', 'Session expired'),
      }
    }
    return { status: 'ok', value: session }
  }

  async logout(): Promise<OperationOutcome<void>> {
    const cloudFailure = this.cloudFailure()
    if (cloudFailure) return { status: 'failed', error: cloudFailure }
    if (this.state.session) this.state.session.state = 'revoked'
    this.state.session = null
    this.state.account = null
    this.state.device = null
    return { status: 'ok', value: undefined }
  }

  async isDeviceActive(): Promise<OperationOutcome<boolean>> {
    const cloudFailure = this.cloudFailure()
    if (cloudFailure) return { status: 'failed', error: cloudFailure }
    const device = this.state.device
    if (!device) {
      return {
        status: 'failed',
        error: classifyError('AUTH_REQUIRED', 'No registered device'),
      }
    }
    if (device.state === 'revoked') {
      return {
        status: 'failed',
        error: classifyError('DEVICE_REVOKED', 'Device was revoked'),
      }
    }
    return { status: 'ok', value: device.state === 'active' }
  }

  // --- entitlements --------------------------------------------------------

  async getEntitlements(): Promise<OperationOutcome<DirectionerEntitlements>> {
    const cloudFailure = this.cloudFailure()
    if (cloudFailure) return { status: 'failed', error: cloudFailure }
    if (!this.state.account) {
      return {
        status: 'failed',
        error: classifyError('AUTH_REQUIRED', 'Not signed in'),
      }
    }
    return {
      status: 'ok',
      value: {
        accountId: this.state.account.accountId,
        allowedCapabilities: ['text', 'tool_calling', 'streaming'],
        subscriptionActive: true,
        remainingQuota: 1000,
        asOf: iso(this.clock.now()),
      },
    }
  }

  // --- model service -------------------------------------------------------

  async requestModelService(
    request: ModelServiceRequest,
  ): Promise<OperationOutcome<ModelServiceGrant>> {
    const cloudFailure = this.cloudFailure()
    if (cloudFailure) return { status: 'failed', error: cloudFailure }
    if (!this.state.account) {
      return {
        status: 'failed',
        error: classifyError('AUTH_REQUIRED', 'Not signed in'),
      }
    }
    this.counter += 1
    return {
      status: 'ok',
      value: {
        grantId: id('grant', this.counter),
        capabilities: request.capabilities,
        // A Directioner-facing label, never a provider model id.
        modelLabel: 'Directioner Standard',
        metered: true,
      },
    }
  }

  // --- tasks ---------------------------------------------------------------

  async createTask(request: {
    request: string
    workspace: WorkspaceRef
  }): Promise<OperationOutcome<DirectionerTask>> {
    const cloudFailure = this.cloudFailure()
    if (cloudFailure) return { status: 'failed', error: cloudFailure }
    if (!this.state.account || !this.state.device || !this.state.session) {
      return {
        status: 'failed',
        error: classifyError('AUTH_REQUIRED', 'Not signed in'),
      }
    }
    this.taskCounter += 1
    const taskId = id('task', this.taskCounter)
    const now = iso(this.clock.now())
    const task: DirectionerTask = {
      taskId,
      accountId: this.state.account.accountId,
      deviceId: this.state.device.deviceId,
      sessionId: this.state.session.sessionId,
      request: request.request,
      workspace: request.workspace,
      state: 'created',
      createdAt: now,
      updatedAt: now,
    }
    this.state.tasks.set(taskId, task)
    this.state.events.set(taskId, [])
    this.state.eventKeys.set(taskId, new Map())
    this.state.messages.set(taskId, [])
    this.state.sequence.set(taskId, 0)
    this.appendEvent(taskId, 'task.created', { request: request.request })
    return { status: 'ok', value: task }
  }

  async sendTaskInput(input: {
    taskId: string
    message: string
  }): Promise<OperationOutcome<TaskMessage>> {
    const cloudFailure = this.cloudFailure()
    if (cloudFailure) return { status: 'failed', error: cloudFailure }
    const task = this.state.tasks.get(input.taskId)
    if (!task) {
      return {
        status: 'failed',
        error: classifyError('TASK_NOT_FOUND', 'No such task'),
      }
    }
    const message: TaskMessage = {
      taskId: input.taskId,
      role: 'user',
      content: input.message,
      createdAt: iso(this.clock.now()),
    }
    this.state.messages.get(input.taskId)?.push(message)
    return { status: 'ok', value: message }
  }

  async getTask(taskId: string): Promise<OperationOutcome<DirectionerTask>> {
    const cloudFailure = this.cloudFailure()
    if (cloudFailure) return { status: 'failed', error: cloudFailure }
    const task = this.state.tasks.get(taskId)
    if (!task) {
      return {
        status: 'failed',
        error: classifyError('TASK_NOT_FOUND', 'No such task'),
      }
    }
    return { status: 'ok', value: task }
  }

  async getTaskEvents(
    taskId: string,
    sinceSequence?: number,
  ): Promise<OperationOutcome<{ events: TaskEvent[]; sync: SyncState }>> {
    const cloudFailure = this.cloudFailure()
    if (cloudFailure) return { status: 'failed', error: cloudFailure }
    if (!this.state.tasks.has(taskId)) {
      return {
        status: 'failed',
        error: classifyError('TASK_NOT_FOUND', 'No such task'),
      }
    }
    const all = this.state.events.get(taskId) ?? []
    const events =
      sinceSequence === undefined
        ? all
        : all.filter((e) => e.sequence > sinceSequence)
    return { status: 'ok', value: { events, sync: this.syncState(taskId) } }
  }

  async cancelTask(
    taskId: string,
  ): Promise<OperationOutcome<DirectionerTask>> {
    const cloudFailure = this.cloudFailure()
    if (cloudFailure) return { status: 'failed', error: cloudFailure }
    const task = this.state.tasks.get(taskId)
    if (!task) {
      return {
        status: 'failed',
        error: classifyError('TASK_NOT_FOUND', 'No such task'),
      }
    }
    if (!canTransition(task.state, 'cancelling')) {
      return {
        status: 'failed',
        error: classifyError(
          'TASK_STATE_INVALID',
          `Cannot cancel a task in state '${task.state}'`,
        ),
      }
    }
    this.transition(taskId, 'cancelling')
    this.transition(taskId, 'cancelled')
    return { status: 'ok', value: this.state.tasks.get(taskId)! }
  }

  // --- approvals -----------------------------------------------------------

  async submitApproval(decision: {
    approvalId: string
    decision: ApprovalDecision
  }): Promise<OperationOutcome<ApprovalRecord>> {
    const cloudFailure = this.cloudFailure()
    if (cloudFailure) return { status: 'failed', error: cloudFailure }
    const record = this.state.approvals.get(decision.approvalId)
    if (!record) {
      return {
        status: 'failed',
        error: classifyError('APPROVAL_REQUIRED', 'No such approval'),
      }
    }
    // An already-decided approval is not replayable or re-decidable.
    if (record.decidedAt !== '') {
      return {
        status: 'failed',
        error: classifyError(
          'TASK_STATE_INVALID',
          'Approval has already been decided',
        ),
      }
    }
    if (this.clock.now() >= Date.parse(record.expiresAt)) {
      return {
        status: 'failed',
        error: classifyError('APPROVAL_REQUIRED', 'Approval has expired'),
      }
    }
    // This method only records grant/deny for the operation the request already
    // named: a decision can never widen the scope it was requested for.
    const decided: ApprovalRecord = {
      ...record,
      decision: decision.decision,
      decisionSource: 'user',
      decidedAt: iso(this.clock.now()),
    }
    this.state.approvals.set(decided.approvalId, decided)
    this.appendEvent(
      record.taskId,
      decision.decision === 'granted' ? 'approval.granted' : 'approval.denied',
      { approvalId: decided.approvalId, operationId: decided.operationId },
    )
    return { status: 'ok', value: decided }
  }

  // --- sync ----------------------------------------------------------------

  async syncEvents(taskId: string): Promise<OperationOutcome<SyncState>> {
    const cloudFailure = this.cloudFailure()
    if (cloudFailure) {
      // The local events are still on disk; the *sync* failed. This is the
      // distinction between LOCAL SUCCESS and CLOUD SYNC SUCCESS — the caller
      // sees "queued", never "done".
      return {
        status: 'queued',
        value: this.syncState(taskId),
        sync: { ...this.syncState(taskId), lastError: cloudFailure },
      }
    }
    if (!this.state.tasks.has(taskId)) {
      return {
        status: 'failed',
        error: classifyError('TASK_NOT_FOUND', 'No such task'),
      }
    }
    const sync = this.syncState(taskId)
    return {
      status: 'ok',
      value: {
        ...sync,
        acknowledgedThrough: sync.acknowledgedThrough + sync.pendingCount,
        pendingCount: 0,
      },
    }
  }

  // --- internals -----------------------------------------------------------

  private cloudFailure(): DirectionerServiceError | undefined {
    return this.failCloudWith
  }

  private syncState(taskId: string): SyncState {
    const total = this.state.events.get(taskId)?.length ?? 0
    return { taskId, acknowledgedThrough: 0, pendingCount: total }
  }

  /**
   * Transition a task, rejecting a move the state machine forbids. Every
   * state change goes through here, so "explicit transitions" is a property
   * of the code, not a convention.
   */
  private transition(taskId: string, to: TaskState): DirectionerTask {
    const task = this.state.tasks.get(taskId)
    if (!task) throw new Error(`no such task: ${taskId}`)
    const from = task.state
    if (!canTransition(from, to)) {
      throw new Error(`invalid transition ${from} -> ${to}`)
    }
    task.state = to
    task.updatedAt = iso(this.clock.now())
    this.appendEvent(taskId, stateToEventType(to), { from, to })
    return task
  }

  /**
   * Append one event. Idempotent by `idempotencyKey`: appending the same key
   * twice returns the existing event instead of duplicating it, which is what
   * makes a retried delivery safe.
   */
  private appendEvent(
    taskId: string,
    type: TaskEventType,
    payload?: Record<string, unknown>,
    idempotencyKey?: string,
  ): TaskEvent {
    const keys = this.state.eventKeys.get(taskId) ?? new Map<string, string>()
    this.state.eventKeys.set(taskId, keys)
    const key = idempotencyKey ?? `${type}:${JSON.stringify(payload ?? {})}`
    const existingId = keys.get(key)
    if (existingId) {
      const existing = (this.state.events.get(taskId) ?? []).find(
        (e) => e.eventId === existingId,
      )
      if (existing) return existing
    }
    const seq = (this.state.sequence.get(taskId) ?? 0) + 1
    this.state.sequence.set(taskId, seq)
    const event: TaskEvent = {
      eventId: `${taskId}:evt:${seq}`,
      taskId,
      sequence: seq,
      type,
      timestamp: iso(this.clock.now()),
      correlationId: `corr_test_${taskId}`,
      idempotencyKey: key,
      payload,
    }
    const list = this.state.events.get(taskId) ?? []
    list.push(event)
    this.state.events.set(taskId, list)
    keys.set(key, event.eventId)
    return event
  }
}

function stateToEventType(state: TaskState): TaskEventType {
  switch (state) {
    case 'running':
      return 'task.started'
    case 'paused':
      return 'task.paused'
    case 'recovering':
      return 'task.recovered'
    case 'cancelled':
      return 'task.cancelled'
    case 'failed':
      return 'task.failed'
    case 'completed':
      return 'task.completed'
    default:
      return 'task.updated'
  }
}
