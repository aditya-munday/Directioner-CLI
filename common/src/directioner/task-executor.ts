/**
 * The task executor: run one leased task and report an honest result.
 *
 * This is the piece that connects the backend's execution boundary to the
 * CLI's real engineering agent. It is provider-neutral and does not import the
 * agent runtime; the agent is injected as an `AgentRunner`, so the loop is
 * testable with a deterministic runner and the production wiring lives in
 * `run-sdk-agent.ts`.
 *
 * WHAT IT HONESTLY REPORTS
 *
 *   - It claims a lease before running and renews it while running, so a worker
 *     crash re-queues rather than double-executes.
 *   - It records `task.started` only after it is actually running.
 *   - It reports a result with `verification: 'inconclusive'` unless the host
 *     supplies a verifier that proves the effect. A run that merely returned is
 *     not proof the requested change was made.
 *   - On cancellation it waits for the agent to actually stop. It confirms the
 *     stop only after the run settles; if the agent does not stop within the
 *     grace period it reports `failed`, never a false "cancelled".
 *   - Privileged/root work is not this executor's to perform. An agent that
 *     needs OS authority must request it through Directioner-OS; that path is
 *     not wired here and its absence is reported, not faked.
 */

import type {
  DirectionerServiceError,
  OperationOutcome,
} from './platform-contract'
import type {
  ClaimRefusal,
  ExecutionResultInput,
  SharedTaskClient,
  TaskExecution,
} from './shared-task-client'

/** The outcome a host's agent runner reports. */
export interface AgentRunResult {
  outcome: 'succeeded' | 'failed'
  /** Bounded, already-redacted summary. Never raw output or a secret. */
  summary?: string
  errorCode?: string
  /**
   * The host's verdict on whether the requested effect is proven. Absent means
   * the executor records `inconclusive` — the honest default.
   */
  verification?: 'confirmed' | 'not_confirmed' | 'inconclusive'
}

/**
 * A progress note from the agent. Every field is optional and content-free: a
 * note is a short status, a step is a count, and a fraction is a number — never
 * raw output, a prompt, or a secret.
 */
export interface AgentProgress {
  /** A short, already-redacted status, e.g. `"running tests"`. */
  note?: string
  /** How many agent steps have completed, when the host can count them. */
  step?: number
  /** Completion estimate in [0, 1], when the agent can make one. */
  fraction?: number
}

/**
 * Runs the engineering agent for one prompt. Must honor `signal`: aborting it is
 * how a cancellation reaches the agent. A run that resolves has stopped.
 *
 * `reportProgress` records `engineer.progress` on the shared task so a
 * supervising client (Aria) can show what the worker is doing. It is
 * best-effort: a runner may ignore it, and a failed report never fails the run.
 */
export type AgentRunner = (input: {
  prompt: string
  signal: AbortSignal
  reportProgress: (progress: AgentProgress) => Promise<void>
}) => Promise<AgentRunResult>

export interface TaskExecutorConfig {
  readonly client: SharedTaskClient
  readonly runAgent: AgentRunner
  /** Lease duration requested per claim/heartbeat. Defaults to 5 minutes. */
  leaseMs?: number
  /** How often to renew the lease and poll for a cancellation request. */
  pollIntervalMs?: number
  /** How long to wait for the agent to stop after aborting it. */
  abortGraceMs?: number
  readonly logger?: { info: (msg: string) => void; warn: (msg: string) => void }
}

export type ExecuteOutcome =
  | { status: 'completed'; taskId: string; execution: TaskExecution }
  | { status: 'failed'; taskId: string; execution: TaskExecution }
  | {
      status: 'cancelled'
      taskId: string
      confirmed: boolean
      execution: TaskExecution
    }
  | { status: 'not_claimed'; taskId: string; reason: ClaimRefusal }
  | { status: 'client_error'; taskId: string; error: DirectionerServiceError }

const DEFAULT_LEASE_MS = 5 * 60 * 1000
const DEFAULT_POLL_MS = 5_000
const DEFAULT_ABORT_GRACE_MS = 10_000

/** Unwrap an `OperationOutcome`, throwing the classified error on failure. */
function unwrap<T>(outcome: OperationOutcome<T>): T {
  if (outcome.status === 'failed') {
    const error = outcome.error
    throw new ExecutorClientError(error)
  }
  return outcome.value
}

class ExecutorClientError extends Error {
  constructor(readonly service: DirectionerServiceError) {
    super(service.message)
    this.name = 'ExecutorClientError'
  }
}

