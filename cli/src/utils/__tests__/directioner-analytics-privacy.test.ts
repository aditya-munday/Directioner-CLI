import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

/**
 * Locks the Directioner telemetry guarantee.
 *
 * `cli/src/utils/analytics.ts` short-circuits in `initAnalytics` when
 * `IS_DIRECTIONER` is true and installs the no-op client, so a Directioner
 * build sends nothing. Nothing else asserts that: the rest of the analytics
 * suite drives the PostHog branch, so deleting the short-circuit would not fail
 * a test — it would just start emitting an install's events to PostHog. These
 * tests pin the guarantee at the level the user experiences it.
 *
 * `IS_DIRECTIONER` is evaluated once at module load from `DIRECTIONER_MODE`
 * (which the build injects via `--define`). ESM hoists static imports, so the
 * variable must be set before the module is imported — hence the dynamic
 * import inside `beforeAll` rather than a top-level import.
 */

const ORIGINAL_MODE = process.env.DIRECTIONER_MODE
const ORIGINAL_HOSTED = process.env.HOSTED_MODE

interface AnalyticsModule {
  initAnalytics: () => void
  trackEvent: (event: string, properties?: Record<string, unknown>) => boolean
  identifyUser: (userId: string, properties?: Record<string, unknown>) => void
  flushAnalytics: () => Promise<void>
  resetAnalyticsState: (deps?: unknown) => void
  identified: boolean
}

let analytics: AnalyticsModule
let flushCalled = false
let captureCalls: unknown[] = []
let identifyCalls: unknown[] = []
let aliasCalls: unknown[] = []
let createClientCalls = 0

describe('Directioner mode emits no telemetry', () => {
  beforeAll(async () => {
    process.env.DIRECTIONER_MODE = 'true'
    process.env.HOSTED_MODE = 'false'
    analytics = (await import('../analytics')) as unknown as AnalyticsModule

    // A fake PostHog client that records everything, so a stray call is visible
    // rather than silently swallowed.
    const fakeClient = {
      capture: (payload: unknown) => {
        captureCalls.push(payload)
      },
      identify: (payload: unknown) => {
        identifyCalls.push(payload)
      },
      alias: (payload: unknown) => {
        aliasCalls.push(payload)
      },
      captureException: () => {},
      flush: async () => {
        flushCalled = true
      },
    }

    analytics.resetAnalyticsState({
      env: {
        NEXT_PUBLIC_POSTHOG_API_KEY: 'phc_test_key',
        NEXT_PUBLIC_POSTHOG_HOST_URL: 'https://us.i.posthog.com',
      },
      isProd: true,
      createClient: () => {
        createClientCalls++
        return fakeClient
      },
      generateAnonymousId: () => 'anon_test',
    })

    captureCalls = []
    identifyCalls = []
    aliasCalls = []
    createClientCalls = 0
    flushCalled = false

    analytics.initAnalytics()
  })

  afterAll(() => {
    process.env.DIRECTIONER_MODE = ORIGINAL_MODE
    process.env.HOSTED_MODE = ORIGINAL_HOSTED
  })

  test('initAnalytics does not construct a PostHog client', () => {
    expect(createClientCalls).toBe(0)
  })

  test('initAnalytics does not require a provider key (hosted client unused)', () => {
    // The hosted branch throws when the PostHog key is missing. In Directioner
    // mode the key is irrelevant, so init must not even look at it.
    expect(() => analytics.initAnalytics()).not.toThrow()
  })

  test('trackEvent captures nothing', () => {
    const result = analytics.trackEvent('cli.login', { source: 'test' })
    expect(captureCalls.length).toBe(0)
    expect(result).toBe(false)
  })

  test('identifyUser captures nothing and does not alias', () => {
    analytics.identifyUser('user-123', { plan: 'byok' })
    expect(identifyCalls.length).toBe(0)
    expect(aliasCalls.length).toBe(0)
  })

  test('flushAnalytics never flushes a client', async () => {
    await analytics.flushAnalytics()
    expect(flushCalled).toBe(false)
  })

  test('a full init/track/identify/flush cycle is inert', async () => {
    analytics.initAnalytics()
    analytics.trackEvent('cli.login')
    analytics.identifyUser('user-456')
    await analytics.flushAnalytics()
    expect(captureCalls.length).toBe(0)
    expect(identifyCalls.length).toBe(0)
    expect(aliasCalls.length).toBe(0)
    expect(flushCalled).toBe(false)
    expect(createClientCalls).toBe(0)
  })
})
