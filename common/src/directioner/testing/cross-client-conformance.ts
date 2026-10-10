/**
 * Cross-client conformance harness.
 *
 * ---------------------------------------------------------------------------
 * TEST-ONLY. NOT PRODUCTION CODE.
 * ---------------------------------------------------------------------------
 *
 * This wires the real client-side pieces — the shared task/session/event model
 * and the in-memory reference transport — into one deterministic world, so the
 * cross-client cases (direct CLI work, Aria-originated work, authority
 * boundaries, races, and failure recovery) can be exercised without a backend.
 *
 * It lives under `directioner/testing/` deliberately: production code must not
 * import it, and the reference-transport isolation test skips this directory.
 *
 * What it proves is *contract and lifecycle correctness*, not model
 * intelligence. No case here asserts that the system reasons well about
 * arbitrary tasks; there is no fabricated provider response pretending it can.
 */

import {
  classifyError,
  type DirectionerServiceError,
  type DirectionerTask,
  type TaskEvent,
} from '../platform-contract'
import {
  ReferenceTransport,
  SYSTEM_CLOCK,
  type ReferenceClock,
} from './reference-transport'
import {
  applyEvent,
  assertApprovalBinding,
  assertMetadataPayload,
  assertTaskOwnership,
  canRouteToDevice,
  createSharedTask,
  isTerminal,
  projectTask,
  requestCancellation,
  type SharedTask,
  type TaskProjection,
} from '../shared-task-model'

export { ReferenceTransport, SYSTEM_CLOCK }
export type { ReferenceClock }

/**
 * A deterministic result for a capability that does not exist yet. The client
 * reports "we cannot do this" with a specific reason, rather than inventing an
 * outcome or a fake success.
 */
export type UnsupportedResult = {
  status: 'unsupported'
  feature: string
  reason: string
}

export function unsupported(feature: string, reason: string): UnsupportedResult {
  return { status: 'unsupported', feature, reason }
}

/**
 * The deterministic world a conformance case runs in: one reference transport,
 * one shared task projected from a task creation, and a monotonic sequence
 * counter so events are easy to author in order.
 */
export class ConformanceWorld {
  readonly transport: ReferenceTransport
  private seq = 0
  private readonly nowIso: string

  constructor(options: { clock?: ReferenceClock; nowIso?: string } = {}) {
    this.transport = new ReferenceTransport({ clock: options.clock ?? SYSTEM_CLOCK })
    this.nowIso = options.nowIso ?? '2026-10-10T08:00:00.000Z'
  }

  /** Sign in and register a device — the precondition for cloud work. */
  async signIn(): Promise<void> {
    await this.transport.authenticate()
    this.transport.__approveDeviceAuthorization()
    await this.transport.registerDevice('conf-test')
  }

  /** Create a task through the real client, returning both shapes. */
  async createTask(request = 'fix the build'): Promise<DirectionerTask> {
    const outcome = await this.transport.createTask({
      request,
      workspace: { path: '/repo' },
    })
    if (outcome.status !== 'ok') {
      throw new Error(`createTask failed: ${outcome.status}`)
    }
    return outcome.value
  }

  /** A CLI-origin shared task with no Aria session. */
  cliSharedTask(request = 'fix the build'): SharedTask {
    return createSharedTask({
      taskId: 'task_conf_1',
      accountId: 'acct_conf',
      origin: 'cli',
      request,
      contractVersion: '1.0.0',
      now: this.nowIso,
    })
  }

  /** Build the next event for a task, with a fresh sequence. */
  nextEvent(
    taskId: string,
    type: TaskEvent['type'],
    overrides: Partial<TaskEvent> = {},
  ): TaskEvent {
    this.seq += 1
    return {
      eventId: `${taskId}:evt:${this.seq}`,
      taskId,
      sequence: this.seq,
      type,
      timestamp: this.nowIso,
      correlationId: `corr_${taskId}`,
      idempotencyKey: `${type}:${this.seq}`,
      ...overrides,
    }
  }

  resetSequence(): void {
    this.seq = 0
  }

  now(): string {
    return this.nowIso
  }
}

/** A classified "backend is down" error, for offline cases. */
export function backendDown(): DirectionerServiceError {
  return classifyError('BACKEND_UNAVAILABLE', 'Backend unreachable')
}

// Re-export the pieces cases need, so a case file imports one module.
export {
  applyEvent,
  assertApprovalBinding,
  assertMetadataPayload,
  assertTaskOwnership,
  canRouteToDevice,
  createSharedTask,
  isTerminal,
  projectTask,
  requestCancellation,
}
export type { SharedTask, TaskProjection }
