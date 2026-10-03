import { freebucksFixture } from '@beyonders/common/testing/directioner'
import { afterEach, expect, spyOn, test } from 'bun:test'
import {
  DIRECTIONER_REWARD_MODEL_ID,
  DIRECTIONER_FABLE_5_1_MODEL_ID,
  resolveDirectionerModelForAccessTier,
} from '@beyonders/common/constants/directioner-models'

import {
  callDirectionerSession,
  classifyDirectionerSessionRequestFailure,
  DirectionerSessionRequestError,
  directionerSessionHost,
  directionerSessionUnreachableMessage,
  isDirectionerSessionNetworkError,
  mergeCompactActiveSession,
} from '../directioner-session-api'
import {
  newDirectionerCliInstanceId,
  directionerSessionMetadata,
} from '../directioner-session-identity'

let fetchSpy: ReturnType<typeof spyOn> | undefined

afterEach(() => {
  fetchSpy?.mockRestore()
  fetchSpy = undefined
})

test('the reward model reaches the session POST header unchanged', async () => {
  fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ status: 'none' }), {
      headers: { 'content-type': 'application/json' },
    }),
  )
  const resolved = resolveDirectionerModelForAccessTier(
    DIRECTIONER_REWARD_MODEL_ID,
    'full',
  )

  await callDirectionerSession('POST', 'test-token', { model: resolved })

  expect(fetchSpy).toHaveBeenCalledTimes(1)
  const [, init] = fetchSpy.mock.calls[0]!
  expect(new Headers(init?.headers).get('x-fb-timezone')).toBe(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  )
  expect(new Headers(init?.headers).get('x-directioner-model')).toBe(
    DIRECTIONER_REWARD_MODEL_ID,
  )
})

test('compact GET sends the compact-session header', async () => {
  fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({ status: 'active', model: 'model', instanceId: 'i1' }),
  )

  await callDirectionerSession('GET', 'test-token', {
    instanceId: 'i1',
    compact: true,
  })

  const [, init] = fetchSpy.mock.calls[0]!
  expect(new Headers(init?.headers).get('x-directioner-compact-session')).toBe('1')
})

test('multi-session polling beats only its own claim and retains compact polling', async () => {
  const instanceId = newDirectionerCliInstanceId()
  fetchSpy = spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ status: 'none' }))
    .mockResolvedValueOnce(Response.json({ status: 'none' }))
  await callDirectionerSession('GET', 'test-token', { instanceId, compact: true })
  const headers = new Headers(fetchSpy.mock.calls[0]![1]?.headers)
  expect(headers.get('x-directioner-instance-id')).toBe(instanceId)
  expect(headers.get('x-directioner-multi-session')).toBe('1')
  expect(headers.get('x-directioner-heartbeat')).toBe('1')
  expect(headers.get('x-directioner-compact-session')).toBe('1')
  expect(headers.get('x-directioner-include-unused-rate-limits')).toBeNull()
  await callDirectionerSession('GET', 'test-token', { instanceId })
  expect(
    new Headers(fetchSpy.mock.calls[1]![1]?.headers).get(
      'x-directioner-include-unused-rate-limits',
    ),
  ).toBe('1')
})

test('limited-offer admission retains the globally capped single-session protocol', async () => {
  fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({ status: 'none' }),
  )
  await callDirectionerSession('POST', 'test-token', {
    model: DIRECTIONER_FABLE_5_1_MODEL_ID,
    multiSession: false,
  })
  const headers = new Headers(fetchSpy.mock.calls[0]![1]?.headers)
  expect(headers.get('x-directioner-multi-session')).toBeNull()
  expect(headers.get('x-directioner-purchase-continuity')).toBeNull()
  expect(headers.get('x-directioner-desktop-attempt-id')).toBeNull()
  expect(directionerSessionMetadata('legacy-trial-id')).toEqual({
    directioner_instance_id: 'legacy-trial-id',
  })
})

