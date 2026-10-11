// The SDK agent runner is the seam where a real run becomes a shared-task
// result and progress. What matters is that it reports honestly and that its
// progress notes carry no content: only a step count, never a message, a tool
// result, or a prompt. The `run` function is injected, so this runs the real
// adapter without a model.

import { describe, expect, it } from 'bun:test'

import { createSdkAgentRunner, progressFromSnapshot, toAgentRunResult } from '../directioner/run-sdk-agent'

import type { RunState } from '../run-state'

function snapshot(messageCount: number): RunState {
  return {
    output: { type: 'text', content: 'done' },
    traceSessionId: 'trace-1',
    sessionState: {
      mainAgentState: {
        messageHistory: Array.from({ length: messageCount }, () => ({})),
      },
    },
  } as unknown as RunState
}

describe('progressFromSnapshot', () => {
  it('reports only a step count, never message content', () => {
    const progress = progressFromSnapshot(snapshot(7))
    expect(progress).toEqual({ step: 7 })
  })

  it('reports nothing when there is no history', () => {
    const bare = { output: { type: 'text', content: 'x' }, traceSessionId: 't' } as unknown as RunState
    expect(progressFromSnapshot(bare)).toEqual({})
  })

  it('reports a bounded completion fraction when a step ceiling is known', () => {
    expect(progressFromSnapshot(snapshot(5), 20)).toEqual({ step: 5, fraction: 0.25 })
  })

  it('clamps the fraction to one when the run exceeds its ceiling', () => {
    expect(progressFromSnapshot(snapshot(30), 20)).toEqual({ step: 30, fraction: 1 })
  })

  it('omits the fraction for a non-positive ceiling rather than dividing by it', () => {
    expect(progressFromSnapshot(snapshot(3), 0)).toEqual({ step: 3 })
  })
})

describe('toAgentRunResult', () => {
  it('treats an error output as a failed run', () => {
    const failed = {
      output: { type: 'error', message: 'boom' },
      traceSessionId: 't',
    } as unknown as RunState
    expect(toAgentRunResult(failed)).toMatchObject({ outcome: 'failed', summary: 'boom' })
  })

  it('never claims verification for a run that merely returned', () => {
    const done = { output: { type: 'text', content: 'ok' }, traceSessionId: 't' } as unknown as RunState
    expect(toAgentRunResult(done).verification).toBeUndefined()
  })
})

describe('createSdkAgentRunner', () => {
  it('reports a progress step for each checkpoint snapshot', async () => {
    const reported: unknown[] = []
    const runner = createSdkAgentRunner({
      cwd: '/repo',
      apiKey: 'k',
      fingerprintId: 'fp',
      runFn: (async (options: { onStateSnapshot?: (s: RunState) => void }) => {
        options.onStateSnapshot?.(snapshot(1))
        options.onStateSnapshot?.(snapshot(4))
        return { output: { type: 'text', content: 'ok' }, traceSessionId: 't' } as unknown as RunState
      }) as unknown as typeof import('../run').run,
    })

    const result = await runner({
      prompt: 'do it',
      signal: new AbortController().signal,
      reportProgress: async (p) => {
        reported.push(p)
      },
    })

    expect(reported).toEqual([{ step: 1 }, { step: 4 }])
    expect(result).toEqual({ outcome: 'succeeded' })
  })

  it('carries the step ceiling into the reported progress fraction', async () => {
    const reported: unknown[] = []
    const runner = createSdkAgentRunner({
      cwd: '/repo',
      apiKey: 'k',
      fingerprintId: 'fp',
      maxAgentSteps: 8,
      runFn: (async (options: { onStateSnapshot?: (s: RunState) => void }) => {
        options.onStateSnapshot?.(snapshot(2))
        options.onStateSnapshot?.(snapshot(6))
        return { output: { type: 'text', content: 'ok' }, traceSessionId: 't' } as unknown as RunState
      }) as unknown as typeof import('../run').run,
    })

    await runner({
      prompt: 'do it',
      signal: new AbortController().signal,
      reportProgress: async (p) => {
        reported.push(p)
      },
    })

    expect(reported).toEqual([
      { step: 2, fraction: 0.25 },
      { step: 6, fraction: 0.75 },
    ])
  })
})
