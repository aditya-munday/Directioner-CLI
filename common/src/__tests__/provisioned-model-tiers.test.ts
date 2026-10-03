/**
 * The provisioned tiers (extended-context `-max` and early-access) and the
 * internal evaluation routes.
 *
 * These are granted per account rather than picked, so the invariant is the
 * opposite of a normal model's: every catalog must NOT contain them. A client
 * that rendered one would offer a row most accounts cannot run, and the
 * request would fail at admission rather than at the picker — the confusing
 * shape a hidden tier always takes when it leaks into a selectable list.
 *
 * Each tier is pinned to exactly one root, like every other free-mode model,
 * and each root is pinned to exactly that tier: a root that also accepted the
 * base model would be a second, unmetered door onto it — which is what the
 * retired `base2-free-glm-crof` route turned out to be.
 */
import { describe, expect, test } from 'bun:test'

import {
  FREE_MODE_AGENT_MODELS,
  DIRECTIONER_CLI_BASE3_AGENT_ID_BY_MODEL,
  DIRECTIONER_ROOT_AGENT_IDS,
  DIRECTIONER_WEB_BASE3_AGENT_ID_BY_MODEL,
  getDirectionerRootAgentIdForModel,
  isFreeModeAllowedAgentModel,
} from '../constants/free-agents'
import {
  DIRECTIONER_MIMO_V25_MODEL_ID,
  DIRECTIONER_CLAUDE_OPUS_4_8_MODEL_ID,
  DIRECTIONER_CLAUDE_OPUS_5_5_MODEL_ID,
  DIRECTIONER_CLAUDE_OPUS_5_MODEL_ID,
  DIRECTIONER_CLAUDE_SONNET_4_6_MODEL_ID,
  DIRECTIONER_CLAUDE_SONNET_5_MODEL_ID,
  DIRECTIONER_CODESTRAL_2508_MODEL_ID,
  DIRECTIONER_DEEPSEEK_V41_FLASH_MODEL_ID,
  DIRECTIONER_DEEPSEEK_V4_FLASH_MODEL_ID,
  DIRECTIONER_DEEPSEEK_V4_PRO_MODEL_ID,
  DIRECTIONER_FABLE_5_1_MODEL_ID,
  DIRECTIONER_GEMINI_3_5_FLASH_MODEL_ID,
  DIRECTIONER_GEMINI_3_6_FLASH_MODEL_ID,
  DIRECTIONER_GEMINI_3_7_FLASH_MODEL_ID,
  DIRECTIONER_GLM_5_3_FLASHX_MODEL_ID,
  DIRECTIONER_GLM_5_3_PRIME_MODEL_ID,
  DIRECTIONER_GLM_5_TURBO_MODEL_ID,
  DIRECTIONER_GLM_V53_FLASH_MODEL_ID,
  DIRECTIONER_GLM_V53_MODEL_ID,
  DIRECTIONER_GPT_5_4_PRO_MODEL_ID,
  DIRECTIONER_GPT_5_5_MODEL_ID,
  DIRECTIONER_GPT_5_5_PRO_MODEL_ID,
  DIRECTIONER_GPT_5_6_LUNA_MODEL_ID,
  DIRECTIONER_GPT_5_6_LUNA_PRO_MODEL_ID,
  DIRECTIONER_GPT_5_6_SOL_MODEL_ID,
  DIRECTIONER_GPT_5_6_SOL_PRO_MODEL_ID,
  DIRECTIONER_GPT_5_6_TERRA_MODEL_ID,
  DIRECTIONER_GPT_5_6_TERRA_PRO_MODEL_ID,
  DIRECTIONER_GPT_6_ASTRA_MODEL_ID,
  DIRECTIONER_GPT_6_ASTRA_PRO_MODEL_ID,
  DIRECTIONER_GPT_6_LUNA_PRO_MODEL_ID,
  DIRECTIONER_GPT_6_SOL_MODEL_ID,
  DIRECTIONER_GPT_6_SOL_PRO_MODEL_ID,
  DIRECTIONER_GROK_4_20_MODEL_ID,
  DIRECTIONER_GROK_4_5_MODEL_ID,
  DIRECTIONER_GROK_4_6_MODEL_ID,
  DIRECTIONER_GROK_4_7_MODEL_ID,
  DIRECTIONER_KIMI_K3_MODEL_ID,
  DIRECTIONER_LLAMA_4_MAVERICK_MODEL_ID,
  DIRECTIONER_MISTRAL_LARGE_MODEL_ID,
  HOSTED_MODELS,
  DIRECTIONER_O3_PRO_MODEL_ID,
  DIRECTIONER_PROVISIONED_MODELS,
  DIRECTIONER_QWEN3_6_MAX_PREVIEW_MODEL_ID,
  DIRECTIONER_QWEN3_6_PLUS_MODEL_ID,
  DIRECTIONER_QWEN3_7_MAX_MODEL_ID,
  DIRECTIONER_QWEN3_7_PLUS_MODEL_ID,
  DIRECTIONER_QWEN3_8_27B_MODEL_ID,
  DIRECTIONER_QWEN3_8_FLASH_MODEL_ID,
  DIRECTIONER_QWEN3_8_MAX_0902_MODEL_ID,
  DIRECTIONER_QWEN3_8_MAX_PRIME_MODEL_ID,
  DIRECTIONER_SOLAR_MINI_4_MODEL_ID,
  DIRECTIONER_STANDARD_MODEL_IDS,
  DIRECTIONER_WEB_ALL_MODELS,
  DIRECTIONER_WEB_MODELS,
  DIRECTIONER_WEB_PREMIUM_MODEL_IDS,
  SUPPORTED_HOSTED_MODELS,
  resolveSupportedDirectionerModel,
} from '../constants/directioner-models'