test('compact active state retains the admission quota and Freebucks snapshots', () => {
  const freebucks = freebucksFixture(5)
  const rateLimit = {
    model: 'model',
    limit: 5,
    period: 'pacific_day' as const,
    resetTimeZone: 'America/Los_Angeles' as const,
    resetAt: '2026-08-06T07:00:00.000Z',
    windowHours: 1,
    recentCount: 2,
    entitlementBreakdown: { base: 5, referral: 0, streak: 0 },
  }
  const merged = mergeCompactActiveSession(
    {
      status: 'active',
      accessTier: 'full',
      model: 'model',
      instanceId: 'i1',
      admittedAt: '2026-08-05T12:00:00.000Z',
      expiresAt: '2026-08-05T13:00:00.000Z',
      remainingMs: 1_000,
      rateLimit,
      freebucks,
    },
    {
      status: 'active',
      accessTier: 'full',
      model: 'model',
      instanceId: 'i1',
      admittedAt: '2026-08-05T12:00:00.000Z',
      expiresAt: '2026-08-05T13:00:00.000Z',
      remainingMs: 500,
    },
  )

  expect(merged).toMatchObject({ remainingMs: 500, rateLimit, freebucks })
  if (merged?.status !== 'active') throw new Error('expected active session')
  const unavailable = mergeCompactActiveSession(merged, {
    ...merged,
    freebucks: null,
  })
  expect(unavailable).toMatchObject({ freebucks: null })
  expect(
    mergeCompactActiveSession(unavailable, { ...merged, freebucks }),
  ).toMatchObject({ freebucks })
})

test('compact state requests a full refresh instead of carrying quota across models', () => {
  const merged = mergeCompactActiveSession(
    {
      status: 'active',
      accessTier: 'full',
      model: 'old-model',
      instanceId: 'i1',
      admittedAt: '2026-08-05T12:00:00.000Z',
      expiresAt: '2026-08-05T13:00:00.000Z',
      remainingMs: 1_000,
      rateLimit: {
        model: 'old-model',
        limit: 5,
        period: 'pacific_day',
        resetTimeZone: 'America/Los_Angeles',
        resetAt: '2026-08-06T07:00:00.000Z',
        windowHours: 1,
        recentCount: 2,
        entitlementBreakdown: { base: 5, referral: 0, streak: 0 },
      },
    },
    {
      status: 'active',
      accessTier: 'full',
      model: 'new-model',
      instanceId: 'i1',
      admittedAt: '2026-08-05T12:00:00.000Z',
      expiresAt: '2026-08-05T13:00:00.000Z',
      remainingMs: 500,
    },
  )

  expect(merged).toBeNull()
})

test('does not repeat a takeover POST after an ambiguous timeout', () => {
  const timeout = new DOMException('The operation timed out', 'TimeoutError')

  expect(classifyDirectionerSessionRequestFailure('POST', timeout)).toBe('unknown')
  expect(classifyDirectionerSessionRequestFailure('GET', timeout)).toBe('retry')
})

test('retries POST responses that cannot represent a committed takeover', async () => {
  fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json(
      {
        error: 'service_overloaded',
        message: 'Directioner session service is busy. Please retry shortly.',
      },
      { status: 503, headers: { 'retry-after': '10' } },
    ),
  )

  await expect(callDirectionerSession('POST', 'test-token')).rejects.toMatchObject(
    {
      statusCode: 503,
      retryAfterMs: 10_000,
      errorCode: 'service_overloaded',
    },
  )

  expect(
    classifyDirectionerSessionRequestFailure(
      'POST',
      new DirectionerSessionRequestError(
        'busy',
        503,
        10_000,
        'service_overloaded',
      ),
    ),
  ).toBe('retry')
  expect(
    classifyDirectionerSessionRequestFailure(
      'POST',
      new DirectionerSessionRequestError('generic proxy 503', 503, 10_000),
    ),
  ).toBe('retry')
  expect(
    classifyDirectionerSessionRequestFailure(
      'POST',
      new DirectionerSessionRequestError('request timeout', 408, 10_000),
    ),
  ).toBe('retry')
  expect(
    classifyDirectionerSessionRequestFailure(
      'POST',
      new DirectionerSessionRequestError('edge rate limit', 429, 10_000),
    ),
  ).toBe('retry')
})

test('stops on terminal 4xx responses', () => {
  expect(
    classifyDirectionerSessionRequestFailure(
      'POST',
      new DirectionerSessionRequestError('unauthorized', 401),
    ),
  ).toBe('stop')
  expect(
    classifyDirectionerSessionRequestFailure(
      'GET',
      new DirectionerSessionRequestError('not found', 404),
    ),
  ).toBe('stop')
})

