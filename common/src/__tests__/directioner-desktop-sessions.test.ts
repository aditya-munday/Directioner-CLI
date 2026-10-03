import { describe, expect, test } from 'bun:test'

import {
  DIRECTIONER_DEEPSEEK_V4_FLASH_MODEL_ID,
  DIRECTIONER_GEMINI_38_FLASH_MODEL_ID,
  DIRECTIONER_GLM_V53_FLASH_MODEL_ID,
  DIRECTIONER_GPT_6_LUNA_MODEL_ID,
  HOSTED_MODELS,
  DIRECTIONER_SOLAR_PRO_4_MODEL_ID,
  DIRECTIONER_WEB_PREMIUM_MODEL_IDS,
} from '../constants/directioner-models'
import {
  directionerDesktopConcurrencyLimits,
  getDirectionerDesktopConcurrency,
} from '../constants/directioner-desktop-sessions'

describe('Directioner Desktop session concurrency', () => {
  test('projects account ceilings', () => {
    expect(directionerDesktopConcurrencyLimits('full', false)).toEqual({
      'slot-bound': 1,
      'multi-tab': 3,
    })
    expect(directionerDesktopConcurrencyLimits('limited', false)).toEqual({
      'slot-bound': 1,
      'multi-tab': 0,
    })
    expect(directionerDesktopConcurrencyLimits('limited', true)).toEqual({
      'slot-bound': 3,
      'multi-tab': 8,
    })
  })

  test('classifies models by tier and plan', () => {
    const cases = [
      [
        // GPT-6 Luna since 2026-09-22, when it took 5.6's slot-bound entry.
        `${DIRECTIONER_GPT_6_LUNA_MODEL_ID}-20260922`,
        'full',
        false,
        'slot-bound',
      ],
      [DIRECTIONER_GEMINI_38_FLASH_MODEL_ID, 'full', false, 'slot-bound'],
      [DIRECTIONER_GLM_V53_FLASH_MODEL_ID, 'full', false, 'multi-tab'],
      [DIRECTIONER_SOLAR_PRO_4_MODEL_ID, 'full', false, 'multi-tab'],
      [DIRECTIONER_SOLAR_PRO_4_MODEL_ID, 'limited', false, 'slot-bound'],
      [DIRECTIONER_SOLAR_PRO_4_MODEL_ID, 'limited', true, 'multi-tab'],
      [DIRECTIONER_DEEPSEEK_V4_FLASH_MODEL_ID, 'limited', false, 'slot-bound'],
    ] as const
    for (const [model, tier, paidPlan, expected] of cases) {
      expect(getDirectionerDesktopConcurrency(model, tier, paidPlan)).toBe(
        expected,
      )
    }

    const desktopModels = new Set<string>(HOSTED_MODELS.map(({ id }) => id))
    for (const id of DIRECTIONER_WEB_PREMIUM_MODEL_IDS) {
      if (desktopModels.has(id)) {
        expect(getDirectionerDesktopConcurrency(id, 'full')).toBe('slot-bound')
      }
    }
  })
})
