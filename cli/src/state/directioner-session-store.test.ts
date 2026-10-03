import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'

import * as auth from '../utils/auth'
import { useDirectionerSessionStore } from './directioner-session-store'

const activeSession = {
  status: 'active' as const,
  accessTier: 'full' as const,
  model: 'mimo/mimo-v2.5',
  instanceId: 'held-cli',
  admittedAt: '2099-09-07T12:00:00Z',
  expiresAt: '2099-09-07T13:00:00Z',
  remainingMs: 300000,
}
let fetchSpy: ReturnType<typeof spyOn>
let authSpy: ReturnType<typeof spyOn>

beforeEach(() => {
  authSpy = spyOn(auth, 'getAuthTokenDetails').mockReturnValue({
    token: 'test-token',
    source: 'environment',
  })
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async () =>
    Response.json({
      status: 'ended',
      freebucksRefund: 4,
    })) as unknown as typeof fetch)
  useDirectionerSessionStore.getState().setSession(activeSession)
})
afterEach(() => {
  fetchSpy.mockRestore()
  authSpy.mockRestore()
  useDirectionerSessionStore.getState().setSession(null)
})

test('release owns the refund receipt and sends the held instance', async () => {
  await useDirectionerSessionStore.getState().releaseSlot()
  expect(useDirectionerSessionStore.getState().lastRefund).toBe(4)
  const [, init] = fetchSpy.mock.calls[0]!
  expect(init.method).toBe('DELETE')
  expect(new Headers(init.headers).get('x-directioner-instance-id')).toBe(
    'held-cli',
  )
  useDirectionerSessionStore.getState().setSession({ status: 'none' })
  expect(useDirectionerSessionStore.getState().lastRefund).toBe(4)
  useDirectionerSessionStore.getState().setSession(activeSession)
  expect(useDirectionerSessionStore.getState().lastRefund).toBeNull()
  await useDirectionerSessionStore.getState().releaseSlot()
  useDirectionerSessionStore.getState().setSession(null)
  expect(useDirectionerSessionStore.getState().lastRefund).toBeNull()
})

test('failed release is retryable and never invents a receipt', async () => {
  fetchSpy.mockRejectedValue(new Error('offline'))
  await expect(
    useDirectionerSessionStore.getState().releaseSlot(),
  ).rejects.toThrow('offline')
  expect(useDirectionerSessionStore.getState().failure?.outcomeUnknown).toBe(true)
  expect(useDirectionerSessionStore.getState().session).toEqual(activeSession)
  expect(useDirectionerSessionStore.getState().lastRefund).toBeNull()
})

test('an update restart keeps the held slot on every exit path', async () => {
  useDirectionerSessionStore.getState().setFailure(null)
  try {
    useDirectionerSessionStore.getState().keepSlotForRelaunch()
    // exitCliCleanly and the hook's unmount cleanup both land here; neither
    // may end the hour the relaunched binary is about to take over.
    await useDirectionerSessionStore.getState().releaseSlot()
    await useDirectionerSessionStore.getState().releaseSlot(activeSession)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(useDirectionerSessionStore.getState().session).toEqual(activeSession)
    expect(useDirectionerSessionStore.getState().failure).toBeNull()
  } finally {
    useDirectionerSessionStore.setState({ slotKeptForRelaunch: false })
  }
})

test('release does nothing without a held slot or authentication', async () => {
  authSpy.mockReturnValue({ source: null })
  await expect(
    useDirectionerSessionStore.getState().releaseSlot(),
  ).rejects.toThrow('authentication')
  authSpy.mockReturnValue({ token: 'test-token', source: 'environment' })
  useDirectionerSessionStore.getState().setSession({ status: 'none' })
  await useDirectionerSessionStore.getState().releaseSlot()
  expect(fetchSpy).not.toHaveBeenCalled()
})

