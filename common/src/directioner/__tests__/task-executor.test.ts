/**
 * Tests for the task executor loop.
 *
 * The double is an in-memory `SharedTaskClient` that models the backend's
 * *behaviour* — a lease, a cancellation state, a terminal result — not a set of
 * call expectations. The executor's real logic (lease-before-run, started after
 * claim, cancellation only after the agent stops, inconclusive-by-default) runs
 * against it, so the test pins the honesty rules, not mock call counts.
 */

import { describe, expect, it } from 'bun:test'

import { createTaskExecutor, type AgentRunResult } from '../task-executor'
import type {
  AppendEventInput,
  ClaimResult,
  ExecutionResultInput,
  SharedTaskClient,
  TaskExecution,
} from '../shared-task-client'
import type { DirectionerTask, OperationOutcome } from '../platform-contract'

function ok<T>(value: T): OperationOutcome<T> {
  return { status: 'ok', value }
}

const TASK: DirectionerTask = {
  taskId: 'task-1',
  accountId: 'user-1',
  deviceId: '',
  sessionId: '',
  request: 'add the missing endpoint',
  workspace: { path: '/repo' },
  state: 'queued',
  createdAt: '2026-10-10T00:00:00.000Z',
  updatedAt: '2026-10-10T00:00:00.000Z',
}

interface FakeState {
  claimed: boolean
  cancellation: 'none' | 'requested' | 'confirmed'
  events: AppendEventInput[]
  result?: ExecutionResultInput
  heartbeats: number
  claimCount: number
  confirmations: number
  taskExists: boolean
}

function makeExecution(state: FakeState): TaskExecution {
  return {
    taskId: 'task-1',
    userId: 'user-1',
    executionId: 'exec-1',
    origin: 'cli',
    state: state.claimed ? 'leased' : 'pending',
    attempt: 1,
    cancellation: state.cancellation,
    verification: state.result?.verification ?? 'unverified',
    createdAt: '2026-10-10T00:00:00.000Z',
    updatedAt: '2026-10-10T00:00:00.000Z',
  }
}

function fakeClient(state: FakeState): SharedTaskClient {
  const notUsed = (): never => {
    throw new Error('not used in this test')
  }
  return {
    createTask: notUsed as never,
    listTasks: notUsed as never,
    requestApproval: notUsed as never,
    submitApproval: notUsed as never,
    listRunnable: notUsed as never,
    listEvents: notUsed as never,
    dispatch: notUsed as never,

    getTask: async () => {
      if (!state.taskExists) {
        return {
          status: 'failed',
          error: { code: 'TASK_NOT_FOUND', message: 'gone', retryable: false },
        }
      }
      return ok({ task: TASK })
    },
    getExecution: async () => ok(makeExecution(state)),
    claim: async (): Promise<OperationOutcome<ClaimResult>> => {
      state.claimCount += 1
      if (!state.claimed)
        return ok({
          execution: makeExecution(state),
          claimed: false,
          reason: 'lease_held',
        })
      return ok({ execution: makeExecution(state), claimed: true })
    },
    heartbeat: async () => {
      state.heartbeats += 1
      return ok({ execution: makeExecution(state), claimed: true })
    },
    appendEvent: async (_taskId, input) => {
      state.events.push(input)
      return ok({
        event: {
          eventId: `evt-${state.events.length}`,
          taskId: 'task-1',
          sequence: state.events.length,
          type: 'task.started',
          timestamp: '2026-10-10T00:00:01.000Z',
          correlationId: '',
          idempotencyKey: input.idempotencyKey,
        },
      })
    },
    recordResult: async (_taskId, input) => {
      state.result = input
      return ok({
        ...makeExecution(state),
        state: input.outcome === 'succeeded' ? 'completed' : 'failed',
      })
    },
    requestCancellation: async () => ok(makeExecution(state)),
    confirmCancellation: async () => {
      state.confirmations += 1
      state.cancellation = 'confirmed'
      return ok({
        ...makeExecution(state),
        state: 'cancelled',
        cancellation: 'confirmed',
      })
    },
    reconcile: notUsed as never,
  }
}

