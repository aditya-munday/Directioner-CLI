/**
 * A real HTTP implementation of `SharedTaskClient` against the Directioner
 * Platform Backend's task execution boundary.
 *
 * This is the production transport the CLI's executor uses. It is deliberately
 * narrow:
 *
 *   - It holds a base URL and a *callback* that returns the current in-memory
 *     access token. It never stores a refresh token, never reads a provider key,
 *     and never logs a credential.
 *   - It performs no privileged operation and defines no remote-shell route.
 *     Running a task happens locally in the executor; this client only opens the
 *     task, claims its lease, and reports honest events and results.
 *   - Every failure is classified into the shared `DirectionerServiceError`
 *     vocabulary, so an uncertain outcome is never mistaken for success.
 *
 * The wire vocabulary is the backend's own (`docs/TASK-EXECUTION-CONTRACT.md` in
 * the platform repo); responses are validated before they are trusted.
 */

import { z } from 'zod'

import {
  classifyError,
  type DirectionerErrorCode,
  type DirectionerServiceError,
  type DirectionerTask,
  type OperationOutcome,
  type ApprovalDecision,
  type TaskEvent,
  type TaskEventType,
  type TaskState,
} from './platform-contract'
import type {
  AppendEventInput,
  ClaimResult,
  DispatchInput,
  ExecutionResultInput,
  Page,
  SharedTaskClient,
  TaskExecution,
} from './shared-task-client'

export interface BackendClientConfig {
  /** Backend origin, e.g. `https://api.directioner.example`. No trailing slash needed. */
  baseUrl: string
  /**
   * Returns the current bearer token. The token lives in memory on the client;
   * this callback is the only way it reaches the adapter, so the adapter never
   * persists it.
   */
  getAccessToken: () => Promise<string>
  /** Injectable for tests and non-global-fetch runtimes. */
  fetchImpl?: typeof fetch
  /** Per-request timeout. A hung backend must fail as BACKEND_UNAVAILABLE. */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 30_000

// ---------------------------------------------------------------------------
// Wire schemas (subset the executor relies on)
// ---------------------------------------------------------------------------

const taskSchema = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string(),
  status: z.enum([
    'draft',
    'awaiting_approval',
    'approved',
    'running',
    'succeeded',
    'failed',
    'cancelled',
  ]),
  version: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const executionSchema = z.object({
  taskId: z.string(),
  userId: z.string(),
  executionId: z.string(),
  origin: z.enum(['cli', 'website', 'aria', 'desktop', 'gui']),
  state: z.enum([
    'pending',
    'leased',
    'running',
    'completed',
    'failed',
    'cancelled',
  ]),
  attempt: z.number(),
  leaseOwner: z.string().optional(),
  leaseExpiresAt: z.string().optional(),
  cancellation: z.enum(['none', 'requested', 'confirmed', 'unknown', 'failed']),
  result: z.record(z.string(), z.unknown()).optional(),
  verification: z.enum([
    'unverified',
    'confirmed',
    'not_confirmed',
    'inconclusive',
  ]),
  errorCode: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const eventSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  sequence: z.number(),
  type: z.string(),
  idempotencyKey: z.string(),
  payload: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string(),
})

const problemSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
  }),
})

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const STATUS_TO_CODE: Record<number, DirectionerErrorCode> = {
  400: 'TASK_STATE_INVALID',
  401: 'AUTH_REQUIRED',
  403: 'ENTITLEMENT_DENIED',
  404: 'TASK_NOT_FOUND',
  409: 'TASK_STATE_INVALID',
  422: 'TASK_STATE_INVALID',
  429: 'RATE_LIMITED',
}

function codeForStatus(status: number): DirectionerErrorCode {
  if (status in STATUS_TO_CODE) return STATUS_TO_CODE[status]
  if (status >= 500) return 'BACKEND_UNAVAILABLE'
  return 'LOCAL_EXECUTION_FAILED'
}

function mappingState(status: z.infer<typeof taskSchema>['status']): TaskState {
  switch (status) {
    case 'draft':
      return 'created'
    case 'awaiting_approval':
      return 'waiting_for_user'
    case 'approved':
      return 'queued'
    case 'running':
      return 'running'
    case 'succeeded':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'cancelled':
      return 'cancelled'
  }
}

/**
 * Map a backend event type onto the shared model's vocabulary. The shared set is
 * not closed: a type the model does not know is folded as a benign
 * `task.updated`, which carries no lifecycle authority, rather than dropped or
 * mis-reported.
 */
function mappingEventType(type: string): TaskEventType {
  switch (type) {
    case 'task.created':
    case 'task.started':
    case 'task.paused':
    case 'task.resumed':
    case 'task.updated':
    case 'task.cancelled':
    case 'task.failed':
    case 'task.recovered':
    case 'task.completed':
    case 'tool.completed':
    case 'approval.requested':
    case 'approval.granted':
    case 'approval.denied':
    case 'security.event':
      return type
    case 'cancellation.requested':
      return 'task.updated'
    case 'verification.recorded':
      return 'task.updated'
    default:
      return 'task.updated'
  }
}

