/**
 * Production `AgentRunner` that drives the real CLI engineering agent.
 *
 * This is the one place the executor meets `@beyonders/sdk`'s `run()`. It is a
 * thin adapter on purpose: the loop, the lease handling, and the truthfulness
 * rules live in `task-executor.ts`; this file only translates a task prompt into
 * a run and a `RunState` back into an `AgentRunResult`.
 *
 * It imports the SDK lazily, so importing `task-executor` (or the client) never
 * pulls the agent runtime, the tools, or the model providers into a process that
 * only needs to talk to the backend. Tests inject their own `AgentRunner`.
 */

import type { RunState } from '../run-state'
import type { RunOptions } from '../run'
import type {
  AgentProgress,
  AgentRunResult,
  AgentRunner,
} from '@beyonders/common/directioner/task-executor'

export interface SdkAgentRunnerConfig {
  /** The working directory the agent acts on — the user's project. */
  cwd: string
  /** Agent template id to run. Defaults to `'base'`. */
  agent?: string
  /** Model API key, supplied at run time by the host. Never persisted here. */
  apiKey: string
  /** Stable per-run identifier for tracing. */
  fingerprintId: string
  /** Extra SDK options the host already resolved (byok, env, tools, ...). */
  runOptions?: Partial<RunOptions>
  /** Upper bound on agent steps, so a runaway loop cannot hold a lease forever. */
  maxAgentSteps?: number
  /**
   * The SDK `run` function. Defaults to the real one, imported lazily; a test
   * injects a stub so the adapter can be exercised without a model.
   */
  runFn?: typeof import('../run').run
}

/**
 * A content-free progress note from a run snapshot: how many messages the agent
 * has accumulated, i.e. roughly how many steps it has taken. Never the message
 * text, a tool result, or a prompt — those stay in the run's local state.
 */
export function progressFromSnapshot(runState: RunState): AgentProgress {
  const history = runState.sessionState?.mainAgentState?.messageHistory
  if (!Array.isArray(history)) return {}
  return { step: history.length }
}

/**
 * Turn a `RunState` into an honest `AgentRunResult`.
 *
 * A run that returned is never reported as verified. The only success signal is
 * a non-error `output`; the verification verdict is left to the host (absent →
 * the executor records `inconclusive`). Cancellation is not a result: an
 * aborted run is left for the executor's cancellation path, not reported as a
 * failed task.
 */
export function toAgentRunResult(run: RunState): AgentRunResult {
  const output = run.output
  if (output.type === 'error') {
    return {
      outcome: 'failed',
      errorCode: 'AGENT_RUN_FAILED',
      summary: output.message,
    }
  }
  return { outcome: 'succeeded' }
}

export function createSdkAgentRunner(
  config: SdkAgentRunnerConfig,
): AgentRunner {
  return async ({ prompt, signal, reportProgress }) => {
    const runFn = config.runFn ?? (await import('../run')).run
    const runState = await runFn({
      agent: config.agent ?? 'base',
      prompt,
      cwd: config.cwd,
      apiKey: config.apiKey,
      fingerprintId: config.fingerprintId,
      signal,
      // Each checkpoint snapshot becomes one engineer.progress event, so a
      // supervising client sees the run advance without any message content.
      onStateSnapshot: (snapshot) => {
        void reportProgress(progressFromSnapshot(snapshot))
      },
      ...(config.maxAgentSteps !== undefined
        ? { maxAgentSteps: config.maxAgentSteps }
        : {}),
      ...config.runOptions,
    })
    return toAgentRunResult(runState)
  }
}