function freshState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    claimed: true,
    cancellation: 'none',
    events: [],
    heartbeats: 0,
    claimCount: 0,
    confirmations: 0,
    taskExists: true,
    ...overrides,
  }
}

const FAST = { leaseMs: 1_000, pollIntervalMs: 5, abortGraceMs: 50 }

describe('task executor: honest results', () => {
  it('claims, records started, and reports success without overclaiming verification', async () => {
    const state = freshState()
    const executor = createTaskExecutor({
      client: fakeClient(state),
      runAgent: async () => ({ outcome: 'succeeded' }),
      ...FAST,
    })

    const outcome = await executor.executeTask('task-1')
    expect(outcome.status).toBe('completed')
    // Started is journaled only after the lease is held.
    expect(state.events.map((e) => e.type)).toEqual(['task.started'])
    // A run that merely returned is not proof of the effect.
    expect(state.result?.verification).toBe('inconclusive')
    expect(state.result?.outcome).toBe('succeeded')
    expect(state.result?.idempotencyKey).toBe('result:exec-1')
  })

  it('passes through a host verification verdict when one is supplied', async () => {
    const state = freshState()
    const executor = createTaskExecutor({
      client: fakeClient(state),
      runAgent: async () => ({
        outcome: 'succeeded',
        verification: 'confirmed',
      }),
      ...FAST,
    })
    await executor.executeTask('task-1')
    expect(state.result?.verification).toBe('confirmed')
  })

  it('reports a failed run with its error code', async () => {
    const state = freshState()
    const executor = createTaskExecutor({
      client: fakeClient(state),
      runAgent: async () => ({
        outcome: 'failed',
        errorCode: 'TESTS_FAILED',
        summary: 'red',
      }),
      ...FAST,
    })
    const outcome = await executor.executeTask('task-1')
    expect(outcome.status).toBe('failed')
    expect(state.result?.outcome).toBe('failed')
    expect(state.result?.errorCode).toBe('TESTS_FAILED')
  })

  it('does not run the agent when the lease is not acquired', async () => {
    const state = freshState({ claimed: false })
    let ran = false
    const executor = createTaskExecutor({
      client: fakeClient(state),
      runAgent: async () => {
        ran = true
        return { outcome: 'succeeded' }
      },
      ...FAST,
    })
    const outcome = await executor.executeTask('task-1')
    expect(outcome).toEqual({
      status: 'not_claimed',
      taskId: 'task-1',
      reason: 'lease_held',
    })
    expect(ran).toBe(false)
    expect(state.events).toEqual([])
  })

  it('classifies a client failure rather than throwing it', async () => {
    const state = freshState({ taskExists: false })
    const executor = createTaskExecutor({
      client: fakeClient(state),
      runAgent: async () => ({ outcome: 'succeeded' }),
      ...FAST,
    })
    const outcome = await executor.executeTask('task-1')
    expect(outcome.status).toBe('client_error')
    if (outcome.status !== 'client_error') return
    expect(outcome.error.code).toBe('TASK_NOT_FOUND')
  })
})

