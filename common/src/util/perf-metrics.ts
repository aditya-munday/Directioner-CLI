/**
 * Local performance instrumentation.
 *
 * Measures phases of local work — context construction, provider routing,
 * serialization, redaction — so slowdowns can be attributed rather than
 * guessed at. Two deliberate constraints:
 *
 *   - **Local only.** Nothing here opens a socket, reads a telemetry key, or
 *     touches the analytics client. Perf data stays on the machine; a caller
 *     that wants to persist it writes JSON itself. This keeps the Directioner
 *     "no telemetry egress" guarantee intact (§ documented in
 *     `cli/src/utils/analytics.ts`), and the regression suite proves enabling
 *     perf does not turn PostHog back on.
 *   - **Cheap when off.** `PerfRecorder` is a no-op unless enabled, so it can
 *     be left in a hot path. `enabled` is read once; the disabled path is a
 *     boolean check and a return.
 *
 * Clock: `performance.now()` is monotonic and high-resolution in Bun and Node.
 * It is used in preference to `Date.now()` so a wall-clock adjustment cannot
 * produce a negative span.
 */

export interface PerfSpan {
  /** Phase name, e.g. "context.build". */
  name: string
  /** Correlation id tying spans from one operation together. */
  runId: string
  /** Duration in milliseconds. */
  ms: number
  /** Monotonic start, for ordering. */
  startedAt: number
  /** Optional labels; must never contain a credential or user data. */
  attributes?: Record<string, string | number | boolean>
}

export interface PerfSnapshot {
  spans: PerfSpan[]
  /** Resident set size at snapshot time, in bytes. */
  rssBytes: number
  /** Heap in use at snapshot time, in bytes. */
  heapUsedBytes: number
}

export interface PerfSummaryEntry {
  name: string
  count: number
  totalMs: number
  minMs: number
  maxMs: number
  meanMs: number
  /** Median of the recorded durations. */
  p50Ms: number
  p95Ms: number
}

const now: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now()

/** Monotonic millisecond clock, exported so a caller measures with the same source. */
export function nowMs(): number {
  return now()
}

/**
 * A performance recorder. Construct once per process; `enabled` defaults to the
 * `DIRECTIONER_PERF` environment variable so a debug run can turn it on without
 * a code change.
 */
export class PerfRecorder {
  private readonly spans: PerfSpan[] = []
  private readonly enabled: boolean
  private readonly maxSpans: number

  constructor(options: { enabled?: boolean; maxSpans?: number } = {}) {
    this.enabled =
      options.enabled ??
      ['1', 'true', 'yes'].includes(
        (process.env.DIRECTIONER_PERF ?? '').toLowerCase(),
      )
    // Bounded: a runaway loop cannot grow the buffer without limit.
    this.maxSpans = options.maxSpans ?? 10_000
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  /** Record an already-measured span. No-op when disabled. */
  record(span: Omit<PerfSpan, 'startedAt'> & { startedAt?: number }): void {
    if (!this.enabled) return
    if (this.spans.length >= this.maxSpans) return
    this.spans.push({
      startedAt: span.startedAt ?? now(),
      name: span.name,
      runId: span.runId,
      ms: span.ms,
      attributes: span.attributes,
    })
  }

  /**
   * Time `fn`, recording a span under `name`/`runId`. Returns fn's result.
   * When disabled this is `fn()` plus one boolean check.
   */
  async span<T>(
    name: string,
    runId: string,
    fn: () => T | Promise<T>,
    attributes?: Record<string, string | number | boolean>,
  ): Promise<T> {
    if (!this.enabled) return fn()
    const start = now()
    try {
      return await fn()
    } finally {
      this.record({
        name,
        runId,
        ms: now() - start,
        startedAt: start,
        attributes,
      })
    }
  }

  snapshot(): PerfSnapshot {
    return {
      spans: [...this.spans],
      rssBytes: process.memoryUsage().rss,
      heapUsedBytes: process.memoryUsage().heapUsed,
    }
  }

  /** Aggregate spans by name. `p95` uses nearest-rank. */
  summary(): PerfSummaryEntry[] {
    const byName = new Map<string, number[]>()
    for (const span of this.spans) {
      const bucket = byName.get(span.name)
      if (bucket) bucket.push(span.ms)
      else byName.set(span.name, [span.ms])
    }
    const entries: PerfSummaryEntry[] = []
    for (const [name, durations] of byName) {
      const sorted = [...durations].sort((a, b) => a - b)
      const total = sorted.reduce((sum, value) => sum + value, 0)
      entries.push({
        name,
        count: sorted.length,
        totalMs: total,
        minMs: sorted[0],
        maxMs: sorted[sorted.length - 1],
        meanMs: total / sorted.length,
        p50Ms: percentile(sorted, 0.5),
        p95Ms: percentile(sorted, 0.95),
      })
    }
    entries.sort((a, b) => b.totalMs - a.totalMs)
    return entries
  }

  reset(): void {
    this.spans.length = 0
  }
}

/** Nearest-rank percentile over an ascending-sorted array. */
export function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0
  const rank = Math.ceil(fraction * sorted.length)
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1))
  return sorted[index]
}
