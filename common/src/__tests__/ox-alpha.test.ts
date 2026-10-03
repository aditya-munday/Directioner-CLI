/**
 * Ox Alpha was a Web/Cloud row served at a list price of zero by an anonymous
 * host, widened to CLI, Desktop and the limited tier on 2026-08-24, and
 * WITHDRAWN on 2026-08-27 when that host ended the free promotion.
 *
 * These tests no longer describe a model we serve. They pin a WITHDRAWAL, and
 * the two halves of it that a later reader would otherwise "tidy" in opposite
 * directions:
 *
 *   - it is out of every picker and every quota list, on every surface;
 *   - it is still a RECOGNISED id, with its roots still wired.
 *
 * The second half looks like leftovers and is not. An id dropped from
 * SUPPORTED entirely is one the server can only refuse, never coerce or
 * explain, and every released CLI and Desktop binary still holds this pick in
 * its compiled-in catalog — the retry loop that cost the limited tier 2.5x its
 * admissions in #1801. See DIRECTIONER_PAUSED_FREE_MODEL_IDS and the
 * "Withdrawing it" section of docs/directioner-ox-alpha.md.
 */
import { describe, expect, it } from 'bun:test'

import type { DirectionerModelOption } from '../constants/directioner-models'
import {
  DEFAULT_HOSTED_MODEL_ID,
  HOSTED_MODELS,
  DIRECTIONER_PAUSED_FREE_MODEL_IDS,
  DIRECTIONER_WEB_GEO_EXEMPT_MODEL_IDS,
  DIRECTIONER_WEB_LIMITED_MODEL_IDS,
  directionerWithdrawnModelMessage,
  isDirectionerPausedFreeModelId,
  isDirectionerSessionModelAllowedForAccessTier,
  isDirectionerWebModelAllowedForLimitedTier,
  isSupportedDirectionerModelId,
  LIMITED_HOSTED_MODEL_IDS,
  HOSTED_MODEL_CONTEXT_WINDOWS,
  DIRECTIONER_OX_ALPHA_MAX_PRICE,
  DIRECTIONER_OX_ALPHA_MODEL_ID,
  DIRECTIONER_STANDARD_MODEL_IDS,
  DIRECTIONER_TRACED_MODEL_IDS,
  DIRECTIONER_WEB_ALL_MODELS,
  DIRECTIONER_WEB_MODELS,
  DIRECTIONER_WEB_PREMIUM_MODEL_IDS,
  isDirectionerOxAlphaModelId,
  isDirectionerWebModelId,
  resolveDirectionerSessionModelForAccessTier,
  SUPPORTED_HOSTED_MODELS,
} from '../constants/directioner-models'
import {
  DIRECTIONER_ROOT_AGENT_IDS,
  DIRECTIONER_ROOT_AGENT_ID_BY_MODEL,
  DIRECTIONER_WEB_BASE3_AGENT_ID_BY_MODEL,
  DIRECTIONER_CLI_BASE3_AGENT_ID_BY_MODEL,
  FREE_MODE_AGENT_MODELS,
} from '../constants/free-agents'

const OX = DIRECTIONER_OX_ALPHA_MODEL_ID
/** The catalog row survives the withdrawal; only the picker lists lose it. */
const row = SUPPORTED_HOSTED_MODELS.find((m) => m.id === OX)

