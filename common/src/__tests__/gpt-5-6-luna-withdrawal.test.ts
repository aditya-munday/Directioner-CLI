/**
 * GPT-5.6 Luna left every picker on 2026-09-22, when GPT-6 Luna took its slot,
 * and was WITHDRAWN from free mode on 2026-09-24.
 *
 * These tests pin the withdrawal and the two halves of it a later reader would
 * otherwise "tidy" in opposite directions (the same shape as ox-alpha.test.ts):
 *
 *   - it is offered by no surface and admitted at no tier;
 *   - it is still a RECOGNISED id, so the released CLI and Desktop binaries
 *     that hold it in their compiled-in catalog get the withdrawn answer (or a
 *     coercion at limited access) rather than an unknown-model refusal they
 *     would retry forever (#1801).
 *
 * And one thing it deliberately is NOT: silently served as GPT-6 Luna. GPT-6
 * Luna is open only to US or paid accounts, so substituting it would either
 * give the gated row to every old binary or refuse users for a model they
 * never picked.
 */
import { describe, expect, it } from 'bun:test'

import {
  DEFAULT_HOSTED_MODEL_ID,
  DIRECTIONER_GPT_5_6_LUNA_ES_MODEL_ID,
  DIRECTIONER_GPT_5_6_LUNA_MODEL_ID,
  DIRECTIONER_GPT_5_6_LUNA_PRO_MODEL_ID,
  DIRECTIONER_GPT_6_LUNA_MODEL_ID,
  HOSTED_MODELS,
  DIRECTIONER_PAUSED_FREE_MODEL_IDS,
  DIRECTIONER_PLAN_METERED_CATALOG_MODEL_IDS,
  DIRECTIONER_STANDARD_MODEL_IDS,
  DIRECTIONER_LIMITED_TIER_PLAN_ONLY_MODEL_IDS,
  DIRECTIONER_WEB_ALL_MODELS,
  DIRECTIONER_WEB_LIMITED_MODEL_IDS,
  DIRECTIONER_WEB_MODELS,
  LIMITED_HOSTED_MODEL_ID,
  LIMITED_HOSTED_MODEL_IDS,
  SUPPORTED_HOSTED_MODELS,
  directionerWithdrawnModelMessage,
  getDirectionerModelSupersededBy,
  getDirectionerModelsForAccessTier,
  isDirectionerPausedFreeModelId,
  isDirectionerSessionModelAllowedForAccessTier,
  isDirectionerSessionModelId,
  isDirectionerWebModelId,
  isSupportedDirectionerModelId,
  resolveDirectionerSessionModelForAccessTier,
} from '../constants/directioner-models'
import {
  FREE_MODE_AGENT_MODELS,
  DIRECTIONER_ROOT_AGENT_ID_BY_MODEL,
} from '../constants/free-agents'

const LUNA_56 = DIRECTIONER_GPT_5_6_LUNA_MODEL_ID

