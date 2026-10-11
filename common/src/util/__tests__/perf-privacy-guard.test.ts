/**
 * Guard: performance instrumentation cannot become telemetry.
 *
 * The Directioner privacy guarantee is that a Directioner build emits nothing
 * (see `cli/src/utils/analytics.ts` and the telemetry-privacy test). Perf
 * instrumentation is exactly the kind of feature that quietly grows a "send the
 * timings somewhere" path, so this asserts the module is structurally local:
 *
 *   1. its source imports no analytics, telemetry, or network module, and names
 *      no external host;
 *   2. enabling it and recording spans performs no network call.
 *
 * If either fails, enabling perf could reintroduce egress the product promises
 * does not exist.
 */

import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PerfRecorder } from '../perf-metrics'

const SOURCE_PATH = join(import.meta.dir, '..', 'perf-metrics.ts')

/** Remove block and line comments so prose that merely NAMES a risk does not
 *  count as the risk. Only executed code is scanned. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const FORBIDDEN_IMPORTS: readonly RegExp[] = [
  /analytics/i,
  /posthog/i,
  /axiom/i,
  /telemetry/i,
  /from ['"]node:(http|https|net|dns|dgram|tls)/i,
  /from ['"]@beyonders\/common\/analytics/i,
  // A bare network-capable module name, not a substring of a word.
  /from ['"](undici|axios|got|node-fetch)['"]/i,
]

const FORBIDDEN_HOSTS: readonly RegExp[] = [
  /https?:\/\/(?!localhost)/i,
  /posthog/i,
  /\bapi\.[a-z0-9.-]+/i,
]

describe('perf instrumentation is local-only', () => {
  test('its source imports no analytics, telemetry, or network module', () => {
    const source = stripComments(readFileSync(SOURCE_PATH, 'utf8'))
    const offenders = FORBIDDEN_IMPORTS.filter((pattern) => pattern.test(source))
    expect(offenders.map(String)).toEqual([])
  })

  test('its source names no external host', () => {
    const source = stripComments(readFileSync(SOURCE_PATH, 'utf8'))
    const offenders = FORBIDDEN_HOSTS.filter((pattern) => pattern.test(source))
    expect(offenders.map(String)).toEqual([])
  })

  describe('enabling it performs no network call', () => {
    const originalFetch = globalThis.fetch
    afterEach(() => {
      globalThis.fetch = originalFetch
    })

    test('recording a full cycle never calls fetch', async () => {
      let fetchCalls = 0
      globalThis.fetch = (async () => {
        fetchCalls++
        return new Response('null')
      }) as unknown as typeof globalThis.fetch

      const recorder = new PerfRecorder({ enabled: true })
      await recorder.span('context.build', 'run-1', () => 'x')
      await recorder.span('provider.route', 'run-1', async () => 'y')
      recorder.record({ name: 'serialize', runId: 'run-1', ms: 1 })
      recorder.snapshot()
      recorder.summary()

      expect(fetchCalls).toBe(0)
    })
  })
})
