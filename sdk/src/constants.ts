import { env, IS_DEV, IS_TEST, IS_PROD } from '@beyonders/common/env'

import { getRuntimeAppUrlFromEnv } from './env'

export { IS_DEV, IS_TEST, IS_PROD }

export const BEYONDERS_BINARY = 'beyonders'

/** URL baked in at bundle time, if the build inlined one. */
const bundledWebsiteUrl = env.NEXT_PUBLIC_BEYONDERS_APP_URL

/**
 * Resolve the hosted-backend base URL, if one is configured at runtime.
 *
 * Returns `undefined` when nothing is configured. Directioner is BYOK-only and
 * has no hosted backend, so this is the expected case: callers must handle it
 * rather than fall back to a hardcoded vendor host.
 */
export function getWebsiteUrl(): string | undefined {
  return (getRuntimeAppUrlFromEnv() ?? bundledWebsiteUrl)?.replace(/\/$/, '')
}

/**
 * Resolve the hosted-backend base URL, throwing when none is configured.
 *
 * Directioner has no hosted backend. A code path that still reaches for one is
 * a bug, and — importantly — a silent fallback to a vendor host would be an
 * unapproved egress path. Throwing turns that into a loud, local failure
 * instead of a network call.
 */
export function requireWebsiteUrl(): string {
  const url = getWebsiteUrl()
  if (!url) {
    throw new Error(
      'This feature needs a hosted backend, and Directioner has none configured. It is not available in this build.',
    )
  }
  return url
}

/** @deprecated Prefer {@link getWebsiteUrl} for runtime resolution. */
export const WEBSITE_URL = bundledWebsiteUrl
