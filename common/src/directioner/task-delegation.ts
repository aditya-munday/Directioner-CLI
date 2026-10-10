/**
 * Task delegation: the wiring that turns a backend execution boundary into
 * work this process actually runs.
 *
 * `createBackendExecutor` is the single entry point the CLI (or an automation
 * such as Aria) calls. It composes the three pieces that must agree:
 *
 *   - the real HTTP client (`createBackendTaskClient`),
 *   - the executor loop (`createTaskExecutor`), and
 *   - a host-supplied `AgentRunner` (the engineering agent).
 *
 * Keeping the agent injected is deliberate: `common` stays free of the agent
 * runtime, the loop stays testable, and the production runner lives in `sdk`.
 *
 * `runPending` is the worker loop: pull the runnable queue and run what this
 * worker can lease. A task whose lease is held elsewhere is skipped, not stolen.
 */

import {
  createBackendTaskClient,
  type BackendClientConfig,
} from './backend-http-client'
import {
  createTaskExecutor,
  type AgentRunner,
  type ExecuteOutcome,
} from './task-executor'
import type { SharedTaskClient } from './shared-task-client'

export interface BackendExecutorConfig {
  /** Backend origin. */
  baseUrl: string
  /** Returns the current in-memory access token; never a persisted secret. */
  getAccessToken: () => Promise<string>
  /** The engineering agent to run for each task. */
  runAgent: AgentRunner
  /** Injectable fetch, for tests and non-global-fetch runtimes. */
  fetchImpl?: typeof fetch
  timeoutMs?: number
  leaseMs?: number
  pollIntervalMs?: number
  logger?: { info: (msg: string) => void; warn: (msg: string) => void }
}

export interface BackendExecutor {
  readonly client: SharedTaskClient
  /** Run one specific task (claiming its lease first). */
  executeTask: (taskId: string) => Promise<ExecuteOutcome>
  /**
   * Pull the runnable queue and run every task this worker can lease. Returns
   * one outcome per runnable task; a task held elsewhere is reported as
   * `not_claimed`, never silently skipped or double-run.
   */
  runPending: (limit?: number) => Promise<ExecuteOutcome[]>
}

export function createBackendExecutor(
  config: BackendExecutorConfig,
): BackendExecutor {
  const clientConfig: BackendClientConfig = {
    baseUrl: config.baseUrl,
    getAccessToken: config.getAccessToken,
    ...(config.fetchImpl !== undefined ? { fetchImpl: config.fetchImpl } : {}),
    ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
  }
  const client = createBackendTaskClient(clientConfig)
  const { executeTask } = createTaskExecutor({
    client,
    runAgent: config.runAgent,
    ...(config.leaseMs !== undefined ? { leaseMs: config.leaseMs } : {}),
    ...(config.pollIntervalMs !== undefined
      ? { pollIntervalMs: config.pollIntervalMs }
      : {}),
    ...(config.logger !== undefined ? { logger: config.logger } : {}),
  })

  async function runPending(limit = 10): Promise<ExecuteOutcome[]> {
    const listed = await client.listRunnable(limit)
    if (listed.status === 'failed') {
      return [{ status: 'client_error', taskId: '', error: listed.error }]
    }
    const outcomes: ExecuteOutcome[] = []
    for (const execution of listed.value) {
      outcomes.push(await executeTask(execution.taskId))
    }
    return outcomes
  }

  return { client, executeTask, runPending }
}
