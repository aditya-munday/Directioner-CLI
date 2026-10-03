import {
  type DirectionerAccessTier,
  type DirectionerDesktopConcurrency,
} from './directioner-model-entitlements'
import {
  DIRECTIONER_GEMINI_38_FLASH_MODEL_ID,
  DIRECTIONER_GPT_5_6_LUNA_MODEL_ID,
  DIRECTIONER_GPT_6_LUNA_MODEL_ID,
  DIRECTIONER_MIMO_V26_PRO_MODEL_ID,
  DIRECTIONER_MUSE_SPARK_MODEL_IDS,
  directionerModelIdMatches,
} from './directioner-models'

/** Models that always use constrained Desktop concurrency. */
const DIRECTIONER_DESKTOP_SLOT_BOUND_MODEL_IDS = [
  // Every quota-metered Desktop model must stay slot-bound until admit stamps
  // identify the tab; same-millisecond parallel admits otherwise pair
  // ambiguously when usage is finalized.
  // GPT-6 Luna, 2026-09-22, in 5.6's slot: quota-metered, so slot-bound.
  DIRECTIONER_GPT_6_LUNA_MODEL_ID,
  DIRECTIONER_GEMINI_38_FLASH_MODEL_ID,
  // MiMo 2.6 Pro, the dearest row after Gemini and paid-only.
  DIRECTIONER_MIMO_V26_PRO_MODEL_ID,
  // Muse Spark, from the day it reached Desktop (2026-09-04). Metered like the
  // rows above it, so the same rule applies — and it earns the slot twice over:
  // its scarce resource is requests per minute against ceilings Meta meters per
  // TEAM and every Directioner user shares, so one tab per user is also one more
  // bound on how many concurrent turns sit inside them.
  ...DIRECTIONER_MUSE_SPARK_MODEL_IDS,
] as const

const DIRECTIONER_DESKTOP_CONCURRENCY_LIMITS = {
  free: { 'slot-bound': 1, 'multi-tab': 3 },
  subscriber: { 'slot-bound': 3, 'multi-tab': 8 },
} as const

export function directionerDesktopConcurrencyLimits(
  accessTier: DirectionerAccessTier | null | undefined,
  hasPaidPlan: boolean,
): Record<DirectionerDesktopConcurrency, number> {
  if (accessTier === 'limited' && !hasPaidPlan) {
    return { 'slot-bound': 1, 'multi-tab': 0 }
  }
  return hasPaidPlan
    ? DIRECTIONER_DESKTOP_CONCURRENCY_LIMITS.subscriber
    : DIRECTIONER_DESKTOP_CONCURRENCY_LIMITS.free
}

export function getDirectionerDesktopConcurrency(
  model: string,
  accessTier: DirectionerAccessTier | null | undefined,
  hasPaidPlan = false,
): DirectionerDesktopConcurrency {
  if (
    DIRECTIONER_DESKTOP_SLOT_BOUND_MODEL_IDS.some((modelId) =>
      directionerModelIdMatches(model, modelId),
    )
  ) {
    return 'slot-bound'
  }
  return accessTier === 'limited' && !hasPaidPlan ? 'slot-bound' : 'multi-tab'
}

export function occupiesDirectionerDesktopSlot(
  model: string,
  accessTier: DirectionerAccessTier | null | undefined,
  hasPaidPlan = false,
): boolean {
  return (
    getDirectionerDesktopConcurrency(model, accessTier, hasPaidPlan) ===
    'slot-bound'
  )
}

/** Idle time after which Desktop ends a hosted session and frees its slot. */
export const DIRECTIONER_DESKTOP_IDLE_RELEASE_MS = 15 * 60 * 1000

/** Pins an end/refund request to one window of a stable Desktop tab. */
export const DIRECTIONER_DESKTOP_ADMITTED_AT_HEADER =
  'x-directioner-desktop-admitted-at'

/**
 * Names the app making a session call. Directioner Desktop sends `desktop`:
 * current CLI builds share Desktop's multi-session header and table, so
 * nothing else on the wire tells the two apart.
 */
export const DIRECTIONER_CLIENT_HEADER = 'x-directioner-client'
export const DIRECTIONER_CLIENT_DESKTOP = 'desktop'

/** Client-persisted identity for a possibly unacknowledged Desktop POST. */
export const DIRECTIONER_DESKTOP_ATTEMPT_HEADER = 'x-directioner-desktop-attempt-id'

/** Renew this tab's live paid hour in place: charge its price again and
 *  restart its hour. The value is a client UUID that makes retries
 *  charge once. */
export const DIRECTIONER_SESSION_RENEWAL_HEADER = 'x-directioner-session-renewal-id'

/** Versioned opt-in: instance ids become single-use execution claims. */
export const DIRECTIONER_PURCHASE_CONTINUITY_HEADER =
  'x-directioner-purchase-continuity'

/** Every claim a 0.0.197+ CLI mints on the purchase protocol starts with this.
 *  The server reads it to tell the CLI's claims from Desktop tabs: only a CLI
 *  claim can be the successor of a legacy single-session CLI hour. */
export const DIRECTIONER_CLI_CLAIM_PREFIX = 'cli:'

export function isDirectionerCliClaim(
  instanceId: string | null | undefined,
): boolean {
  return !!instanceId?.startsWith(DIRECTIONER_CLI_CLAIM_PREFIX)
}
