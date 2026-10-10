/**
 * Tests for the real HTTP `SharedTaskClient`.
 *
 * The double here is a *request router over `fetch`* — it speaks the backend's
 * HTTP contract (status codes, JSON bodies, the `{ error: { code } }` problem
 * shape) and records what it saw. Nothing about the adapter is mocked: the
 * adapter's URL building, auth header, body construction, schema validation,
 * and error classification all run for real against this transport. That is
 * what makes the test meaningful — it pins the wire contract, not internal
 * call counts.
 */

import { describe, expect, it } from 'bun:test'

import { createBackendTaskClient } from '../backend-http-client'
import { applyEvent, projectTask, createSharedTask } from '../shared-task-model'

interface Seen {
  method: string
  path: string
  auth: string | undefined
  body: unknown
  query: string
}

/** Build a `fetch` double that routes by path and records every request. */
function router(handler: (seen: Seen) => { status: number; body: unknown }): {
  fetchImpl: typeof fetch
  seen: Seen[]
} {
  const seen: Seen[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const headers = new Headers(init?.headers)
    const record: Seen = {
      method: init?.method ?? 'GET',
      path: url.pathname,
      auth: headers.get('authorization') ?? undefined,
      body:
        init?.body !== undefined ? JSON.parse(String(init.body)) : undefined,
      query: url.search,
    }
    seen.push(record)
    const { status, body } = handler(record)
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return { fetchImpl, seen }
}

function client(fetchImpl: typeof fetch) {
  return createBackendTaskClient({
    baseUrl: 'https://api.directioner.example/',
    getAccessToken: async () => 'session-token-abc',
    fetchImpl,
    timeoutMs: 5_000,
  })
}

const TASK = {
  id: 'task-1',
  userId: 'user-1',
  title: 'add the endpoint',
  status: 'approved',
  version: 2,
  createdAt: '2026-10-10T00:00:00.000Z',
  updatedAt: '2026-10-10T00:00:01.000Z',
}

const EXECUTION = {
  taskId: 'task-1',
  userId: 'user-1',
  executionId: 'exec-1',
  origin: 'aria',
  state: 'pending',
  attempt: 1,
  cancellation: 'none',
  verification: 'unverified',
  createdAt: '2026-10-10T00:00:00.000Z',
  updatedAt: '2026-10-10T00:00:00.000Z',
}

describe('backend task client: request shaping', () => {
  it('creates a task and maps the backend status onto the shared state', async () => {
    const { fetchImpl, seen } = router(() => ({
      status: 201,
      body: { task: TASK },
    }))
    const result = await client(fetchImpl).createTask({
      request: 'add the endpoint',
    })

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.value.task.taskId).toBe('task-1')
    expect(result.value.task.accountId).toBe('user-1')
    // `approved` is queued work, not yet running.
    expect(result.value.task.state).toBe('queued')

    expect(seen[0].method).toBe('POST')
    expect(seen[0].path).toBe('/api/v1/tasks')
    expect(seen[0].body).toEqual({ title: 'add the endpoint' })
    // The token travels only in the header, never in the body.
    expect(seen[0].auth).toBe('Bearer session-token-abc')
    expect(JSON.stringify(seen[0].body)).not.toContain('session-token-abc')
  })

  it('dispatches a task with origin and parses the execution', async () => {
    const { fetchImpl, seen } = router(() => ({
      status: 201,
      body: { execution: EXECUTION },
    }))
    const result = await client(fetchImpl).dispatch('task-1', { origin: 'cli' })

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.value.executionId).toBe('exec-1')
    expect(result.value.state).toBe('pending')
    expect(seen[0].path).toBe('/api/v1/tasks/task-1/dispatch')
    expect(seen[0].body).toEqual({ origin: 'cli' })
  })

  it('reads a lease refusal without treating it as an error', async () => {
    const { fetchImpl } = router(() => ({
      status: 200,
      body: {
        execution: { ...EXECUTION, state: 'leased' },
        claimed: false,
        reason: 'lease_held',
      },
    }))
    const result = await client(fetchImpl).claim('task-1', 60_000)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.value.claimed).toBe(false)
    expect(result.value.reason).toBe('lease_held')
  })

  it('appends an event with its idempotency key and parses it back', async () => {
    const { fetchImpl, seen } = router(() => ({
      status: 201,
      body: {
        event: {
          id: 'evt-1',
          taskId: 'task-1',
          sequence: 1,
          type: 'task.started',
          idempotencyKey: 'started:task-1',
          payload: { step: 'planning' },
          createdAt: '2026-10-10T00:00:02.000Z',
        },
      },
    }))
    const result = await client(fetchImpl).appendEvent('task-1', {
      type: 'task.started',
      idempotencyKey: 'started:task-1',
      payload: { step: 'planning' },
    })
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.value.event.type).toBe('task.started')
    expect(result.value.event.sequence).toBe(1)
    expect(seen[0].body).toEqual({
      type: 'task.started',
      idempotencyKey: 'started:task-1',
      payload: { step: 'planning' },
    })
  })

  it('records a result, carrying verification and the idempotency key', async () => {
    const { fetchImpl, seen } = router(() => ({
      status: 200,
      body: {
        execution: {
          ...EXECUTION,
          state: 'completed',
          verification: 'confirmed',
        },
      },
    }))
    const result = await client(fetchImpl).recordResult('task-1', {
      outcome: 'succeeded',
      verification: 'confirmed',
      idempotencyKey: 'result:task-1',
      summary: 'done',
      artifactRefs: ['commit:abc'],
    })
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.value.state).toBe('completed')
    expect(result.value.verification).toBe('confirmed')
    expect(seen[0].body).toMatchObject({
      outcome: 'succeeded',
      verification: 'confirmed',
      idempotencyKey: 'result:task-1',
    })
  })

  it('requests then confirms a cancellation as two distinct calls', async () => {
    let call = 0
    const { fetchImpl, seen } = router(() => {
      call += 1
      return {
        status: 200,
        body: {
          execution:
            call === 1
              ? { ...EXECUTION, cancellation: 'requested' }
              : { ...EXECUTION, state: 'cancelled', cancellation: 'confirmed' },
        },
      }
    })
    const requested = await client(fetchImpl).requestCancellation('task-1')
    expect(requested.status).toBe('ok')
    if (requested.status !== 'ok') return
    // A request is not a confirmed stop.
    expect(requested.value.cancellation).toBe('requested')
    expect(requested.value.state).not.toBe('cancelled')

    const confirmed = await client(fetchImpl).confirmCancellation('task-1', {
      outcome: 'confirmed',
      idempotencyKey: 'cancel:task-1',
    })
    expect(confirmed.status).toBe('ok')
    if (confirmed.status !== 'ok') return
    expect(confirmed.value.cancellation).toBe('confirmed')
    expect(seen[0].path).toBe('/api/v1/tasks/task-1/cancel')
    expect(seen[1].path).toBe('/api/v1/tasks/task-1/execution/cancellation')
  })

  it('passes a query cursor when listing events', async () => {
    const { fetchImpl, seen } = router(() => ({
      status: 200,
      body: { events: [] },
    }))
    await client(fetchImpl).listEvents('task-1', 7)
    expect(seen[0].query).toBe('?sinceSequence=7')
  })
})