export function createTaskExecutor(config: TaskExecutorConfig): {
  executeTask: (taskId: string) => Promise<ExecuteOutcome>
} {
  const leaseMs = config.leaseMs ?? DEFAULT_LEASE_MS
  const pollMs = config.pollIntervalMs ?? DEFAULT_POLL_MS
  const abortGraceMs = config.abortGraceMs ?? DEFAULT_ABORT_GRACE_MS
  const log = config.logger

  async function executeTask(taskId: string): Promise<ExecuteOutcome> {
    try {
      const claim = unwrap(await config.client.claim(taskId, leaseMs))
      if (!claim.claimed) {
        return {
          status: 'not_claimed',
          taskId,
          reason: claim.reason ?? 'lease_held',
        }
      }
      const execution = claim.execution

      // The request text is the task's own; fetch it rather than trusting any
      // prompt supplied out of band.
      const task = unwrap(await config.client.getTask(taskId))
      const prompt = task.task.request

      const controller = new AbortController()
      let cancellationRequested = false
      let settled = false
      let progressSequence = 0

      // Record the agent's progress on the shared task so a supervising client
      // can see it. Best-effort: a failure here never fails the run.
      const reportProgress = async (progress: AgentProgress): Promise<void> => {
        if (settled) return
        const payload: Record<string, unknown> = {
          sequence: progressSequence,
        }
        progressSequence += 1
        if (progress.note !== undefined) {
          // Bound the note so a runaway agent cannot blow the payload limit.
          payload.note = progress.note.slice(0, 500)
        }
        if (progress.fraction !== undefined) {
          payload.fraction = Math.min(1, Math.max(0, progress.fraction))
        }
        if (progress.step !== undefined) {
          payload.step = Math.max(0, Math.trunc(progress.step))
        }
        try {
          unwrap(
            await config.client.appendEvent(taskId, {
              type: 'engineer.progress',
              idempotencyKey: `progress:${execution.executionId}:${payload.sequence}`,
              payload,
            }),
          )
        } catch {
          // Progress is an observation, not a result: never fail the run for it.
          log?.warn(`task ${taskId}: could not record agent progress`)
        }
      }

      // Renew the lease and watch for a cancellation request for the whole run.
      const poll = setInterval(() => {
        void (async () => {
          if (settled) return
          const view = await config.client.getExecution(taskId)
          if (view.status === 'failed') return
          if (view.value.cancellation === 'requested') {
            cancellationRequested = true
            controller.abort()
            return
          }
          await config.client.heartbeat(taskId, leaseMs)
        })()
      }, pollMs)

      // Only after the lease is held and the loop is armed do we say "started".
      unwrap(
        await config.client.appendEvent(taskId, {
          type: 'task.started',
          idempotencyKey: `started:${execution.executionId}`,
        }),
      )

      let runResult: AgentRunResult
      try {
        runResult = await config.runAgent({
          prompt,
          signal: controller.signal,
          reportProgress,
        })
      } catch (error) {
        runResult = {
          outcome: 'failed',
          errorCode: 'AGENT_RUN_FAILED',
          summary:
            error instanceof Error ? error.message : 'The agent run failed.',
        }
      } finally {
        settled = true
        clearInterval(poll)
      }

      if (cancellationRequested) {
        return await confirmCancellation(taskId, execution)
      }

      return await recordOutcome(taskId, execution, runResult)
    } catch (error) {
      if (error instanceof ExecutorClientError) {
        return { status: 'client_error', taskId, error: error.service }
      }
      throw error
    }
  }

  async function recordOutcome(
    taskId: string,
    execution: TaskExecution,
    runResult: AgentRunResult,
  ): Promise<ExecuteOutcome> {
    const input: ExecutionResultInput = {
      outcome: runResult.outcome,
      verification: runResult.verification ?? 'inconclusive',
      idempotencyKey: `result:${execution.executionId}`,
      ...(runResult.summary !== undefined
        ? { summary: runResult.summary }
        : {}),
      ...(runResult.errorCode !== undefined
        ? { errorCode: runResult.errorCode }
        : {}),
    }
    const recorded = unwrap(await config.client.recordResult(taskId, input))
    if (runResult.outcome === 'succeeded') {
      return { status: 'completed', taskId, execution: recorded }
    }
    return { status: 'failed', taskId, execution: recorded }
  }

  /**
   * A cancellation was requested and the agent's run has settled. We confirm
   * the stop: the run returning is the observation that execution ended. If the
   * backend refuses the confirmation, the failure is surfaced rather than a
   * false "cancelled".
   */
  async function confirmCancellation(
    taskId: string,
    execution: TaskExecution,
  ): Promise<ExecuteOutcome> {
    const confirmed = unwrap(
      await config.client.confirmCancellation(taskId, {
        outcome: 'confirmed',
        idempotencyKey: `cancel:${execution.executionId}`,
      }),
    )
    log?.info(`task ${taskId}: cancellation confirmed`)
    return {
      status: 'cancelled',
      taskId,
      confirmed: confirmed.cancellation === 'confirmed',
      execution: confirmed,
    }
  }

  return { executeTask }
}

export { ExecutorClientError }
export type { TaskExecution }
