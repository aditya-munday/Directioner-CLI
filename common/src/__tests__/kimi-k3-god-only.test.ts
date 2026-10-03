/**
 * Kimi K3 (Eco) is god-only on Directioner Web — a testing row, not a product one.
 * Cost backs that up: CrofAI lists it at $1.00/$4.00 per M against DeepSeek V4
 * Flash's $0.12/$0.21 on the same provider, ~8x input and ~19x output.
 */
import { describe, expect, it } from 'bun:test'

import {
  DIRECTIONER_KIMI_K3_ECO_MODEL_ID,
  HOSTED_MODELS,
  DIRECTIONER_WEB_ALL_MODELS,
  DIRECTIONER_WEB_GOD_ONLY_MODELS,
  DIRECTIONER_WEB_MODELS,
  DIRECTIONER_WEB_PREMIUM_MODEL_IDS,
  DIRECTIONER_STANDARD_MODEL_IDS,
  isDirectionerWebGodOnlyModelId,
  isDirectionerWebModelId,
  SUPPORTED_HOSTED_MODELS,
} from '../constants/directioner-models'

const KIMI_ID = DIRECTIONER_KIMI_K3_ECO_MODEL_ID

describe('Kimi K3 is god-only on Directioner Web', () => {
  it('is offered to god users and nobody else', () => {
    expect(isDirectionerWebGodOnlyModelId(KIMI_ID)).toBe(true)
    expect(isDirectionerWebModelId(KIMI_ID, { includeGodOnly: true })).toBe(true)
    expect(isDirectionerWebModelId(KIMI_ID, { includeGodOnly: false })).toBe(false)
    expect(DIRECTIONER_WEB_GOD_ONLY_MODELS.map((m) => m.id)).toContain(KIMI_ID)
    // The god-only list is additive to the visible one, so it must NOT also
    // appear there or every user would see it.
    expect(DIRECTIONER_WEB_MODELS.map((m) => m.id)).not.toContain(KIMI_ID)
  })

  it('stays off every non-web surface', () => {
    // Web only, as asked. HOSTED_MODELS is the CLI/Desktop catalog and
    // SUPPORTED_HOSTED_MODELS the waiting-room set.
    expect(HOSTED_MODELS.map((m) => m.id)).not.toContain(KIMI_ID)
    expect(SUPPORTED_HOSTED_MODELS.map((m) => m.id)).not.toContain(KIMI_ID)
    expect(DIRECTIONER_WEB_ALL_MODELS.map((m) => m.id)).toContain(KIMI_ID)
  })

  it('is metered by the premium pool, never the standard one', () => {
    // DIRECTIONER_STANDARD_MODEL_IDS is derived by filtering `!premium`, so a
    // premium row missing from the premium list would be metered by NO pool.
    expect(DIRECTIONER_WEB_PREMIUM_MODEL_IDS).toContain(KIMI_ID)
    expect(DIRECTIONER_STANDARD_MODEL_IDS).not.toContain(KIMI_ID)
    const model = DIRECTIONER_WEB_GOD_ONLY_MODELS.find((m) => m.id === KIMI_ID)
    expect(model?.premium).toBe(true)
  })

  it('displays as "Kimi K3" while the wire id keeps the -eco build', () => {
    // DELIBERATE, by explicit request, and the reason this assertion exists: it
    // breaks the convention DeepSeek V4 Flash 07/31 sets (name the exact build),
    // so without a test someone would "fix" the label to 'Kimi K3 Eco'.
    //
    // The wire id must keep `-eco` regardless. CrofAI serves a full `kimi-k3` at
    // twice the price ($2.00/$8.00), and routing, billing and CROF_MODEL_MAP all
    // key off this id — collapsing it to a bare `kimi-k3` would silently point
    // this row at the dearer model.
    const model = DIRECTIONER_WEB_GOD_ONLY_MODELS.find((m) => m.id === KIMI_ID)
    expect(model?.displayName).toBe('Kimi K3')
    expect(model?.displayName).not.toContain('Eco')
    expect(KIMI_ID).toBe('crof/kimi-k3-eco')
  })

  it('is marked experimental, since it exists to be tested', () => {
    const model = DIRECTIONER_WEB_GOD_ONLY_MODELS.find((m) => m.id === KIMI_ID)
    expect(model?.experimental).toBe(true)
  })

  it('keeps its id distinct from every other catalog row', () => {
    // A second id for an already-offered model is how the retired `crof/glm-5.2`
    // became a quota-bypass route. This must be the only id that reaches K3 Eco.
    const all = DIRECTIONER_WEB_ALL_MODELS.map((m) => m.id)
    expect(new Set(all).size).toBe(all.length)
  })
})
