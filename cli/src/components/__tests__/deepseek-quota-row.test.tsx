/**
 * The DeepSeek row's own ceiling has to be legible ON THE ROW, because the
 * PREMIUM header speaks for a different pool and will happily say there is room
 * while this row is spent.
 */
import { describe, expect, test, beforeEach } from 'bun:test'

import {
  DIRECTIONER_DEEPSEEK_V4_FLASH_MODEL_ID,
  DIRECTIONER_GPT_6_LUNA_MODEL_ID,
} from '@beyonders/common/constants/directioner-models'
import {
  formatDirectionerRowQuota,
  getDirectionerSectionQuotas,
} from '@beyonders/common/util/directioner-session-pools'

const quota = (
  model: string,
  pool: string,
  poolLabel: string,
  limit: number,
  recentCount: number,
) => ({
  model,
  pool,
  poolLabel,
  limit,
  recentCount,
  period: 'pacific_day' as const,
  resetTimeZone: 'America/Los_Angeles',
  resetAt: '2026-08-20T07:00:00.000Z',
  windowHours: 24,
})

describe('a section holding two pools', () => {
  const rows = [
    DIRECTIONER_GPT_6_LUNA_MODEL_ID,
    DIRECTIONER_DEEPSEEK_V4_FLASH_MODEL_ID,
  ]
  const quotas = {
    [DIRECTIONER_GPT_6_LUNA_MODEL_ID]: quota(
      DIRECTIONER_GPT_6_LUNA_MODEL_ID,
      'premium',
      'Premium',
      5,
      1,
    ),
    [DIRECTIONER_DEEPSEEK_V4_FLASH_MODEL_ID]: quota(
      DIRECTIONER_DEEPSEEK_V4_FLASH_MODEL_ID,
      'deepseek',
      'DeepSeek',
      1,
      1,
    ),
  }

  test('the header speaks for the majority pool, not for whatever came first', () => {
    // Two premium-pool rows would be the ordinary case; here one of each, and
    // the tie breaks toward display order — Luna leads, so Premium labels the
    // section. The failure this prevents is a header reading "of 1" for every
    // premium model because DeepSeek happened to sort first.
    const { header } = getDirectionerSectionQuotas(rows, quotas)
    expect(header?.pool).toBe('premium')
    expect(header?.limit).toBe(5)
  })

  test('the stricter row is handed back separately, keyed by model', () => {
    const { perModel } = getDirectionerSectionQuotas(rows, quotas)
    expect(Object.keys(perModel)).toEqual([DIRECTIONER_DEEPSEEK_V4_FLASH_MODEL_ID])
    expect(perModel[DIRECTIONER_DEEPSEEK_V4_FLASH_MODEL_ID]!.limit).toBe(1)
  })

  test('its chip names the pool, since the number alone contradicts the header', () => {
    const { perModel } = getDirectionerSectionQuotas(rows, quotas)
    expect(
      formatDirectionerRowQuota(perModel[DIRECTIONER_DEEPSEEK_V4_FLASH_MODEL_ID]!),
    ).toBe('DeepSeek: 1 of 1 used')
  })

  test('an admission-counted chip says starts', () => {
    const counted = {
      ...quotas[DIRECTIONER_DEEPSEEK_V4_FLASH_MODEL_ID],
      countsAdmissions: true as const,
    }
    expect(formatDirectionerRowQuota(counted)).toBe('DeepSeek: 1 of 1 starts')
  })

  test('nothing is singled out when every row shares a pool', () => {
    const onePool = {
      [DIRECTIONER_GPT_6_LUNA_MODEL_ID]: quotas[DIRECTIONER_GPT_6_LUNA_MODEL_ID]!,
    }
    const { header, perModel } = getDirectionerSectionQuotas(
      [DIRECTIONER_GPT_6_LUNA_MODEL_ID],
      onePool,
    )
    expect(header?.pool).toBe('premium')
    expect(perModel).toEqual({})
  })

  test('an older server that sends no pool behaves exactly as before', () => {
    // One bucket, header from the first row, nothing inline — a new client
    // against an old server must not start annotating rows at random.
    const legacy = {
      [DIRECTIONER_GPT_6_LUNA_MODEL_ID]: {
        ...quotas[DIRECTIONER_GPT_6_LUNA_MODEL_ID]!,
        pool: undefined,
        poolLabel: undefined,
      },
      [DIRECTIONER_DEEPSEEK_V4_FLASH_MODEL_ID]: {
        ...quotas[DIRECTIONER_DEEPSEEK_V4_FLASH_MODEL_ID]!,
        pool: undefined,
        poolLabel: undefined,
      },
    }
    const { header, perModel } = getDirectionerSectionQuotas(rows, legacy)
    expect(header?.model).toBe(DIRECTIONER_GPT_6_LUNA_MODEL_ID)
    expect(perModel).toEqual({})
  })

  test('a pool the client has never heard of still renders', () => {
    // THE point of the server sending a label: this is what a future ceiling
    // looks like to a build shipped today.
    const future = {
      ...quotas,
      [DIRECTIONER_DEEPSEEK_V4_FLASH_MODEL_ID]: quota(
        DIRECTIONER_DEEPSEEK_V4_FLASH_MODEL_ID,
        'some_new_pool',
        'Frontier',
        2,
        2,
      ),
    }
    const { perModel } = getDirectionerSectionQuotas(rows, future)
    expect(
      formatDirectionerRowQuota(perModel[DIRECTIONER_DEEPSEEK_V4_FLASH_MODEL_ID]!),
    ).toBe('Frontier: 2 of 2 used')
  })
})
