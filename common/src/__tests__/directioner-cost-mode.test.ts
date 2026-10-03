import { describe, expect, test } from 'bun:test'

import {
  isDirectionerCostModeEscalation,
  isDirectionerOnlyAgentId,
  parseExemptUserIds,
} from '../constants/directioner-cost-mode'
import { DIRECTIONER_ROOT_AGENT_IDS, isFreeMode } from '../constants/free-agents'

describe('isDirectionerOnlyAgentId', () => {
  test('every directioner root counts', () => {
    for (const id of DIRECTIONER_ROOT_AGENT_IDS) {
      expect(isDirectionerOnlyAgentId(id)).toBe(true)
    }
  })

  test('a non-beyonders publisher cannot borrow the id', () => {
    // Same publisher-spoof rule the other gates in free-agents.ts apply.
    expect(isDirectionerOnlyAgentId('base3-free-deepseek-flash')).toBe(true)
    expect(isDirectionerOnlyAgentId('beyonders/base3-free-deepseek-flash')).toBe(
      true,
    )
    expect(isDirectionerOnlyAgentId('someone/base3-free-deepseek-flash')).toBe(
      false,
    )
  })

  test('agents that are not directioner-only do not count', () => {
    // The bridge ids the reported traffic used, and ordinary paid agents.
    for (const id of ['fb-bridge-z-ai-glm-5-3-flash', 'fb-diag', 'base', '']) {
      expect(isDirectionerOnlyAgentId(id)).toBe(false)
    }
  })
})

describe('isDirectionerCostModeEscalation', () => {
  test('a directioner agent outside free mode is an escalation', () => {
    expect(
      isDirectionerCostModeEscalation({
        agentId: 'base3-free-glm-5-3-flash',
        isFreeModeRequest: isFreeMode('normal'),
      }),
    ).toBe(true)
  })

  test('the same agent in free mode is ordinary traffic', () => {
    expect(
      isDirectionerCostModeEscalation({
        agentId: 'base3-free-glm-5-3-flash',
        isFreeModeRequest: isFreeMode('free'),
      }),
    ).toBe(false)
  })

  test('a paid agent outside free mode is untouched', () => {
    // 4,711 accounts use both modes and thousands of paying customers send
    // metered requests for these models; this rule must never see them.
    for (const id of ['base', 'fb-bridge-z-ai-glm-5-3-flash']) {
      expect(
        isDirectionerCostModeEscalation({
          agentId: id,
          isFreeModeRequest: false,
        }),
      ).toBe(false)
    }
  })
})

describe('parseExemptUserIds', () => {
  test('parses, trims and tolerates an empty setting', () => {
    expect(parseExemptUserIds(undefined).size).toBe(0)
    expect(parseExemptUserIds('').size).toBe(0)
    const ids = parseExemptUserIds(' a-1 , b-2,, c-3 ')
    expect([...ids].sort()).toEqual(['a-1', 'b-2', 'c-3'])
  })
})
