import { describe, expect, test } from 'bun:test'

import {
  addDaysToDateKey,
  calculateDirectionerStreak,
  getDirectionerDailyStreakRewardPool,
  getDirectionerStreakGlmBonusUnits,
  getDirectionerUsageDateKey,
} from '../directioner-streak'

function usageDatesFrom(startDateKey: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) =>
    addDaysToDateKey(startDateKey, index),
  )
}

describe('directioner streak helpers', () => {
  test('formats usage dates in the Directioner reset timezone', () => {
    expect(getDirectionerUsageDateKey(new Date('2026-05-27T06:30:00.000Z'))).toBe(
      '2026-05-26',
    )
    expect(getDirectionerUsageDateKey(new Date('2026-05-27T08:30:00.000Z'))).toBe(
      '2026-05-27',
    )
  })

  test('adds days across month boundaries', () => {
    expect(addDaysToDateKey('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDaysToDateKey('2024-03-01', -1)).toBe('2024-02-29')
    expect(addDaysToDateKey('2026-12-31', 1)).toBe('2027-01-01')
  })

  test('counts a streak that includes today', () => {
    expect(
      calculateDirectionerStreak({
        todayDateKey: '2026-05-27',
        usageDates: ['2026-05-25', '2026-05-23', '2026-05-27', '2026-05-26'],
      }),
    ).toEqual({
      streak: 3,
      todayUsed: true,
      lastUsageDate: '2026-05-27',
    })
  })

  test('keeps yesterday-anchored streaks alive before today is used', () => {
    expect(
      calculateDirectionerStreak({
        todayDateKey: '2026-05-27',
        usageDates: ['2026-05-26', '2026-05-25', '2026-05-24'],
      }),
    ).toEqual({
      streak: 3,
      todayUsed: false,
      lastUsageDate: '2026-05-26',
    })
  })

  test('returns zero after a missed full day', () => {
    expect(
      calculateDirectionerStreak({
        todayDateKey: '2026-05-27',
        usageDates: ['2026-05-25', '2026-05-24'],
      }),
    ).toEqual({
      streak: 0,
      todayUsed: false,
      lastUsageDate: '2026-05-25',
    })
  })
})

describe('directioner streak rewards', () => {
  test('grants one weekly GLM session per completed 7 days, capped at 4', () => {
    const expected: Array<[streak: number, units: number]> = [
      [7, 1],
      [8, 1],
      [13, 1],
      [14, 2],
      [21, 3],
      [28, 4],
      [42, 4],
    ]
    for (const [streak, units] of expected) {
      expect(
        getDirectionerStreakGlmBonusUnits({
          todayDateKey: addDaysToDateKey('2026-07-01', streak - 1),
          usageDates: usageDatesFrom('2026-07-01', streak),
        }),
      ).toBe(units)
    }
  })

  test('returns zero for empty and six-day usage histories', () => {
    expect(
      getDirectionerStreakGlmBonusUnits({
        todayDateKey: '2026-07-13',
        usageDates: [],
      }),
    ).toBe(0)
    expect(
      getDirectionerStreakGlmBonusUnits({
        todayDateKey: '2026-07-13',
        usageDates: usageDatesFrom('2026-07-07', 6),
      }),
    ).toBe(0)
  })

  test('a yesterday-anchored 28-day streak earns the max through the bounded window', () => {
    // Mirrors the web quota query, which fetches only 28 days back from today:
    // the oldest still-active max-tier streak (today unused) must be fully
    // visible inside that window.
    expect(
      getDirectionerStreakGlmBonusUnits({
        todayDateKey: addDaysToDateKey('2026-07-01', 28),
        usageDates: usageDatesFrom('2026-07-01', 28),
      }),
    ).toBe(4)
  })

  test('refills GLM before the first use of a new week while the streak is alive', () => {
    expect(
      getDirectionerStreakGlmBonusUnits({
        todayDateKey: '2026-07-13',
        usageDates: usageDatesFrom('2026-07-06', 7),
      }),
    ).toBe(1)
  })

  test('removes the live GLM entitlement after a missed full day', () => {
    expect(
      getDirectionerStreakGlmBonusUnits({
        todayDateKey: '2026-07-14',
        usageDates: usageDatesFrom('2026-07-06', 7),
      }),
    ).toBe(0)
  })

  test('full access persists only the daily premium bonus', () => {
    expect(
      getDirectionerDailyStreakRewardPool({
        streak: 7,
        todayUsed: true,
        accessTier: 'full',
      }),
    ).toBe('premium')
  })

  test('full access grants the daily premium bonus throughout the streak', () => {
    expect(
      getDirectionerDailyStreakRewardPool({
        streak: 8,
        todayUsed: true,
        accessTier: 'full',
      }),
    ).toBe('premium')
    expect(
      getDirectionerDailyStreakRewardPool({
        streak: 13,
        todayUsed: true,
        accessTier: 'full',
      }),
    ).toBe('premium')
  })

  test('limited access grants the limited bonus every day at streak >= 7', () => {
    // The threshold day and later days both grant the bonus.
    expect(
      getDirectionerDailyStreakRewardPool({
        streak: 14,
        todayUsed: true,
        accessTier: 'limited',
      }),
    ).toBe('limited')
    expect(
      getDirectionerDailyStreakRewardPool({
        streak: 9,
        todayUsed: true,
        accessTier: 'limited',
      }),
    ).toBe('limited')
  })

  test('no daily reward below seven days or before today is used', () => {
    expect(
      getDirectionerDailyStreakRewardPool({
        streak: 6,
        todayUsed: true,
        accessTier: 'full',
      }),
    ).toBeNull()
    // Streak is at 7 only because yesterday anchored it; the user hasn't used
    // Directioner today, so no bonus is earned yet.
    expect(
      getDirectionerDailyStreakRewardPool({
        streak: 7,
        todayUsed: false,
        accessTier: 'full',
      }),
    ).toBeNull()
  })
})
