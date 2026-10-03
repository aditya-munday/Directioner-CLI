/** Compatibility notices, not spend enforcement.
 * Completions uses the capacity/restricted notices for live request-rate limits.
 * The local Freebucks stub and legacy refusal mapping retain the older copy.
 */
export const DIRECTIONER_CAPACITY_NOTICE =
  'Capacity is now limited per account — sustained automated abuse forced us to cap how much any one account can use.'

export const DIRECTIONER_RESTRICTED_NOTICE =
  'This account has reduced capacity: it was flagged for VPN or proxy usage, a restricted location, or an email domain commonly used by bot farms. If you are on a VPN, connecting directly restores normal limits. If you have moved, verify your country at directioner.com/account?tab=country.'

export const DIRECTIONER_FREEBUCKS_CEILING_NOTICE =
  'This account hit today’s hard usage cap. Freebucks pay for sessions, but the compute a day can draw is capped at three times what its Freebucks are worth, to protect the service from runaway usage.'

export const DIRECTIONER_BUDGET_NOTICE =
  'You have used all of today’s free usage on this account.'

const DIRECTIONER_RESTRICTED_NOTICE_REASONS: ReadonlySet<string> = new Set([
  'privacy_egress',
  'restricted_country',
  'flagged_email_domain',
  'unverified_egress',
])

const DIRECTIONER_BUDGET_NOTICE_REASONS: ReadonlySet<string> = new Set([
  'region',
  'elevated_country',
  'trust_level',
])

export function directionerSpendNoticeFor(reason: string): string {
  if (DIRECTIONER_RESTRICTED_NOTICE_REASONS.has(reason)) {
    return DIRECTIONER_RESTRICTED_NOTICE
  }
  if (DIRECTIONER_BUDGET_NOTICE_REASONS.has(reason)) return DIRECTIONER_BUDGET_NOTICE
  if (reason === 'freebucks_plan') return DIRECTIONER_FREEBUCKS_CEILING_NOTICE
  return DIRECTIONER_CAPACITY_NOTICE
}