/** tier -> the root that runs it, and the base model it extends. */
const TIERS: Array<{ id: string; root: string; base: string }> = [
  {
    id: DIRECTIONER_DEEPSEEK_V41_FLASH_MODEL_ID,
    root: 'base2-free-deepseek-v4-1-flash',
    base: DIRECTIONER_DEEPSEEK_V4_FLASH_MODEL_ID,
  },
  {
    id: DIRECTIONER_GLM_V53_MODEL_ID,
    root: 'base2-free-glm-5-3',
    base: DIRECTIONER_GLM_V53_FLASH_MODEL_ID,
  },
  {
    id: DIRECTIONER_GPT_6_SOL_MODEL_ID,
    root: 'base2-free-gpt-6-sol',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_GPT_6_SOL_PRO_MODEL_ID,
    root: 'base2-free-gpt-6-sol-pro',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_GPT_6_LUNA_PRO_MODEL_ID,
    root: 'base2-free-gpt-6-luna-pro',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_GPT_6_ASTRA_MODEL_ID,
    root: 'base2-free-gpt-6-astra',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_GPT_6_ASTRA_PRO_MODEL_ID,
    root: 'base2-free-gpt-6-astra-pro',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_GPT_5_6_SOL_MODEL_ID,
    root: 'base2-free-gpt-5-6-sol',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_GPT_5_6_SOL_PRO_MODEL_ID,
    root: 'base2-free-gpt-5-6-sol-pro',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_GPT_5_6_TERRA_MODEL_ID,
    root: 'base2-free-gpt-5-6-terra',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_GPT_5_6_TERRA_PRO_MODEL_ID,
    root: 'base2-free-gpt-5-6-terra-pro',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_GPT_5_6_LUNA_PRO_MODEL_ID,
    root: 'base2-free-gpt-5-6-luna-pro',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_GPT_5_5_MODEL_ID,
    root: 'base2-free-gpt-5-5',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_GPT_5_5_PRO_MODEL_ID,
    root: 'base2-free-gpt-5-5-pro',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_GPT_5_4_PRO_MODEL_ID,
    root: 'base2-free-gpt-5-4-pro',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_O3_PRO_MODEL_ID,
    root: 'base2-free-o3-pro',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_CLAUDE_OPUS_5_5_MODEL_ID,
    root: 'base2-free-claude-opus-5-5',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_CLAUDE_OPUS_5_MODEL_ID,
    root: 'base2-free-claude-opus-5',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_CLAUDE_SONNET_5_MODEL_ID,
    root: 'base2-free-claude-sonnet-5',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_CLAUDE_OPUS_4_8_MODEL_ID,
    root: 'base2-free-claude-opus-4-8',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_CLAUDE_SONNET_4_6_MODEL_ID,
    root: 'base2-free-claude-sonnet-4-6',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_QWEN3_8_MAX_PRIME_MODEL_ID,
    root: 'base2-free-qwen3-8-max-prime',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_QWEN3_8_MAX_0902_MODEL_ID,
    root: 'base2-free-qwen3-8-max-0902',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_QWEN3_8_FLASH_MODEL_ID,
    root: 'base2-free-qwen3-8-flash',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_QWEN3_8_27B_MODEL_ID,
    root: 'base2-free-qwen3-8-27b',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_QWEN3_7_MAX_MODEL_ID,
    root: 'base2-free-qwen3-7-max',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_QWEN3_7_PLUS_MODEL_ID,
    root: 'base2-free-qwen3-7-plus',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_QWEN3_6_MAX_PREVIEW_MODEL_ID,
    root: 'base2-free-qwen3-6-max-preview',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_QWEN3_6_PLUS_MODEL_ID,
    root: 'base2-free-qwen3-6-plus',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_GROK_4_7_MODEL_ID,
    root: 'base2-free-grok-4-7',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_GROK_4_6_MODEL_ID,
    root: 'base2-free-grok-4-6',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_GROK_4_5_MODEL_ID,
    root: 'base2-free-grok-4-5',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_GROK_4_20_MODEL_ID,
    root: 'base2-free-grok-4-20',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_GEMINI_3_7_FLASH_MODEL_ID,
    root: 'base2-free-gemini-3-7-flash',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_GEMINI_3_6_FLASH_MODEL_ID,
    root: 'base2-free-gemini-3-6-flash',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_GEMINI_3_5_FLASH_MODEL_ID,
    root: 'base2-free-gemini-3-5-flash',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_KIMI_K3_MODEL_ID,
    root: 'base2-free-kimi-k3',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_GLM_5_3_PRIME_MODEL_ID,
    root: 'base2-free-glm-5-3-prime',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_GLM_5_3_FLASHX_MODEL_ID,
    root: 'base2-free-glm-5-3-flashx',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_GLM_5_TURBO_MODEL_ID,
    root: 'base2-free-glm-5-turbo',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_MISTRAL_LARGE_MODEL_ID,
    root: 'base2-free-mistral-large',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_CODESTRAL_2508_MODEL_ID,
    root: 'base2-free-codestral-2508',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
  {
    id: DIRECTIONER_LLAMA_4_MAVERICK_MODEL_ID,
    root: 'base2-free-llama-4-maverick',
    base: DIRECTIONER_MIMO_V25_MODEL_ID,
  },
]

describe('provisioned tiers are never offered from a catalog', () => {
  test('the tier list is not empty', () => {
    // Floor: an empty list makes every case below vacuous.
    expect(DIRECTIONER_PROVISIONED_MODELS.length).toBe(TIERS.length)
    const rowIds = [...DIRECTIONER_PROVISIONED_MODELS].map((m) => m.id)
    for (const tier of TIERS) expect(rowIds).toContain(tier.id)
  })

  const catalogs: Array<[string, readonly string[]]> = [
    ['SUPPORTED_HOSTED_MODELS', SUPPORTED_HOSTED_MODELS.map((m) => m.id)],
    ['HOSTED_MODELS', HOSTED_MODELS.map((m) => m.id)],
    ['DIRECTIONER_WEB_MODELS', DIRECTIONER_WEB_MODELS.map((m) => m.id)],
    ['DIRECTIONER_WEB_ALL_MODELS', DIRECTIONER_WEB_ALL_MODELS.map((m) => m.id)],
    ['DIRECTIONER_WEB_PREMIUM_MODEL_IDS', [...DIRECTIONER_WEB_PREMIUM_MODEL_IDS]],
    ['DIRECTIONER_STANDARD_MODEL_IDS', [...DIRECTIONER_STANDARD_MODEL_IDS]],
  ]

  test.each(catalogs)('%s omits every provisioned tier', (_name, ids) => {
    for (const tier of TIERS) expect(ids).not.toContain(tier.id)
  })

  test('a saved preference for a tier falls back to a pickable model', () => {
    for (const tier of TIERS) {
      expect(resolveSupportedDirectionerModel(tier.id)).not.toBe(tier.id)
    }
  })

  test('the base2 root map resolves each tier to its own root', () => {
    // An account holding the grant starts on the tier's root, never on the
    // base model's.
    for (const tier of TIERS) {
      expect(getDirectionerRootAgentIdForModel(tier.id)).toBe(tier.root)
    }
  })

  test('no base3 root map resolves a provisioned tier', () => {
    for (const tier of TIERS) {
      expect(DIRECTIONER_WEB_BASE3_AGENT_ID_BY_MODEL[tier.id]).toBeUndefined()
      expect(DIRECTIONER_CLI_BASE3_AGENT_ID_BY_MODEL[tier.id]).toBeUndefined()
    }
  })
})

describe('each tier is pinned to exactly one root', () => {
  test.each(TIERS)('$id runs on $root and nothing else', (tier) => {
    expect(FREE_MODE_AGENT_MODELS[tier.root]?.has(tier.id)).toBe(true)
    expect(isFreeModeAllowedAgentModel(tier.root, tier.id)).toBe(true)
  })

  test.each(TIERS)('$root cannot run the base model $base', (tier) => {
    // A second, unmetered door onto the base model otherwise.
    expect(isFreeModeAllowedAgentModel(tier.root, tier.base)).toBe(false)
  })

  test.each(TIERS)('$root is a registered root agent', (tier) => {
    // A root absent from this list is treated as a subagent, so a top-level
    // request on it fails the hierarchy check instead of running.
    expect(DIRECTIONER_ROOT_AGENT_IDS).toContain(tier.root)
  })

  test.each(TIERS)('the base model does not run on $root', (tier) => {
    const rootForBase = Object.entries(FREE_MODE_AGENT_MODELS).filter(
      ([agentId, models]) => models.has(tier.base) && agentId === tier.root,
    )
    expect(rootForBase).toEqual([])
  })
})