describe('Ox Alpha is withdrawn from every surface', () => {
  /**
   * This test used to assert the exact opposite ("is on every surface, and
   * carries its CLI root with it"). It flipped because the host ended the free
   * promotion, not because the measurements that justified widening it were
   * wrong — the four days of $0.0000 traffic recorded in
   * docs/directioner-ox-alpha.md all happened.
   *
   * What the flip costs is the thing the doc warned about in advance: on CLI
   * and Desktop the catalog ships INSIDE a binary, so removing the row here
   * reaches new builds only. The lever that reaches installed ones is the
   * pause, asserted below.
   */
  it('is in no picker list on any surface', () => {
    expect(HOSTED_MODELS.map((m) => m.id)).not.toContain(OX)
    expect(DIRECTIONER_WEB_MODELS.map((m) => m.id)).not.toContain(OX)
    expect(DIRECTIONER_WEB_ALL_MODELS.map((m) => m.id)).not.toContain(OX)
    expect(isDirectionerWebModelId(OX)).toBe(false)
    expect(isDirectionerWebModelId(OX, { includeGodOnly: true })).toBe(false)
  })

  it('is in no quota list, so nothing meters a row nothing may admit', () => {
    expect(DIRECTIONER_WEB_PREMIUM_MODEL_IDS as readonly string[]).not.toContain(
      OX,
    )
    // It was `premium: false`, which used to place it here via the
    // `!premium` filter over DIRECTIONER_WEB_ALL_MODELS. Leaving the catalog
    // dropped it from the derived list with no second edit — that derivation is
    // why the flag on the row could stay as written.
    expect(DIRECTIONER_STANDARD_MODEL_IDS as readonly string[]).not.toContain(OX)
  })

  it('reaches neither limited catalog, and the two still agree', () => {
    expect(LIMITED_HOSTED_MODEL_IDS as readonly string[]).not.toContain(OX)
    expect(
      DIRECTIONER_WEB_GEO_EXEMPT_MODEL_IDS as readonly string[],
    ).not.toContain(OX)
    expect(DIRECTIONER_WEB_LIMITED_MODEL_IDS).not.toContain(OX)
    // Both halves, because they are enforced in different places and only one
    // is visible to a user: the picker list decides whether the row is drawn,
    // the session gate decides whether a send works. A row that passes one and
    // fails the other is the shape directioner-offer-invariants.ts exists for —
    // and a withdrawal has to clear BOTH or it leaves that bug behind.
    expect(isDirectionerWebModelAllowedForLimitedTier(OX)).toBe(false)
    expect(isDirectionerSessionModelAllowedForAccessTier(OX, 'limited')).toBe(
      false,
    )
  })

  it('is refused at full access too', () => {
    // The pause is checked ahead of every other branch in this function, which
    // is what makes one list entry enough for both tiers.
    expect(isDirectionerSessionModelAllowedForAccessTier(OX, 'full')).toBe(false)
  })
})

describe('Ox Alpha is PAUSED, not deleted', () => {
  it('is on the pause list and answers the predicate', () => {
    expect(DIRECTIONER_PAUSED_FREE_MODEL_IDS).toContain(OX)
    expect(isDirectionerPausedFreeModelId(OX)).toBe(true)
  })

  /**
   * The load-bearing half. Dropping the id from SUPPORTED is the change that
   * looks like finishing the job and is actually the outage: admission can only
   * refuse an id it does not recognise, and it cannot name a replacement.
   */
  it('stays a recognised id, so admission can explain rather than refuse', () => {
    expect(row).toBeDefined()
    expect(isSupportedDirectionerModelId(OX)).toBe(true)
    expect(resolveDirectionerSessionModelForAccessTier(OX, 'full')).toBe(OX)
    // Named, not silently swapped: the client that sends this id is a released
    // binary whose picker still lists it, so the user is told what happened.
    const message = directionerWithdrawnModelMessage(OX)
    expect(message).toContain('Ox Alpha')
    expect(message).toContain('no longer available')
    expect(message).not.toContain(OX)
    expect(message).not.toBe(directionerWithdrawnModelMessage('nonexistent/model'))
  })

  /**
   * A limited-tier client gets a coercion rather than a message, because that
   * branch has a tier default to fall back to. Both paths must be non-throwing
   * for an id no picker offers any more.
   */
  it('coerces to the tier default at limited access', () => {
    expect(resolveDirectionerSessionModelForAccessTier(OX, 'limited')).not.toBe(OX)
  })

  it('keeps its roots wired so live sessions drain instead of failing', () => {
    // Removing these is step 3 of the withdrawal, and doing it in the same
    // deploy as the pause fails running turns mid-flight with
    // free_mode_invalid_agent_model. The door is shut in front of a session,
    // not under it.
    expect(DIRECTIONER_ROOT_AGENT_ID_BY_MODEL[OX]).toBe('base2-free-ox-alpha')
    expect(DIRECTIONER_WEB_BASE3_AGENT_ID_BY_MODEL[OX]).toBe('base3-free-ox-alpha')
    expect(DIRECTIONER_CLI_BASE3_AGENT_ID_BY_MODEL[OX]).toBe('base3-free-ox-alpha')
    for (const id of ['base2-free-ox-alpha', 'base3-free-ox-alpha']) {
      expect(DIRECTIONER_ROOT_AGENT_IDS as readonly string[]).toContain(id)
      // Still pinned to exactly one model. A withdrawn root that widened would
      // be a door onto everything it allows, opened by nobody watching.
      expect([...(FREE_MODE_AGENT_MODELS[id] ?? [])]).toEqual([OX])
    }
  })

  it('is not the default anywhere, and never was', () => {
    expect(DEFAULT_HOSTED_MODEL_ID).not.toBe(OX)
    expect(HOSTED_MODELS[0]?.id).not.toBe(OX)
  })
})

