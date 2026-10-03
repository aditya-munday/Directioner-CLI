import { describe, test, expect } from 'bun:test'

import { holdsLiveDirectionerSlot } from '../../utils/directioner-session-api'

import type { DirectionerSessionResponse } from '../../types/directioner-session'

// Gate predicate for both the message queue (may queued work still be sent?)
// and slot release (is there a server row to DELETE?). The load-bearing cases
// are the two 'ended' variants: WITH an instance id we're inside the server's
// grace window and requests are still admissible; WITHOUT one the session is
// fully over and any request would be rejected by the chat-completions gate.

const activeSession: DirectionerSessionResponse = {
  status: 'active',
  accessTier: 'full',
  instanceId: 'inst-1',
  model: 'deepseek/deepseek-v4',
  admittedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  remainingMs: 60_000,
}

describe('holdsLiveDirectionerSlot', () => {
  test('active session holds a slot', () => {
    expect(holdsLiveDirectionerSlot(activeSession)).toBe(true)
  })

  test('ended WITH instance id (grace window) still holds a slot', () => {
    expect(
      holdsLiveDirectionerSlot({ status: 'ended', instanceId: 'inst-1' }),
    ).toBe(true)
  })

  test('ended WITHOUT instance id (post-grace) does not hold a slot', () => {
    expect(holdsLiveDirectionerSlot({ status: 'ended' })).toBe(false)
  })

  test('null session does not hold a slot', () => {
    expect(holdsLiveDirectionerSlot(null)).toBe(false)
  })

  test('pre-join and terminal states do not hold a slot', () => {
    expect(holdsLiveDirectionerSlot({ status: 'none' })).toBe(false)
    expect(holdsLiveDirectionerSlot({ status: 'superseded' })).toBe(false)
    expect(
      holdsLiveDirectionerSlot({ status: 'takeover_prompt', model: 'm' }),
    ).toBe(false)
  })
})
