import { describe, expect, test } from 'bun:test'

import {
  formatDirectionerSessionCountdown,
  formatDirectionerSessionRemaining,
} from '../directioner-session-display'

describe('directioner session display formatting', () => {
  test('formats urgent countdowns', () => {
    expect(formatDirectionerSessionCountdown(61_000)).toBe('1:01')
    expect(formatDirectionerSessionRemaining(61_000)).toBe('1:01 left')
  })

  test('formats minute and hour remaining labels', () => {
    expect(formatDirectionerSessionRemaining(5 * 60_000)).toBe('5m left')
    expect(formatDirectionerSessionRemaining(60 * 60_000)).toBe('1h left')
    expect(formatDirectionerSessionRemaining(90 * 60_000)).toBe('1h 30m left')
  })

  test('formats expired sessions as expiring', () => {
    expect(formatDirectionerSessionRemaining(0)).toBe('expiring…')
  })
})