for (const transition of ['replacement', 'logout', 'auth-change'] as const) {
  test(`late release cannot publish a receipt after ${transition}`, async () => {
    let respond!: (response: Response) => void
    fetchSpy.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          respond = resolve
        }),
    )
    const release = useDirectionerSessionStore.getState().releaseSlot()
    if (transition === 'replacement')
      useDirectionerSessionStore
        .getState()
        .setSession({ ...activeSession, instanceId: 'new-cli' })
    if (transition === 'logout')
      useDirectionerSessionStore.getState().setSession(null)
    if (transition === 'auth-change')
      authSpy.mockReturnValue({
        token: 'different-user',
        source: 'environment',
      })
    respond(Response.json({ status: 'ended', freebucksRefund: 4 }))
    await release
    expect(useDirectionerSessionStore.getState().lastRefund).toBeNull()
  })
}

test('exit and explicit end share one pending request; failure permits retry', async () => {
  let reject!: (error: Error) => void
  fetchSpy.mockImplementation(
    () =>
      new Promise<Response>((_, fail) => {
        reject = fail
      }),
  )
  const first = useDirectionerSessionStore.getState().releaseSlot()
  const second = useDirectionerSessionStore.getState().releaseSlot()
  expect(first).toBe(second)
  expect(fetchSpy).toHaveBeenCalledTimes(1)
  reject(new Error('response lost'))
  await expect(first).rejects.toThrow('response lost')
  fetchSpy.mockResolvedValue(
    Response.json({ status: 'ended', freebucksRefund: 4 }),
  )
  await useDirectionerSessionStore.getState().releaseSlot()
  expect(fetchSpy).toHaveBeenCalledTimes(2)
  expect(useDirectionerSessionStore.getState().lastRefund).toBe(4)
})

test.each(['none', 'banned', 'country_blocked'])(
  'a %s response does not confirm an end',
  async (status) => {
    fetchSpy.mockResolvedValue(Response.json({ status }))
    await expect(
      useDirectionerSessionStore.getState().releaseSlot(),
    ).rejects.toThrow('did not confirm')
    expect(useDirectionerSessionStore.getState().session).toEqual(activeSession)
    expect(useDirectionerSessionStore.getState().lastRefund).toBeNull()
  },
)

test('a poll refreshing the same instance does not discard its refund receipt', async () => {
  let respond!: (response: Response) => void
  fetchSpy.mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        respond = resolve
      }),
  )
  const release = useDirectionerSessionStore.getState().releaseSlot()
  useDirectionerSessionStore
    .getState()
    .setSession({ ...activeSession, remainingMs: 299000 })
  respond(Response.json({ status: 'ended', freebucksRefund: 4 }))
  await release
  expect(useDirectionerSessionStore.getState().lastRefund).toBe(4)
})

test('a pending end releases the chat and later recovers its final receipt', async () => {
  fetchSpy.mockResolvedValue(
    Response.json({ status: 'ended', freebucksRefundPending: true }),
  )
  await useDirectionerSessionStore.getState().releaseSlot()
  expect(useDirectionerSessionStore.getState().lastRefund).toBeNull()
  expect(useDirectionerSessionStore.getState().pendingRefund?.instanceId).toBe(
    'held-cli',
  )
  useDirectionerSessionStore.getState().setSession({ status: 'none' })
  fetchSpy.mockResolvedValue(
    Response.json({ status: 'ended', freebucksRefund: 1 }),
  )
  await useDirectionerSessionStore.getState().refreshRefund()
  expect(useDirectionerSessionStore.getState().lastRefund).toBe(1)
  expect(useDirectionerSessionStore.getState().pendingRefund).toBeNull()
  expect(
    new Headers(fetchSpy.mock.calls[1]![1].headers).get(
      'x-directioner-instance-id',
    ),
  ).toBe('held-cli')
})

test('a receipt poll cannot publish into a replacement session', async () => {
  fetchSpy.mockResolvedValue(
    Response.json({ status: 'ended', freebucksRefundPending: true }),
  )
  await useDirectionerSessionStore.getState().releaseSlot()
  let respond!: (response: Response) => void
  fetchSpy.mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        respond = resolve
      }),
  )
  const poll = useDirectionerSessionStore.getState().refreshRefund()
  useDirectionerSessionStore
    .getState()
    .setSession({ ...activeSession, instanceId: 'replacement' })
  respond(Response.json({ status: 'ended', freebucksRefund: 1 }))
  await poll
  expect(useDirectionerSessionStore.getState().lastRefund).toBeNull()
})
