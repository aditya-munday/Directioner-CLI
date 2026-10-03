/**
 * Directioner account standing ("Access Level") — the PRESENTATIONAL half.
 *
 * This file carries everything a client may see: the level names, their
 * user-facing labels and blurbs, and the wire shapes for standing info. The
 * actual limit matrix, thresholds and scorer live in
 * `./directioner-trust.ts`, which is deliberately EXCLUDED from the public-repo
 * export (see scripts/public-export-manifest.txt) — a published limit is a
 * published target, so the numbers must never ship in a public file. Keep
 * that split when adding here: names, labels and shapes only, never numbers.
 */

import type { DirectionerAccessTier } from './directioner-models'

/**
 * Ordered least- to most-established. The order is load-bearing:
 * `DIRECTIONER_TRUST_LEVELS.indexOf` is how "at least X" comparisons are done, so
 * inserting a level in the middle re-ranks every comparison in one edit rather
 * than requiring each call site to be found.
 */
export const DIRECTIONER_TRUST_LEVELS = [
  'new',
  'verified',
  'established',
  'core',
] as const

export type DirectionerTrustLevel = (typeof DIRECTIONER_TRUST_LEVELS)[number]

/** The level an account holds before anything is known about it. Every failure
 *  path in the resolver must land somewhere DEFINITE, and this is not it — see
 *  `DIRECTIONER_TRUST_FALLBACK_LEVEL`. */
export const DIRECTIONER_TRUST_MIN_LEVEL: DirectionerTrustLevel = 'new'

/**
 * The level used when signals cannot be loaded (database error, timeout).
 *
 * `established` and NOT `new`, and this is the single most consequential
 * constant in the file. This resolver runs on the free-mode hot path; if a
 * Postgres hiccup dropped every caller to `new`, one degraded dependency would
 * throttle the entire product to a fifth of its capacity, and it would look
 * exactly like an outage nobody could attribute. Failing to the level that
 * reproduces roughly today's flat limits means a broken resolver costs us the
 * enforcement, never the users. Same reasoning as the signup gate's fail-open.
 */
export const DIRECTIONER_TRUST_FALLBACK_LEVEL: DirectionerTrustLevel = 'established'

export function isAtLeastTrustLevel(
  level: DirectionerTrustLevel,
  minimum: DirectionerTrustLevel,
): boolean {
  return (
    DIRECTIONER_TRUST_LEVELS.indexOf(level) >=
    DIRECTIONER_TRUST_LEVELS.indexOf(minimum)
  )
}

/** User-facing name. Never says "trust", "risk" or "score" — a user reading
 *  their own level is reading an explanation of their limits, not a verdict on
 *  their character. */
export const DIRECTIONER_TRUST_LEVEL_LABELS: Record<DirectionerTrustLevel, string> = {
  new: 'Getting started',
  verified: 'Verified',
  established: 'Established',
  core: 'Core member',
}

/** One line of user-facing copy per level, shown under the label. */
export const DIRECTIONER_TRUST_LEVEL_BLURBS: Record<DirectionerTrustLevel, string> = {
  new: 'Welcome! Your account is brand new, so limits start small. They open up quickly — the steps below take a few minutes.',
  verified:
    'Your account is verified. You have solid daily limits, and a bit of history unlocks the next level.',
  established:
    'You are an established Directioner user with generous limits on messages, spend and premium sessions.',
  core: 'You are a core member. You get the highest free limits we offer, in every region.',
}

/** A signal that moved the score, in user-facing language. */
export interface DirectionerTrustFactor {
  id: string
  label: string
  points: number
}

/** Something the user can do to move up, with what it is worth. */
export interface DirectionerTrustNextStep {
  id: string
  label: string
  detail: string
  points: number
  /** Where the UI should send them. Relative to the directioner web app. */
  href?: string
}

export interface DirectionerStandingHighlight {
  label: string
  value: string
}

/**
 * NOTE FOR CALLERS: `highlights` is what the level WOULD grant, which is only
 * what the account actually gets once `DIRECTIONER_TRUST_LEVELS=enforce`. Both
 * producers gate on that (the Earn route and the session `standing` field), so
 * a client that receives this can render it as fact. A third producer must do
 * the same — see the comment in directioner/web/src/app/api/web/standing/route.ts
 * for what happens otherwise.
 */
export interface DirectionerStandingInfo {
  level: DirectionerTrustLevel
  label: string
  blurb: string
  score: number
  /** Score at which the next level starts, or null at `core`. */
  nextLevelAt: number | null
  nextLevel: DirectionerTrustLevel | null
  cappedBy: string | null
  cappedReason: string | null
  factors: DirectionerTrustFactor[]
  nextSteps: DirectionerTrustNextStep[]
  accessTier: DirectionerAccessTier
  /** Semantic, never numeric — see DirectionerStandingHighlight. */
  highlights: DirectionerStandingHighlight[]
}
