import { IS_DEV, IS_TEST, IS_CI } from '@beyonders/common/env'

import { getApiClient } from './beyonders-api'
import { getCliEnv } from './env'

import type { LogRecordInput } from '@beyonders/common/schemas/logs'

/**
 * Client-side shipper that mirrors CLI logs/events into the server's Axiom
 * logs sink via POST /api/logs. Runs alongside PostHog (it does not replace
 * it). Fully best-effort: batched, fire-and-forget, never throws, never logs
 * through the app logger (which would recurse).
 *
 * Tuning via env:
 *  - BEYONDERS_SHIP_LOGS 'true' | 'false'  (default: on outside dev/test)
 */

const MAX_BATCH = 50
const FLUSH_INTERVAL_MS = 10_000
const MAX_BUFFER = 1_000

let buffer: LogRecordInput[] = []
let timer: ReturnType<typeof setInterval> | null = null
let naturalExitFlushRegistered = false

export function createClientLogFlusher(deps: {
  takeBatch: () => LogRecordInput[]
  hasPending: () => boolean
  sendBatch: (batch: LogRecordInput[]) => Promise<void>
}) {
  let activeFlush: Promise<void> | null = null

  const flush = (): Promise<void> => {
    if (activeFlush) return activeFlush
    const batch = deps.takeBatch()
    if (batch.length === 0) return Promise.resolve()

    activeFlush = deps
      .sendBatch(batch)
      .catch(() => {
        // Best-effort: drop on error rather than risk unbounded growth.
      })
      .finally(() => {
        activeFlush = null
      })
    return activeFlush
  }

  const drain = async (): Promise<void> => {
    while (activeFlush || deps.hasPending()) {
      await (activeFlush ?? flush())
    }
  }

  return { flush, drain }
}

const clientLogFlusher = createClientLogFlusher({
  takeBatch: () => buffer.splice(0, MAX_BATCH),
  hasPending: () => buffer.length > 0,
  sendBatch: async (batch) => {
    const client = getApiClient()
    // Ship whether or not we're logged in. With a token the server stamps the
    // authenticated user_id; without one it accepts the batch anonymously
    // (rate-limited, user_id=null) so pre-auth events like app_launched still
    // reach Axiom. Records carry client_session_id for correlation. See
    // /api/logs and docs/logging.md.
    await client.post(
      '/api/logs',
      { records: batch },
      {
        includeAuth: Boolean(client.authToken),
        retry: false,
        timeoutMs: 5_000,
      },
    )
  },
})

function enabled(): boolean {
  // Directioner never ships client logs anywhere. The vendor log sink
  // (/api/logs) is gone, so this channel is disabled unconditionally rather
  // than only outside dev/CI as it was before.
  return false
}

function ensureTimer(): void {
  if (timer) return
  timer = setInterval(() => {
    void flushClientLogs()
  }, FLUSH_INTERVAL_MS)
  ;(timer as { unref?: () => void }).unref?.()
}

function registerNaturalExitFlush(): void {
  if (naturalExitFlushRegistered) return
  naturalExitFlushRegistered = true
  const onExit = () => {
    void drainClientLogs()
  }
  process.once('beforeExit', onExit)
}

/** Buffer one record for shipping. Cheap, synchronous, never throws. */
export function enqueueClientLog(record: LogRecordInput): void {
  if (!enabled()) return
  if (buffer.length >= MAX_BUFFER) {
    buffer.shift()
  }
  buffer.push(record)
  ensureTimer()
  registerNaturalExitFlush()
  if (buffer.length >= MAX_BATCH) {
    void flushClientLogs()
  }
}

/** Flush one batch to /api/logs. Concurrent callers share the active request. */
export function flushClientLogs(): Promise<void> {
  return clientLogFlusher.flush()
}

/** Wait for any active request, then flush every batch buffered before exit. */
export async function drainClientLogs(): Promise<void> {
  await clientLogFlusher.drain()
}