describe('backend task client: failure classification', () => {
  const cases: Array<[number, string]> = [
    [400, 'TASK_STATE_INVALID'],
    [401, 'AUTH_REQUIRED'],
    [404, 'TASK_NOT_FOUND'],
    [422, 'TASK_STATE_INVALID'],
    [429, 'RATE_LIMITED'],
    [500, 'BACKEND_UNAVAILABLE'],
    [503, 'BACKEND_UNAVAILABLE'],
  ]

  for (const [status, code] of cases) {
    it(`classifies HTTP ${status} as ${code}`, async () => {
      const { fetchImpl } = router(() => ({
        status,
        body: { error: { code: 'x', message: 'nope', requestId: 'req-1' } },
      }))
      const result = await client(fetchImpl).getExecution('task-1')
      expect(result.status).toBe('failed')
      if (result.status !== 'failed') return
      expect(result.error.code).toBe(code)
      expect(result.error.message).toBe('nope')
      expect(result.error.correlationId).toBe('req-1')
    })
  }

  it('treats a transport failure as BACKEND_UNAVAILABLE, never success', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('network down')
    }) as unknown as typeof fetch
    const result = await client(fetchImpl).dispatch('task-1')
    expect(result.status).toBe('failed')
    if (result.status !== 'failed') return
    expect(result.error.code).toBe('BACKEND_UNAVAILABLE')
    expect(result.error.retryable).toBe(true)
  })

  it('marks RATE_LIMITED retryable with a delay', async () => {
    const { fetchImpl } = router(() => ({
      status: 429,
      body: { error: { code: 'x', message: 'slow down' } },
    }))
    const result = await client(fetchImpl).reconcile()
    expect(result.status).toBe('failed')
    if (result.status !== 'failed') return
    expect(result.error.retryable).toBe(true)
    expect(result.error.retryAfterMs).toBeGreaterThan(0)
  })
})

describe('backend task client ↔ shared model', () => {
  it('folds mapped events idempotently and never reopens a terminal task', async () => {
    const events = [
      {
        id: 'e1',
        taskId: 'task-1',
        sequence: 1,
        type: 'task.started',
        idempotencyKey: 'k1',
        createdAt: '2026-10-10T00:00:01.000Z',
      },
      {
        id: 'e2',
        taskId: 'task-1',
        sequence: 2,
        type: 'task.completed',
        idempotencyKey: 'k2',
        createdAt: '2026-10-10T00:00:02.000Z',
      },
    ]
    const { fetchImpl } = router(() => ({ status: 200, body: { events } }))
    const result = await client(fetchImpl).listEvents('task-1')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return

    const task = createSharedTask({
      taskId: 'task-1',
      accountId: 'user-1',
      origin: 'aria',
      request: 'add the endpoint',
      contractVersion: '1',
      now: '2026-10-10T00:00:00.000Z',
    })
    let projection = projectTask(task)
    for (const event of result.value.events) {
      projection = applyEvent(projection, event).projection
    }
    expect(projection.state).toBe('completed')
    expect(projection.lastSequence).toBe(2)

    // A redelivered event is a no-op.
    const again = applyEvent(projection, result.value.events[1])
    expect(again.kind).toBe('duplicate')
    expect(again.projection.state).toBe('completed')
  })
})
