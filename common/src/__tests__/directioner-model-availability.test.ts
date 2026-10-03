// The line the CLI landing picker and the Desktop model menu both show under a
// reduced model list. It is support-facing copy as much as product copy: users
// who cannot see a model others talk about write in asking whether their
// account is restricted, so what this says — and what it refuses to say — is
// the behaviour worth pinning.

import { describe, expect, test } from 'bun:test'

import {
  formatDirectionerPrivacySignalList,
  getDirectionerModelAvailabilityNotice,
} from '../util/directioner-model-availability'

describe('the availability notice', () => {
  test('names the country, so "why not Luna?" has a concrete answer', () => {
    expect(
      getDirectionerModelAvailabilityNotice({
        countryCode: 'BR',
        countryBlockReason: 'country_not_allowed',
      }),
    ).toBe("Some models aren't available in Brazil yet")
  })

  test('an unresolved country falls back to "your region" rather than printing UNKNOWN', () => {
    expect(
      getDirectionerModelAvailabilityNotice({
        countryCode: 'UNKNOWN',
        countryBlockReason: 'country_not_allowed',
      }),
    ).toBe("Some models aren't available in your region yet")
  })

  test('the VPN case leads with the action, because it is the one the user can take', () => {
    expect(
      getDirectionerModelAvailabilityNotice({
        countryCode: 'DE',
        countryBlockReason: 'anonymous_network',
        ipPrivacySignals: ['vpn'],
      }),
    ).toBe('Using a VPN? More models are available on a direct connection')
  })

  test('an inconclusive check reads as ours to explain, not as the user doing something wrong', () => {
    for (const reason of [
      'anonymized_or_unknown_country',
      'missing_client_ip',
      'unresolved_client_ip',
    ] as const) {
      expect(getDirectionerModelAvailabilityNotice({ countryBlockReason: reason })).toBe(
        "We couldn't confirm your region, so we're showing models available everywhere",
      )
    }
    expect(
      getDirectionerModelAvailabilityNotice({
        countryBlockReason: 'ip_privacy_lookup_failed',
      }),
    ).toBe("We couldn't finish a network check, so we're showing models available everywhere")
  })

  test('a missing reason still answers the question — the short list is on screen either way', () => {
    const generic = "Some models aren't available on this connection"
    expect(getDirectionerModelAvailabilityNotice(null)).toBe(generic)
    expect(getDirectionerModelAvailabilityNotice(undefined)).toBe(generic)
    expect(getDirectionerModelAvailabilityNotice({})).toBe(generic)
    expect(getDirectionerModelAvailabilityNotice({ countryCode: 'BR' })).toBe(generic)
  })

  // the reason this copy exists in one shared place: every branch is read by
  // someone comparing their picker to a friend's, and none of them should
  // describe the user's account as lesser
  test('no branch tells the user they are limited, blocked, or restricted', () => {
    const lines = [
      getDirectionerModelAvailabilityNotice(null),
      getDirectionerModelAvailabilityNotice({ countryBlockReason: 'country_not_allowed' }),
      getDirectionerModelAvailabilityNotice({
        countryBlockReason: 'anonymous_network',
        ipPrivacySignals: ['tor'],
      }),
      getDirectionerModelAvailabilityNotice({ countryBlockReason: 'missing_client_ip' }),
      getDirectionerModelAvailabilityNotice({ countryBlockReason: 'ip_privacy_lookup_failed' }),
    ]
    for (const line of lines) {
      expect(line.toLowerCase()).not.toMatch(/limited|blocked|restricted|denied|not allowed/)
    }
  })
})

describe('the privacy-signal list', () => {
  test('reads as prose, and never repeats a label two signals share', () => {
    expect(formatDirectionerPrivacySignalList(['vpn', 'tor'])).toBe('VPN or Tor')
    expect(formatDirectionerPrivacySignalList(['vpn', 'proxy', 'tor'])).toBe('VPN, proxy, or Tor')
    expect(formatDirectionerPrivacySignalList(['proxy', 'proxy'])).toBe('proxy')
  })

  test('an empty or unrecognized set names the whole family rather than nothing', () => {
    const family = 'VPN, Tor, proxy, relay, or anonymized network'
    expect(formatDirectionerPrivacySignalList([])).toBe(family)
    expect(formatDirectionerPrivacySignalList(null)).toBe(family)
    expect(formatDirectionerPrivacySignalList(undefined)).toBe(family)
  })
})
