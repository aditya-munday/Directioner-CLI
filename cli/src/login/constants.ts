import { DIRECTIONER_WEB_URL_PROD } from '@beyonders/common/constants/hosts'
import { env, IS_DEV } from '@beyonders/common/env'

import { IS_DIRECTIONER, IS_HOSTED } from '../utils/constants'
import { DIRECTIONER_WORDMARK, DIRECTIONER_WORDMARK_COMPACT } from '../utils/directioner-wordmark'

// Get the website URL from environment or use default
export const WEBSITE_URL = env.NEXT_PUBLIC_BEYONDERS_APP_URL

/**
 * The directioner web app, which is where the login flow goes instead of
 * beyonders.com -- and, since COD-376, where the sponsored-proposal REST front
 * lives too.
 *
 * EXPORTED so that second caller resolves the host the same way. It read
 * `process.env.NEXT_PUBLIC_DIRECTIONER_APP_URL` directly, which skips both halves
 * of what this constant does: the `@beyonders/common/env` schema (so a typo or
 * an unset variable falls back silently rather than being caught at import),
 * and the `IS_DEV` branch (so a developer's proposal calls left the laptop and
 * hit production while every other CLI call stayed local).
 */
export const DIRECTIONER_WEB_URL = IS_DEV
  ? 'http://localhost:3002'
  : (env.NEXT_PUBLIC_DIRECTIONER_APP_URL ?? DIRECTIONER_WEB_URL_PROD)
/**
 * Base URL for the account/login flow.
 *
 * Directioner has no accounts and no hosted backend. Returning the empty
 * string would silently resolve to a relative URL, so the type is widened to
 * string-or-undefined and callers that need a real host fail loudly instead.
 */
export const LOGIN_WEBSITE_URL: string | undefined = IS_DIRECTIONER
  ? undefined
  : IS_HOSTED
    ? DIRECTIONER_WEB_URL
    : WEBSITE_URL

/**
 * Resolve the login base URL, or throw if this build has no login service.
 *
 * Prefer this over reading LOGIN_WEBSITE_URL directly: an undefined value
 * interpolated into a request URL becomes the literal string "undefined",
 * which surfaces as a confusing network error rather than a clear one.
 */
export function requireLoginWebsiteUrl(): string {
  if (!LOGIN_WEBSITE_URL) {
    throw new Error(
      'This build has no login service. Directioner runs against your own model provider and has no hosted account.',
    )
  }
  return LOGIN_WEBSITE_URL
}

// Directioner is the only brand this login screen renders. The vendor
// wordmark that used to sit behind the non-hosted branch spelled the upstream
// product name in ANSI-shadow glyphs, so every dev/pro build shipped the old
// brand; both variants now render the Directioner wordmark instead.
export const LOGO = DIRECTIONER_WORDMARK
export const LOGO_SMALL = DIRECTIONER_WORDMARK_COMPACT

// Shadow/border characters that receive the sheen animation effect
export const SHADOW_CHARS = new Set([
  '╚',
  '═',
  '╝',
  '║',
  '╔',
  '╗',
  '╠',
  '╣',
  '╦',
  '╩',
  '╬',
])

// Modal sizing constants
export const DEFAULT_TERMINAL_HEIGHT = 24
export const MODAL_VERTICAL_MARGIN = 2 // Space for top positioning (1) + bottom margin (1)
export const MAX_MODAL_BASE_HEIGHT = 22 // Maximum height when no warning banner
export const WARNING_BANNER_HEIGHT = 3 // Height of invalid credentials banner (padding + text + padding)

// Sheen animation constants
export const SHEEN_WIDTH = 5
export const SHEEN_STEP = 2 // Advance 2 positions per frame for efficiency
export const SHEEN_INTERVAL_MS = 150
