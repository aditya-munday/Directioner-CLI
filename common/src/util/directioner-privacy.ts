import type { DirectionerIpPrivacySignal } from '../types/directioner-session'

export const DIRECTIONER_HARD_BLOCKED_PRIVACY_SIGNALS = [
  'vpn',
  'proxy',
  'tor',
  'res_proxy',
] as const satisfies readonly DirectionerIpPrivacySignal[]

type DirectionerHardBlockedPrivacySignal =
  (typeof DIRECTIONER_HARD_BLOCKED_PRIVACY_SIGNALS)[number]

const DIRECTIONER_HARD_BLOCKED_PRIVACY_SIGNAL_SET =
  new Set<DirectionerIpPrivacySignal>(DIRECTIONER_HARD_BLOCKED_PRIVACY_SIGNALS)

const DIRECTIONER_HARD_BLOCKED_PRIVACY_SIGNAL_LABELS: Record<
  DirectionerHardBlockedPrivacySignal,
  string
> = {
  vpn: 'VPN',
  proxy: 'proxy',
  res_proxy: 'proxy',
  tor: 'Tor',
}

export function isDirectionerHardBlockedPrivacySignal(
  signal: DirectionerIpPrivacySignal,
): signal is DirectionerHardBlockedPrivacySignal {
  return DIRECTIONER_HARD_BLOCKED_PRIVACY_SIGNAL_SET.has(signal)
}

/**
 * ipinfo's `as.type` classifies the owning ASN as one of: ISP, Hosting,
 * Education, Government or Business (see ipinfo's "IPinfo Plus" sample DB).
 * Only `hosting` is a meaningful abuse signal — that's where VPN/proxy exits
 * and bot infrastructure live. The other classes are ordinary networks real
 * users sit behind, so we treat them as benign even when other heuristics
 * (e.g. ipinfo's `is_hosting` flag) would otherwise fire.
 */
const DIRECTIONER_BENIGN_AS_TYPES = new Set([
  'isp',
  'business',
  'education',
  'government',
])

export function isDirectionerBenignAsType(
  asType: string | null | undefined,
): boolean {
  return asType != null && DIRECTIONER_BENIGN_AS_TYPES.has(asType.toLowerCase())
}

export function isDirectionerHostingAsType(
  asType: string | null | undefined,
): boolean {
  return typeof asType === 'string' && asType.toLowerCase() === 'hosting'
}

export function formatDirectionerHardBlockedPrivacySignals(
  signals: readonly DirectionerIpPrivacySignal[] | null | undefined,
): string {
  const labels = Array.from(
    new Set(
      (signals ?? []).flatMap((signal): string[] => {
        if (!isDirectionerHardBlockedPrivacySignal(signal)) return []
        return [DIRECTIONER_HARD_BLOCKED_PRIVACY_SIGNAL_LABELS[signal]]
      }),
    ),
  )

  if (labels.length === 0) return 'VPN, proxy, or Tor'
  if (labels.length === 1) return labels[0]
  return `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`
}

export function formatDirectionerHardBlockedMessage(
  signals: readonly DirectionerIpPrivacySignal[] | null | undefined,
): string {
  return `Directioner cannot be used from ${formatDirectionerHardBlockedPrivacySignals(
    signals,
  )} traffic. Please disable it and try again.`
}
