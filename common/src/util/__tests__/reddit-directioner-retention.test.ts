import { describe, expect, test } from 'bun:test'

import {
  getDirectionerRetentionMilestonesToFire,
  isFirstDirectionerPrompt,
  planDirectionerRedditConversionEvents,
} from '@beyonders/common/util/reddit-directioner-retention'

describe('isFirstDirectionerPrompt', () => {
  test('returns true on first-ever usage day', () => {
    expect(
      isFirstDirectionerPrompt({
        previousUsageDays: [],
        newUsageDayRecorded: true,
      }),
    ).toBe(true)
  })

  test('returns false on repeat prompts same day', () => {
    expect(
      isFirstDirectionerPrompt({
        previousUsageDays: ['2026-06-30'],
        newUsageDayRecorded: false,
      }),
    ).toBe(false)
  })

  test('returns false on a later usage day', () => {
    expect(
      isFirstDirectionerPrompt({
        previousUsageDays: ['2026-06-30'],
        newUsageDayRecorded: true,
      }),
    ).toBe(false)
  })
})

describe('getDirectionerRetentionMilestonesToFire', () => {
  test('returns nothing on first-ever usage day', () => {
    expect(
      getDirectionerRetentionMilestonesToFire({
        previousUsageDays: [],
        todayDateKey: '2026-06-30',
        newUsageDayRecorded: true,
      }),
    ).toEqual([])
  })

  test('returns nothing when no new usage day was recorded', () => {
    expect(
      getDirectionerRetentionMilestonesToFire({
        previousUsageDays: ['2026-06-30'],
        todayDateKey: '2026-07-01',
        newUsageDayRecorded: false,
      }),
    ).toEqual([])
  })

  test('fires 1d retention on day 1', () => {
    expect(
      getDirectionerRetentionMilestonesToFire({
        previousUsageDays: ['2026-06-30'],
        todayDateKey: '2026-07-01',
        newUsageDayRecorded: true,
      }),
    ).toEqual([1])
  })

  test('does not repeat 1d on day 2', () => {
    expect(
      getDirectionerRetentionMilestonesToFire({
        previousUsageDays: ['2026-06-30', '2026-07-01'],
        todayDateKey: '2026-07-02',
        newUsageDayRecorded: true,
      }),
    ).toEqual([])
  })

  test('fires 7d retention on day 7', () => {
    expect(
      getDirectionerRetentionMilestonesToFire({
        previousUsageDays: ['2026-06-30', '2026-07-01'],
        todayDateKey: '2026-07-07',
        newUsageDayRecorded: true,
      }),
    ).toEqual([7])
  })

  test('does not backfill missed milestones after a long gap', () => {
    expect(
      getDirectionerRetentionMilestonesToFire({
        previousUsageDays: ['2026-06-01'],
        todayDateKey: '2026-07-01',
        newUsageDayRecorded: true,
      }),
    ).toEqual([])
  })

  test('fires 24d retention only on exact day 24', () => {
    expect(
      getDirectionerRetentionMilestonesToFire({
        previousUsageDays: ['2026-06-01', '2026-06-02'],
        todayDateKey: '2026-06-25',
        newUsageDayRecorded: true,
      }),
    ).toEqual([24])
  })
})

describe('planDirectionerRedditConversionEvents', () => {
  test('first prompt only on day 0', () => {
    expect(
      planDirectionerRedditConversionEvents({
        previousUsageDays: [],
        todayDateKey: '2026-06-30',
        newUsageDayRecorded: true,
      }),
    ).toEqual({ fireFirstPrompt: true, retentionMilestones: [] })
  })

  test('1d retention without first prompt on day 1', () => {
    expect(
      planDirectionerRedditConversionEvents({
        previousUsageDays: ['2026-06-30'],
        todayDateKey: '2026-07-01',
        newUsageDayRecorded: true,
      }),
    ).toEqual({ fireFirstPrompt: false, retentionMilestones: [1] })
  })
})