describe('task executor: cancellation is not a result', () => {
  it('aborts the agent on a cancellation request and confirms only after it stops', async () => {
    const state = freshState()
    const order: string[] = []
    let aborted = false

    const executor = createTaskExecutor({
      client: fakeClient(state),
      runAgent: async ({ signal }): Promise<AgentRunResult> => {
        order.push('run:start')
        await new Promise<void>((resolve) => {
          if (signal.aborted) return resolve()
          signal.addEventListener('abort', () => resolve(), { once: true })
        })
        aborted = signal.aborted
        order.push('run:stopped')
        return { outcome: 'succeeded' }
      },
      ...FAST,
    })

    // The cancellation arrives while the agent is running.
    setTimeout(() => {
      state.cancellation = 'requested'
    }, 15)

    const outcome = await executor.executeTask('task-1')
    expect(aborted).toBe(true)
    expect(order).toEqual(['run:start', 'run:stopped'])
    expect(state.confirmations).toBe(1)
    // The cancelled run is never recorded as a completed/failed result.
    expect(state.result).toBeUndefined()
    expect(outcome.status).toBe('cancelled')
    if (outcome.status !== 'cancelled') return
    expect(outcome.confirmed).toBe(true)
  })

  it('never confirms a cancellation the backend does not accept', async () => {
    const state = freshState()
    const client = fakeClient(state)
    // The backend refuses to confirm: the stop could not be observed.
    client.confirmCancellation = async () => ({
      status: 'failed',
      error: {
        code: 'TASK_STATE_INVALID',
        message: 'not cancelling',
        retryable: false,
      },
    })
    const executor = createTaskExecutor({
      client,
      runAgent: async ({ signal }) => {
        await new Promise<void>((resolve) => {
          if (signal.aborted) return resolve()
          signal.addEventListener('abort', () => resolve(), { once: true })
        })
        return { outcome: 'succeeded' }
      },
      ...FAST,
    })
    setTimeout(() => {
      state.cancellation = 'requested'
    }, 15)

    const outcome = await executor.executeTask('task-1')
    expect(outcome.status).toBe('client_error')
  })
})

describe('task executor: engineer progress', () => {
  it('records engineer.progress events the runner reports', async () => {
    const state = freshState()
    const executor = createTaskExecutor({
      client: fakeClient(state),
      runAgent: async ({ reportProgress }) => {
        await reportProgress({ note: 'planning', fraction: 0.25 })
        await reportProgress({ note: 'running tests', fraction: 0.75 })
        return { outcome: 'succeeded' }
      },
      ...FAST,
    })

    const outcome = await executor.executeTask('task-1')
    expect(outcome.status).toBe('completed')

    const progress = state.events.filter((e) => e.type === 'engineer.progress')
    expect(progress).toHaveLength(2)
    expect(progress[0]?.payload).toMatchObject({ note: 'planning', fraction: 0.25 })
    // Each progress event carries a distinct idempotency key.
    expect(progress[0]?.idempotencyKey).not.toBe(progress[1]?.idempotencyKey)
  })

  it('bounds the note and clamps the fraction so the payload stays metadata', async () => {
    const state = freshState()
    const executor = createTaskExecutor({
      client: fakeClient(state),
      runAgent: async ({ reportProgress }) => {
        await reportProgress({ note: 'x'.repeat(2_000), fraction: 9 })
        return { outcome: 'succeeded' }
      },
      ...FAST,
    })

    await executor.executeTask('task-1')
    const progress = state.events.find((e) => e.type === 'engineer.progress')
    expect((progress?.payload?.note as string).length).toBe(500)
    expect(progress?.payload?.fraction).toBe(1)
  })

  it('never fails the run when a progress report is rejected', async () => {
    const state = freshState()
    const client = fakeClient(state)
    client.appendEvent = async (_taskId, input) => {
      if (input.type === 'engineer.progress') {
        return {
          status: 'failed',
          error: { code: 'TASK_STATE_INVALID', message: 'no', retryable: false },
        }
      }
      state.events.push(input)
      return ok({
        event: {
          eventId: 'evt',
          taskId: 'task-1',
          sequence: state.events.length,
          type: 'task.started',
          timestamp: '2026-10-10T00:00:01.000Z',
          correlationId: '',
          idempotencyKey: input.idempotencyKey,
        },
      })
    }
    const executor = createTaskExecutor({
      client,
      runAgent: async ({ reportProgress }) => {
        await reportProgress({ note: 'still working' })
        return { outcome: 'succeeded', verification: 'confirmed' }
      },
      ...FAST,
    })

    const outcome = await executor.executeTask('task-1')
    // Progress is an observation: a rejected report must not fail the task.
    expect(outcome.status).toBe('completed')
    expect(state.result?.verification).toBe('confirmed')
  })
})
