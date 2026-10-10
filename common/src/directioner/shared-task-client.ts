/**
 * The account-scoped task client the CLI's executor talks to.
 *
 * This is the *supported surface* of the Directioner Platform Backend's task
 * execution boundary, expressed as a small, transport-agnostic interface. It is
 * provider-neutral and names no vendor, URL, or credential — an implementation
 * (`backend-http-client.ts`) holds those; a test holds an in-memory one.
 *
 * It is intentionally a strict subset of the declared `DirectionerClient`:
 * identity, entitlements, model service, and the device-authorization flow are
 * separate concerns and are not needed to run a task. Billing and entitlements
 * stay server-side and are not part of this contract.
 *
 * WHY THIS EXISTS. `platform-contract.ts` declares the full client and
 * `shared-task-model.ts` defines the behaviour, but neither can talk to a real
 * service. This interface is the one real thing the CLI needs to receive work
 * from Aria and report honest results back, and it is what makes the adapter
 * testable with a real HTTP double rather than a mock of the adapter itself.
 *
 * THE RULES (enforced by the adapter and the shared task model, not here):
 *   1. A dispatch is an acknowledgement, not an execution or a result.
 *   2. A cancellation request is not a confirmed stop.
 *   3. Absence of verification evidence is not success.
 *   4. Every write is idempotent by key; a redelivery is a no-op.
 */

import type {
  ApprovalDecision,
  DirectionerServiceError,
  DirectionerTask,
  OperationOutcome,
  SyncState,
  TaskEvent,
} from './platform-contract'

/** The execution state of a task, as the backend reports it. */
export type ExecutionState =
  'pending' | 'leased' | 'running' | 'completed' | 'failed' | 'cancelled'

/** The cancellation lifecycle. `requested` is not a confirmed stop. */
export type BackendCancellationState =
  'none' | 'requested' | 'confirmed' | 'unknown' | 'failed'

/** The verification verdict. Only `confirmed` marks an effect proven. */
export type BackendVerificationState =
  'unverified' | 'confirmed' | 'not_confirmed' | 'inconclusive'

/** One execution/dispatch record. Mirrors the backend's `TaskExecution`. */
export interface TaskExecution {
  taskId: string
  userId: string
  /** Stable execution identity, distinct from the task id. */
  executionId: string
  origin: 'cli' | 'website' | 'aria' | 'desktop' | 'gui'
  state: ExecutionState
  attempt: number
  leaseOwner?: string
  leaseExpiresAt?: string
  cancellation: BackendCancellationState
  result?: Record<string, unknown>
  verification: BackendVerificationState
  errorCode?: string
  createdAt: string
  updatedAt: string
}

/** Why a claim was refused. */
export type ClaimRefusal =
  | 'terminal'
  | 'not_dispatched'
  | 'lease_held'
  /** The task's cancellation was requested; it is never (re)started. */
  | 'cancellation_requested'
  /** A cancellation was attempted but the stop was never observed. */
  | 'cancellation_unconfirmed'

export interface ClaimResult {
  execution: TaskExecution
  claimed: boolean
  reason?: ClaimRefusal
}

export interface DispatchInput {
  origin?: 'cli' | 'website' | 'aria' | 'desktop' | 'gui'
  idempotencyKey?: string
}

export interface ExecutionResultInput {
  outcome: 'succeeded' | 'failed' | 'cancelled'
  summary?: string
  artifactRefs?: readonly string[]
  verification: 'confirmed' | 'not_confirmed' | 'inconclusive'
  errorCode?: string
  idempotencyKey: string
}

/**
 * Event types the execution boundary accepts. The set is not closed on the
 * backend — an unknown type is ignored — but a client must only emit types it
 * understands, so this is the accepted vocabulary, not the shared model's
 * broader `TaskEventType`.
 */
export type BackendTaskEventType =
  | 'task.created'
  | 'task.started'
  | 'task.recovered'
  | 'task.completed'
  | 'task.failed'
  | 'task.cancelled'
  | 'cancellation.requested'
  | 'tool.completed'
  | 'approval.requested'
  | 'approval.granted'
  | 'approval.denied'
  | 'verification.recorded'
  | 'security.event'

export interface AppendEventInput {
  type: BackendTaskEventType
  idempotencyKey: string
  payload?: Record<string, unknown>
}

export interface Page<T> {
  items: T[]
  nextCursor?: string
}

/**
 * The task execution surface. Every method returns an `OperationOutcome` so a
 * transport failure is a named error, never a silent success and never a
 * thrown string.
 */
export interface SharedTaskClient {
  /** Create a task. The backend assigns the id and the identity. */
  createTask(input: {
    request: string
  }): Promise<OperationOutcome<{ task: DirectionerTask }>>
  getTask(taskId: string): Promise<OperationOutcome<{ task: DirectionerTask }>>
  listTasks(limit?: number): Promise<OperationOutcome<Page<DirectionerTask>>>

  /** Open an approval request for a task (backend-driven). */
  requestApproval(
    taskId: string,
  ): Promise<
    OperationOutcome<{
      approval: Record<string, unknown>
      task?: DirectionerTask
    }>
  >
  /** Submit the user's decision. A client cannot create an approval, only decide one. */
  submitApproval(input: {
    approvalId: string
    decision: ApprovalDecision
    reason?: string
  }): Promise<
    OperationOutcome<{
      approval: Record<string, unknown>
      task: DirectionerTask
    }>
  >

  /** Enqueue an approved task. Idempotent per task. */
  dispatch(
    taskId: string,
    input?: DispatchInput,
  ): Promise<OperationOutcome<TaskExecution>>
  getExecution(taskId: string): Promise<OperationOutcome<TaskExecution>>
  listRunnable(limit?: number): Promise<OperationOutcome<TaskExecution[]>>
  claim(
    taskId: string,
    leaseMs?: number,
  ): Promise<OperationOutcome<ClaimResult>>
  heartbeat(
    taskId: string,
    leaseMs?: number,
  ): Promise<OperationOutcome<ClaimResult>>
  appendEvent(
    taskId: string,
    input: AppendEventInput,
  ): Promise<OperationOutcome<{ event: TaskEvent }>>
  listEvents(
    taskId: string,
    sinceSequence?: number,
  ): Promise<OperationOutcome<{ events: TaskEvent[] }>>
  recordResult(
    taskId: string,
    input: ExecutionResultInput,
  ): Promise<OperationOutcome<TaskExecution>>
  requestCancellation(taskId: string): Promise<OperationOutcome<TaskExecution>>
  confirmCancellation(
    taskId: string,
    input: {
      outcome: 'confirmed' | 'failed'
      reason?: string
      idempotencyKey: string
    },
  ): Promise<OperationOutcome<TaskExecution>>
  /** Re-queue executions whose lease expired. */
  reconcile(): Promise<OperationOutcome<{ requeued: number }>>
}

/** Convenience re-export so callers do not reach into platform-contract. */
export type { DirectionerServiceError, OperationOutcome, SyncState }
