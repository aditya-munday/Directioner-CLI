import { describe, expect, test } from 'bun:test'

import { PerfRecorder, nowMs, percentile } from '../perf-metrics'

describe('PerfRecorder', () => {
  test('is disabled by default when DIRECTIONER_PERF is unset', () => {
    const previous = process.env.DIRECTIONER_PERF
    delete process.env.DIRECTIONER_PERF
    try {
      expect(new PerfRecorder().isEnabled).toBe(false)
    } finally {
      if (previous !== undefined) process.env.DIRECTIONER_PERF = previous
    }
  })

  test('records nothing when disabled', async () => {
    const recorder = new PerfRecorder({ enabled: false })
    await recorder.span('phase', 'run-1', () => 42)
    recorder.record({ name: 'phase', runId: 'run-1', ms: 5 })
    expect(recorder.snapshot().spans).toHaveLength(0)
    expect(recorder.summary()).toHaveLength(0)
  })

  test('records a span and returns the wrapped result', async () => {
    const recorder = new PerfRecorder({ enabled: true })
    const value = await recorder.span('context.build', 'run-1', () => 'built')
    expect(value).toBe('built')
    const spans = recorder.snapshot().spans
    expect(spans).toHaveLength(1)
    expect(spans[0].name).toBe('context.build')
    expect(spans[0].runId).toBe('run-1')
    expect(spans[0].ms).toBeGreaterThanOrEqual(0)
  })

  test('records a span even when the wrapped fn throws, then rethrows', async () => {
    const recorder = new PerfRecorder({ enabled: true })
    await expect(
      recorder.span('provider.route', 'run-2', () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(recorder.snapshot().spans.map((s) => s.name)).toEqual(['provider.route'])
  })

  test('is bounded by maxSpans', () => {
    const recorder = new PerfRecorder({ enabled: true, maxSpans: 3 })
    for (let i = 0; i < 10; i++) {
      recorder.record({ name: 'x', runId: 'r', ms: i })
    }
    expect(recorder.snapshot().spans).toHaveLength(3)
  })

  test('summary aggregates by name with sorted totals and percentiles', () => {
    const recorder = new PerfRecorder({ enabled: true })
    for (const ms of [1, 2, 3, 4, 5, 100]) {
      recorder.record({ name: 'slow', runId: 'r', ms })
    }
    recorder.record({ name: 'fast', runId: 'r', ms: 0.5 })
    const summary = recorder.summary()
    expect(summary[0].name).toBe('slow')
    expect(summary[0].count).toBe(6)
    expect(summary[0].totalMs).toBe(115)
    expect(summary[0].minMs).toBe(1)
    expect(summary[0].maxMs).toBe(100)
    expect(summary[0].p50Ms).toBe(3)
    // nearest-rank p95 of 6 samples is index ceil(0.95*6)-1 = 5 -> max
    expect(summary[0].p95Ms).toBe(100)
    expect(summary[1].name).toBe('fast')
  })

  test('snapshot reports memory in bytes', () => {
    const snapshot = new PerfRecorder({ enabled: true }).snapshot()
    expect(snapshot.rssBytes).toBeGreaterThan(0)
    expect(snapshot.heapUsedBytes).toBeGreaterThan(0)
  })

  test('reset clears recorded spans', () => {
    const recorder = new PerfRecorder({ enabled: true })
    recorder.record({ name: 'a', runId: 'r', ms: 1 })
    recorder.reset()
    expect(recorder.snapshot().spans).toHaveLength(0)
  })
})

describe('nowMs and percentile', () => {
  test('nowMs is monotonic across calls', () => {
    const a = nowMs()
    const b = nowMs()
    expect(b).toBeGreaterThanOrEqual(a)
  })

  test('percentile uses nearest rank on sorted input', () => {
    expect(percentile([], 0.5)).toBe(0)
    expect(percentile([1], 0.95)).toBe(1)
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5)).toBe(5)
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10)
  })
})
