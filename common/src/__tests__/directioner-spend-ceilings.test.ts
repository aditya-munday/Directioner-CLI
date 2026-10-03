import { describe, expect, it } from 'bun:test'

import {
  DIRECTIONER_CAPACITY_NOTICE,
  DIRECTIONER_RESTRICTED_NOTICE,
  DIRECTIONER_FREEBUCKS_CEILING_NOTICE,
  DIRECTIONER_BUDGET_NOTICE,
  directionerSpendNoticeFor,
} from '../constants/directioner-spend-ceilings'

describe('refusal copy', () => {
  it('gives a plain allowance no abuse framing', () => {
    for (const reason of ['region', 'elevated_country', 'trust_level']) {
      const copy = directionerSpendNoticeFor(reason)
      expect(copy).toBe(DIRECTIONER_BUDGET_NOTICE)
      expect(copy).not.toContain('abuse')
      // The words that turn a cap into a verdict on the person, and the ones
      // support tickets come back quoting.
      expect(copy.toLowerCase()).not.toContain('limited')
      expect(copy.toLowerCase()).not.toContain('restricted')
      expect(copy.toLowerCase()).not.toContain('blocked')
    }
  })

  it('keeps naming the cause SET for the restricted cohorts', () => {
    for (const reason of [
      'privacy_egress',
      'restricted_country',
      'flagged_email_domain',
      'unverified_egress',
    ]) {
      expect(directionerSpendNoticeFor(reason)).toBe(DIRECTIONER_RESTRICTED_NOTICE)
      // The whole point of naming the cause is that it carries an ACTION. A
      // user throttled for VPN egress who is only told they ran out has no way
      // to know that connecting directly restores the allowance -- which is
      // exactly what was happening on the rate-limit path until 2026-08-24.
      expect(DIRECTIONER_RESTRICTED_NOTICE).toContain('VPN')
      expect(DIRECTIONER_RESTRICTED_NOTICE).toContain('connecting directly')
    }
  })

  it('keeps third_party_client cause-blind so the detector stays unnamed', () => {
    expect(directionerSpendNoticeFor('third_party_client')).toBe(
      DIRECTIONER_CAPACITY_NOTICE,
    )
  })

  it('publishes no dollar figure in any refusal', () => {
    // A published cap is a published pacing instruction.
    for (const copy of [
      DIRECTIONER_BUDGET_NOTICE,
      DIRECTIONER_CAPACITY_NOTICE,
      DIRECTIONER_RESTRICTED_NOTICE,
    ]) {
      expect(copy).not.toMatch(/\$|\d/)
    }
  })

  it('preserves the legacy Freebucks refusal', () => {
    expect(directionerSpendNoticeFor('freebucks_plan')).toBe(
      DIRECTIONER_FREEBUCKS_CEILING_NOTICE,
    )
  })
})