function toTask(row: z.infer<typeof taskSchema>): DirectionerTask {
  return {
    taskId: row.id,
    accountId: row.userId,
    deviceId: '',
    sessionId: '',
    request: row.title,
    workspace: { path: '' },
    state: mappingState(row.status),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toTaskEvent(row: z.infer<typeof eventSchema>): TaskEvent {
  return {
    eventId: row.id,
    taskId: row.taskId,
    sequence: row.sequence,
    type: mappingEventType(row.type),
    timestamp: row.createdAt,
    correlationId: '',
    idempotencyKey: row.idempotencyKey,
    ...(row.payload !== undefined ? { payload: row.payload } : {}),
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

class HttpFailure {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {}
}

export function createBackendTaskClient(
  config: BackendClientConfig,
): SharedTaskClient {
  const doFetch = config.fetchImpl ?? fetch
  const base = config.baseUrl.replace(/\/+$/, '')
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS

  async function raw(
    method: 'GET' | 'POST',
    path: string,
    options: {
      query?: Record<string, string | number | undefined>
      body?: unknown
    } = {},
  ): Promise<unknown> {
    const url = new URL(`${base}${path}`)
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
    const token = await config.getAccessToken()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response: Response
    try {
      response = await doFetch(url.toString(), {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        ...(options.body !== undefined
          ? { body: JSON.stringify(options.body) }
          : {}),
        signal: controller.signal,
      })
    } catch {
      // A transport failure is an uncertain outcome, never success.
      throw new HttpFailure(0, undefined)
    } finally {
      clearTimeout(timer)
    }

    let parsed: unknown = undefined
    const text = await response.text()
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = undefined
      }
    }
    if (!response.ok) throw new HttpFailure(response.status, parsed)
    return parsed
  }

  function failure(error: unknown): DirectionerServiceError {
    if (error instanceof HttpFailure) {
      if (error.status === 0) {
        return classifyError(
          'BACKEND_UNAVAILABLE',
          'Could not reach the Directioner backend.',
        )
      }
      const code = codeForStatus(error.status)
      const problem = problemSchema.safeParse(error.body)
      const message = problem.success
        ? problem.data.error.message
        : `The backend rejected the request (${error.status}).`
      return classifyError(code, message, {
        retryAfterMs: code === 'RATE_LIMITED' ? 1_000 : undefined,
        correlationId: problem.success
          ? problem.data.error.requestId
          : undefined,
      })
    }
    return classifyError('LOCAL_EXECUTION_FAILED', 'The task request failed.')
  }

  /** Run a call and fold the result into an `OperationOutcome`. */
  async function outcome<T>(
    fn: () => Promise<T>,
  ): Promise<OperationOutcome<T>> {
    try {
      return { status: 'ok', value: await fn() }
    } catch (error) {
      return { status: 'failed', error: failure(error) }
    }
  }

  return {
    createTask: (input) =>
      outcome(async () => {
        const body = await raw('POST', '/api/v1/tasks', {
          body: { title: input.request },
        })
        return {
          task: toTask(taskSchema.parse((body as { task: unknown }).task)),
        }
      }),

    getTask: (taskId) =>
      outcome(async () => {
        const body = await raw(
          'GET',
          `/api/v1/tasks/${encodeURIComponent(taskId)}`,
        )
        return {
          task: toTask(taskSchema.parse((body as { task: unknown }).task)),
        }
      }),

    listTasks: (limit) =>
      outcome(async () => {
        const body = await raw('GET', '/api/v1/tasks', { query: { limit } })
        const parsed = body as { items: unknown[] }
        return {
          items: parsed.items.map((row) => toTask(taskSchema.parse(row))),
        } satisfies Page<DirectionerTask>
      }),

    requestApproval: (taskId) =>
      outcome(async () => {
        const body = await raw('POST', '/api/v1/approvals', {
          body: { taskId },
        })
        const parsed = body as {
          approval: Record<string, unknown>
          task?: unknown
        }
        return {
          approval: parsed.approval,
          ...(parsed.task !== undefined
            ? { task: toTask(taskSchema.parse(parsed.task)) }
            : {}),
        }
      }),

    submitApproval: (input) =>
      outcome(async () => {
        const body = await raw(
          'POST',
          `/api/v1/approvals/${encodeURIComponent(input.approvalId)}/decision`,
          {
            body: {
              decision: input.decision === 'granted' ? 'approved' : 'rejected',
              ...(input.reason !== undefined ? { reason: input.reason } : {}),
            },
          },
        )
        const parsed = body as {
          approval: Record<string, unknown>
          task: unknown
        }
        return {
          approval: parsed.approval,
          task: toTask(taskSchema.parse(parsed.task)),
        }
      }),

    dispatch: (taskId, input) =>
      outcome(async () => {
        const body = await raw(
          'POST',
          `/api/v1/tasks/${encodeURIComponent(taskId)}/dispatch`,
          {
            body: input ?? {},
          },
        )
        return executionSchema.parse((body as { execution: unknown }).execution)
      }),

    getExecution: (taskId) =>
      outcome(async () => {
        const body = await raw(
          'GET',
          `/api/v1/tasks/${encodeURIComponent(taskId)}/execution`,
        )
        return executionSchema.parse((body as { execution: unknown }).execution)
      }),

    listRunnable: (limit) =>
      outcome(async () => {
        const body = await raw('GET', '/api/v1/executions/runnable', {
          query: { limit },
        })
        const parsed = body as { executions: unknown[] }
        return parsed.executions.map((row) => executionSchema.parse(row))
      }),

    claim: (taskId, leaseMs) =>
      outcome(async () => {
        const body = await raw(
          'POST',
          `/api/v1/tasks/${encodeURIComponent(taskId)}/execution/claim`,
          {
            body: leaseMs !== undefined ? { leaseMs } : {},
          },
        )
        const parsed = body as {
          execution: unknown
          claimed: boolean
          reason?: ClaimResult['reason']
        }
        return {
          execution: executionSchema.parse(parsed.execution),
          claimed: parsed.claimed,
          ...(parsed.reason !== undefined ? { reason: parsed.reason } : {}),
        } satisfies ClaimResult
      }),

    heartbeat: (taskId, leaseMs) =>
      outcome(async () => {
        const body = await raw(
          'POST',
          `/api/v1/tasks/${encodeURIComponent(taskId)}/execution/heartbeat`,
          {
            body: leaseMs !== undefined ? { leaseMs } : {},
          },
        )
        const parsed = body as { execution: unknown; claimed: boolean }
        return {
          execution: executionSchema.parse(parsed.execution),
          claimed: parsed.claimed,
        } satisfies ClaimResult
      }),

    appendEvent: (taskId, input) =>
      outcome(async () => {
        const body = await raw(
          'POST',
          `/api/v1/tasks/${encodeURIComponent(taskId)}/events`,
          {
            body: eventBody(input),
          },
        )
        return {
          event: toTaskEvent(
            eventSchema.parse((body as { event: unknown }).event),
          ),
        }
      }),

    listEvents: (taskId, sinceSequence) =>
      outcome(async () => {
        const body = await raw(
          'GET',
          `/api/v1/tasks/${encodeURIComponent(taskId)}/events`,
          {
            query: { sinceSequence },
          },
        )
        const parsed = body as { events: unknown[] }
        return {
          events: parsed.events.map((row) =>
            toTaskEvent(eventSchema.parse(row)),
          ),
        }
      }),

    recordResult: (taskId, input) =>
      outcome(async () => {
        const body = await raw(
          'POST',
          `/api/v1/tasks/${encodeURIComponent(taskId)}/execution/result`,
          {
            body: resultBody(input),
          },
        )
        return executionSchema.parse((body as { execution: unknown }).execution)
      }),

    requestCancellation: (taskId) =>
      outcome(async () => {
        const body = await raw(
          'POST',
          `/api/v1/tasks/${encodeURIComponent(taskId)}/cancel`,
        )
        return executionSchema.parse((body as { execution: unknown }).execution)
      }),

    confirmCancellation: (taskId, input) =>
      outcome(async () => {
        const body = await raw(
          'POST',
          `/api/v1/tasks/${encodeURIComponent(taskId)}/execution/cancellation`,
          {
            body: {
              outcome: input.outcome,
              idempotencyKey: input.idempotencyKey,
              ...(input.reason !== undefined ? { reason: input.reason } : {}),
            },
          },
        )
        return executionSchema.parse((body as { execution: unknown }).execution)
      }),

    reconcile: () =>
      outcome(async () => {
        const body = await raw('POST', '/api/v1/executions/reconcile')
        return { requeued: (body as { requeued: number }).requeued }
      }),
  }
}

function eventBody(input: AppendEventInput): Record<string, unknown> {
  return {
    type: input.type,
    idempotencyKey: input.idempotencyKey,
    ...(input.payload !== undefined ? { payload: input.payload } : {}),
  }
}

function resultBody(input: ExecutionResultInput): Record<string, unknown> {
  return {
    outcome: input.outcome,
    verification: input.verification,
    idempotencyKey: input.idempotencyKey,
    ...(input.summary !== undefined ? { summary: input.summary } : {}),
    ...(input.artifactRefs !== undefined
      ? { artifactRefs: input.artifactRefs }
      : {}),
    ...(input.errorCode !== undefined ? { errorCode: input.errorCode } : {}),
  }
}

export type { TaskExecution, ApprovalDecision }