test('marks response loss and server errors after a POST as unknown outcomes', () => {
  expect(
    classifyDirectionerSessionRequestFailure(
      'POST',
      new TypeError('fetch failed'),
    ),
  ).toBe('unknown')
  expect(
    classifyDirectionerSessionRequestFailure(
      'POST',
      new DirectionerSessionRequestError('internal error', 500),
    ),
  ).toBe('unknown')
  expect(
    classifyDirectionerSessionRequestFailure(
      'GET',
      new DirectionerSessionRequestError('internal error', 500),
    ),
  ).toBe('retry')
})

test('DELETE sends the held instance and preserves the server refund receipt', async () => {
  fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({ status: 'ended', freebucksRefund: 4 }),
  )
  const result = await callDirectionerSession('DELETE', 'test-token', {
    instanceId: 'held-cli',
  })
  expect(result).toEqual({ status: 'ended', freebucksRefund: 4 })
  const [, init] = fetchSpy.mock.calls[0]!
  expect(new Headers(init?.headers).get('x-directioner-instance-id')).toBe(
    'held-cli',
  )
})

test.each([undefined, 5, 'session'] as const)(
  'POST carries wallet authorization %s and preserves a consent refusal',
  async (walletSpendLimit) => {
    const state = {
      status: 'consent_required' as const,
      walletConsent: { price: 10, walletSpend: 10 },
      freebucks: null,
    }
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(state, { status: 409 }),
    )
    expect(
      await callDirectionerSession('POST', 'test-token', {
        model: 'mimo/mimo-v2.5',
        walletSpendLimit,
      }),
    ).toEqual(state)
    expect(
      new Headers(fetchSpy.mock.calls[0]![1]?.headers).get(
        'x-directioner-wallet-spend-limit',
      ),
    ).toBe(String(walletSpendLimit ?? 0))
  },
)

test.each([404, 405])(
  'unsupported admission (%s) stops without legacy fallback',
  async (status) => {
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Not found', { status }),
    )
    await expect(callDirectionerSession('POST', 'test-token')).rejects.toThrow(
      'Reload or update Directioner',
    )
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(String(fetchSpy.mock.calls[0]![0])).toEndWith('/session/admission')
    expect(
      new Headers(fetchSpy.mock.calls[0]![1]?.headers).get(
        'x-directioner-wallet-spend-limit',
      ),
    ).toBe('0')
  },
)

// The landing screen used to print the runtime's error verbatim ("The operation
// timed out.", "fetch failed"). Users whose ISP could not route to the API host
// read that as a broken install. What is shown must name the host and the two
// things that help — and only for failures where nothing came back at all.
test('a request that got no answer is a network error, a refused one is not', () => {
  const timeout = new Error('The operation timed out.')
  timeout.name = 'TimeoutError'
  expect(isDirectionerSessionNetworkError(timeout)).toBe(true)
  expect(isDirectionerSessionNetworkError(new Error('fetch failed'))).toBe(true)
  const withCause = new Error('fetch failed')
  ;(withCause as Error & { cause: Error }).cause = new Error(
    'connect ECONNREFUSED 216.24.57.16:443',
  )
  expect(isDirectionerSessionNetworkError(withCause)).toBe(true)
  expect(
    isDirectionerSessionNetworkError(
      new Error('getaddrinfo ENOTFOUND beyonders.com'),
    ),
  ).toBe(true)

  expect(
    isDirectionerSessionNetworkError(
      new DirectionerSessionRequestError('slow down', 429),
    ),
  ).toBe(false)
  expect(
    isDirectionerSessionNetworkError(new Error('Unexpected token < in JSON')),
  ).toBe(false)
  expect(isDirectionerSessionNetworkError('fetch failed')).toBe(false)
})

test('the unreachable copy names the host and never blames the machine', () => {
  const msg = directionerSessionUnreachableMessage('www.beyonders.com')
  expect(msg).toContain('www.beyonders.com')
  expect(msg).toContain('directioner.com/web')
  expect(msg).toContain('another ISP')
  expect(msg).not.toMatch(/reinstall|firewall|antivirus/i)
})

test('the session host is the API origin without scheme or path', () => {
  expect(directionerSessionHost()).toMatch(/^[a-z0-9.:-]+$/i)
  expect(directionerSessionHost()).not.toContain('/')
})