describe('the fence and the row survive the withdrawal', () => {
  it('still fences the price at exactly zero', () => {
    // Kept deliberately. It costs nothing while nothing is admitted, and it is
    // the guard that stops a repriced stealth slug billing us if this row is
    // ever restored — the one decision here that must not be "cleaned up"
    // together with the picker entry. Raising either number without giving the
    // model a quota is the mistake this has always existed to stop.
    expect(DIRECTIONER_OX_ALPHA_MAX_PRICE.prompt).toBe(0)
    expect(DIRECTIONER_OX_ALPHA_MAX_PRICE.completion).toBe(0)
  })

  it('still matches dated builds, so a variant cannot escape the pause', () => {
    // The predicate now guards two things at once: the price fence on the
    // OpenRouter lane, and — via directionerModelIdMatches inside
    // isDirectionerPausedFreeModelId — the withdrawal itself. A dated variant that
    // slipped past would be the same model with both gates off.
    expect(isDirectionerOxAlphaModelId(OX)).toBe(true)
    expect(isDirectionerOxAlphaModelId('stealth/ox-alpha-20260820')).toBe(true)
    expect(isDirectionerOxAlphaModelId('stealth/ox-beta')).toBe(false)
    expect(isDirectionerOxAlphaModelId(null)).toBe(false)
    expect(isDirectionerPausedFreeModelId('stealth/ox-alpha-20260820')).toBe(true)
  })

  it('keeps its context window and its data disclosure', () => {
    // Both belong to the row rather than to the offer. They cost nothing while
    // it is paused and are exactly what a restore would otherwise have to
    // rediscover: the window stops base-chat budgeting a 1M model at 131,072,
    // and the warning is the one row in the catalog where a disclosure does NOT
    // imply `dataUse: 'training'` — the host retains prompts and does not train
    // on them, so the warning is owed and the training label is not.
    expect(HOSTED_MODEL_CONTEXT_WINDOWS[OX]).toBe(1_000_000)
    expect(row?.warning).toBe('Anonymous provider retains prompts')
    expect(row?.dataUse).toBe('service')
    expect(DIRECTIONER_TRACED_MODEL_IDS as readonly string[]).not.toContain(OX)
  })

  it('no longer claims to be NEW', () => {
    // The row renders nowhere today, so this is about what a restore would
    // ship: a NEW badge on a model withdrawn by its host is the one claim about
    // it that is actively false. `experimental` stays — that badge was the
    // warning, and it turned out to be the right one.
    // Read through the shared option type rather than off the `as const` row:
    // dropping the field narrows the literal type until `row.isNew` is a
    // compile error, which proves the point but cannot be asserted.
    expect((row as DirectionerModelOption | undefined)?.isNew).toBeUndefined()
    expect(row?.experimental).toBe(true)
  })
})