describe('GPT-5.6 Luna is withdrawn', () => {
  it('is offered by no picker on any surface, at any tier or plan', () => {
    for (const list of [
      HOSTED_MODELS,
      DIRECTIONER_WEB_MODELS,
      DIRECTIONER_WEB_ALL_MODELS,
      getDirectionerModelsForAccessTier('full'),
      getDirectionerModelsForAccessTier('limited'),
      getDirectionerModelsForAccessTier('limited', true),
    ]) {
      expect(list.map((model) => model.id)).not.toContain(LUNA_56)
    }
    expect(isDirectionerWebModelId(LUNA_56)).toBe(false)
    expect(isDirectionerWebModelId(LUNA_56, { includeGodOnly: true })).toBe(false)
    expect(LIMITED_HOSTED_MODEL_IDS).not.toContain(LUNA_56)
    expect(DIRECTIONER_WEB_LIMITED_MODEL_IDS).not.toContain(LUNA_56)
    // No plan meters it, so no plan widens a limited account onto it either.
    expect(DIRECTIONER_PLAN_METERED_CATALOG_MODEL_IDS).not.toContain(LUNA_56)
    expect(DIRECTIONER_STANDARD_MODEL_IDS).not.toContain(LUNA_56)
  })

  it('is paused, and admitted at no tier', () => {
    expect(DIRECTIONER_PAUSED_FREE_MODEL_IDS).toContain(LUNA_56)
    expect(isDirectionerPausedFreeModelId(LUNA_56)).toBe(true)
    // A dated snapshot cannot slip past the pause.
    expect(isDirectionerPausedFreeModelId(`${LUNA_56}-20260801`)).toBe(true)
    for (const tier of ['full', 'limited'] as const) {
      for (const hasPaidSubscription of [false, true]) {
        expect(
          isDirectionerSessionModelAllowedForAccessTier(
            LUNA_56,
            tier,
            hasPaidSubscription,
          ),
        ).toBe(false)
      }
    }
  })

  it('pauses only 5.6 itself, never a sibling id that shares its prefix', () => {
    // The pause matches dated snapshots, not arbitrary suffixes, so the -es
    // route, the -pro tier and the successor are all untouched by it.
    for (const id of [
      DIRECTIONER_GPT_6_LUNA_MODEL_ID,
      DIRECTIONER_GPT_5_6_LUNA_ES_MODEL_ID,
      DIRECTIONER_GPT_5_6_LUNA_PRO_MODEL_ID,
    ]) {
      expect(isDirectionerPausedFreeModelId(id)).toBe(false)
    }
  })

  it('is still RECOGNISED, so released binaries holding it are answered rather than refused as unknown', () => {
    expect(SUPPORTED_HOSTED_MODELS.map((model) => model.id)).toContain(
      LUNA_56,
    )
    expect(isSupportedDirectionerModelId(LUNA_56)).toBe(true)
    expect(isDirectionerSessionModelId(LUNA_56)).toBe(true)
    // Its roots stay wired so the free-mode allowlist still knows the pair
    // until nothing live can be bound to it.
    expect(DIRECTIONER_ROOT_AGENT_ID_BY_MODEL[LUNA_56]).toBe('base2-free-luna')
    expect(FREE_MODE_AGENT_MODELS['base3-free-luna']?.has(LUNA_56)).toBe(true)
  })

  it('is coerced to the limited default at limited access, and answered as withdrawn at full access', () => {
    // Limited: coerced before admission ever sees the pause.
    expect(resolveDirectionerSessionModelForAccessTier(LUNA_56, 'limited')).toBe(
      LIMITED_HOSTED_MODEL_ID,
    )
    // Full: the pick survives resolution still paused, which is what makes
    // admission answer the withdrawn `model_unavailable` (not session-ending).
    const resolved = resolveDirectionerSessionModelForAccessTier(LUNA_56, 'full')
    expect(resolved).toBe(LUNA_56)
    expect(isDirectionerPausedFreeModelId(resolved)).toBe(true)
    // The message names the model the user picked and a replacement every
    // full-access account can open.
    const message = directionerWithdrawnModelMessage(LUNA_56)
    expect(message).toContain('GPT-5.6 Luna')
    const replacement = SUPPORTED_HOSTED_MODELS.find(
      (model) => model.id === DEFAULT_HOSTED_MODEL_ID,
    )!
    expect(message).toContain(replacement.displayName)
    expect(DIRECTIONER_LIMITED_TIER_PLAN_ONLY_MODEL_IDS).not.toContain(
      DEFAULT_HOSTED_MODEL_ID,
    )
  })

  it('is not silently moved onto GPT-6 Luna, which is plan-only at limited access', () => {
    expect(DIRECTIONER_LIMITED_TIER_PLAN_ONLY_MODEL_IDS).toContain(
      DIRECTIONER_GPT_6_LUNA_MODEL_ID,
    )
    const all = SUPPORTED_HOSTED_MODELS.map((model) => model.id)
    expect(getDirectionerModelSupersededBy(LUNA_56, all)).toBeUndefined()
    expect(resolveDirectionerSessionModelForAccessTier(LUNA_56, 'full')).not.toBe(
      DIRECTIONER_GPT_6_LUNA_MODEL_ID,
    )
  })
})
