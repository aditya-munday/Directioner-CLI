/**
 * End-to-end test of the delegation wiring: real HTTP transport + real executor
 * loop + a deterministic agent.
 *
 * The backend double is a stateful `fetch` router that speaks the execution
 * boundary's HTTP contract. It records the order of the calls it sees, so the
 * test can assert the *behavioural* invariant that matters — a lease is claimed
 * before the agent starts, and the result is recorded after it stops — rather
 * than mocking the executor.
 */

import { describe, expect, it } from 'bun:test'

import { createBackendExecutor } from '../task-delegation'

const TASK = {
  id: 'task-1',
  userId: 'user-1',
  title: 'add the missing endpoint',
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('task delegation: runPending', () => {
  it('lists runnable tasks, leases one, runs the agent, and records the result', async () => {
    const calls: string[] = []
    let resultBody: unknown

    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      const path = url.pathname
      calls.push(`${init?.method ?? 'GET'} ${path}`)
      switch (path) {
        case '/api/v1/executions/runnable':
          return json({ executions: [EXECUTION] })
        case '/api/v1/tasks/task-1':
          return json({ task: TASK })
        case '/api/v1/tasks/task-1/execution/claim':
          return json({
            execution: { ...EXECUTION, state: 'leased' },
            claimed: true,
          })
        case '/api/v1/tasks/task-1/events':
          return json({
            event: {
              id: 'evt-1',
              taskId: 'task-1',
              sequence: 1,
              type: 'task.started',
              idempotencyKey: 'started:exec-1',
              createdAt: '2026-10-10T00:00:02.000Z',
            },
          })
        case '/api/v1/tasks/task-1/execution/result':
          resultBody =
            init?.body !== undefined ? JSON.parse(String(init.body)) : undefined
          return json({
            execution: {
              ...EXECUTION,
              state: 'completed',
              verification: 'inconclusive',
            },
          })
        default:
          return json({ error: { code: 'NOT_FOUND', message: path } }, 404)
      }
    }) as unknown as typeof fetch

    let promptSeen: string | undefined
    const executor = createBackendExecutor({
      baseUrl: 'https://api.directioner.example',
      getAccessToken: async () => 'tok',
      fetchImpl,
      runAgent: async ({ prompt }) => {
        promptSeen = prompt
        return { outcome: 'succeeded' }
      },
      pollIntervalMs: 60_000,
    })

    const outcomes = await executor.runPending(5)
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0].status).toBe('completed')

    // The agent ran on the task's own request text, not an out-of-band prompt.
    expect(promptSeen).toBe('add the missing endpoint')

    // Ordering: the lease is acquired before the agent starts; started is
    // journaled after the claim; the result is recorded last.
    const claimAt = calls.indexOf('POST /api/v1/tasks/task-1/execution/claim')
    const startedAt = calls.indexOf('POST /api/v1/tasks/task-1/events')
    const resultAt = calls.indexOf('POST /api/v1/tasks/task-1/execution/result')
    expect(claimAt).toBeGreaterThanOrEqual(0)
    expect(startedAt).toBeGreaterThan(claimAt)
    expect(resultAt).toBeGreaterThan(startedAt)

    // Absence of a verifier means the effect is not claimed proven.
    expect(resultBody).toMatchObject({
      outcome: 'succeeded',
      verification: 'inconclusive',
    })
  })

  it('reports a backend failure as a client_error, not a silent empty queue', async () => {
    const fetchImpl = (async () =>
      json(
        { error: { code: 'UNAUTHENTICATED', message: 'sign in' } },
        401,
      )) as unknown as typeof fetch

    const executor = createBackendExecutor({
      baseUrl: 'https://api.directioner.example',
      getAccessToken: async () => 'expired',
      fetchImpl,
      runAgent: async () => ({ outcome: 'succeeded' }),
    })

    const outcomes = await executor.runPending()
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0].status).toBe('client_error')
    if (outcomes[0].status !== 'client_error') return
    expect(outcomes[0].error.code).toBe('AUTH_REQUIRED')
  })
})
