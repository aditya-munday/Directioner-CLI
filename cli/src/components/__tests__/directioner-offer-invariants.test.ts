// The CLI can offer two kinds of directioner row: the picker grid, and the referral banner's earned
// GLM 5.2 action. Both end up as a POST the server gates, and as a free-mode root agent that has
// to allow the model — so a row this surface can show must survive all of it. Desktop shipped the
// mirror-image of this bug (an offered GLM row its own route answered 400 for), which is what
// these lock down here.

import { describe, expect, test } from 'bun:test'

import { getDirectionerRootAgentIdForModel } from '@beyonders/common/constants/free-agents'
import {
  DIRECTIONER_REWARD_MODEL_ID,
  getDirectionerModelsForAccessTier,
  DIRECTIONER_GLM_V52_MODEL_ID,
  DIRECTIONER_GPT_6_LUNA_MODEL_ID,
  LIMITED_HOSTED_MODEL_ID,
} from '@beyonders/common/constants/directioner-models'
import { directionerOfferViolations } from '@beyonders/common/testing/directioner-offer-invariants'

import {
  resolveDirectionerModelPickForSession,
  resolveDirectionerModelSelectionForSession,
} from '../../hooks/use-directioner-session'
import { directionerCliOfferedModelIds } from '../directioner-model-selector'

import type { DirectionerAccessTier } from '@beyonders/common/constants/directioner-models'
import type { DirectionerSessionResponse } from '../../types/directioner-session'

function cliAcceptsModel(
  model: string,
  accessTier: DirectionerAccessTier,
  hasPaidSubscription = false,
): boolean {
  const session: DirectionerSessionResponse = {
    status: 'none',
    accessTier,
    ...(hasPaidSubscription
      ? { subscription: { tierId: 'starter', tiers: [] } }
      : {}),
  }
  return resolveDirectionerModelPickForSession(model, session) === model
}

describe('directioner rows the CLI offers', () => {
  for (const accessTier of ['full', 'limited'] as const) {
    test(`are all usable on the ${accessTier} tier`, () => {
      expect(
        directionerOfferViolations({
          surface: `cli picker + referral banner (${accessTier})`,
          accessTier,
          offered: directionerCliOfferedModelIds(accessTier),
          // the CLI's own resolver, which every session start runs the selection through: a model
          // it coerces away is one the user picked and never got
          accepts: (model) => cliAcceptsModel(model, accessTier),
          rootAgentIdFor: getDirectionerRootAgentIdForModel,
          catalog: 'supported',
        }),
      ).toEqual([])
    })
  }

  // A paid plan reaches limited regions, so a limited-region subscriber's grid gains the models
  // their plan meters. Its own surface: the CLI's own resolver has to keep the pick too, or the
  // user picks the model they bought and the session starts on MiMo.
  test('are all usable on the limited tier for a subscriber', () => {
    expect(
      directionerOfferViolations({
        surface: 'cli picker + referral banner (limited, subscriber)',
        accessTier: 'limited',
        hasPaidSubscription: true,
        offered: directionerCliOfferedModelIds('limited', true),
        accepts: (model) => cliAcceptsModel(model, 'limited', true),
        rootAgentIdFor: getDirectionerRootAgentIdForModel,
        catalog: 'supported',
      }),
    ).toEqual([])
  })

  // The plan widens what may be PICKED, never what the free pools give.
  test('the limited grid keeps every free row for a subscriber', () => {
    const free = directionerCliOfferedModelIds('limited')
    const paid = directionerCliOfferedModelIds('limited', true)
    for (const id of free) expect(paid).toContain(id)
    expect(paid.length).toBeGreaterThan(free.length)
  })

  test('a limited subscriber startup keeps their saved plan model selected', () => {
    const paidSession: DirectionerSessionResponse = {
      status: 'none',
      accessTier: 'limited',
      subscription: { tierId: 'starter', tiers: [] },
    }
    const unpaidSession: DirectionerSessionResponse = {
      status: 'none',
      accessTier: 'limited',
    }

    expect(
      resolveDirectionerModelSelectionForSession(
        DIRECTIONER_GPT_6_LUNA_MODEL_ID,
        paidSession,
      ),
    ).toBe(DIRECTIONER_GPT_6_LUNA_MODEL_ID)
    expect(
      resolveDirectionerModelSelectionForSession(
        DIRECTIONER_GPT_6_LUNA_MODEL_ID,
        unpaidSession,
      ),
    ).toBe(LIMITED_HOSTED_MODEL_ID)
  })

  test('the earned reward is offered on BOTH tiers', () => {
    // Limited access included: a bounty grant is redeemable there, so the row
    // has to be reachable there. The banner still only renders it against a
    // live balance.
    //
    // At FULL access it is also in the GRID since 2026-08-31 — the reward model
    // is GLM 5.3 Flash, an ordinary unmetered row and the CLI's default pick.
    // The old assertion that the grid never shows it was correct only while the
    // reward was GLM 5.2, which no tier's catalog listed.
    expect(directionerCliOfferedModelIds('full')).toContain(
      DIRECTIONER_REWARD_MODEL_ID,
    )
    expect(directionerCliOfferedModelIds('limited')).toContain(
      DIRECTIONER_REWARD_MODEL_ID,
    )
    // GLM 5.3 Flash is directly selectable in the limited grid as well.
    expect(getDirectionerModelsForAccessTier('limited').map((m) => m.id)).toContain(
      DIRECTIONER_REWARD_MODEL_ID,
    )
  })

  // 'base2-free' is the fallback root, and its allowlist has never included the referral reward.
  // A GLM row that fell through to it would 403 with free_mode_invalid_agent_model on the first
  // turn instead of failing at selection, so the mapping is what keeps the reward runnable.
  test('the reward maps to its own root agent rather than the fallback', () => {
    expect(getDirectionerRootAgentIdForModel(DIRECTIONER_GLM_V52_MODEL_ID)).toBe(
      'base2-free-glm',
    )
  })
})
