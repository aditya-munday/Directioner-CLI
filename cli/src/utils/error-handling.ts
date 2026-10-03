import {
  BEYONDERS_OWN_CREDITS_ERROR_PATTERN,
  DIRECTIONER_PROVIDER_USAGE_ERROR_PATTERN,
  DIRECTIONER_TURN_SPEND_LIMIT_ERROR_CODE,
  DIRECTIONER_TURN_SPEND_LIMIT_MESSAGE,
} from '@beyonders/common/constants/directioner-errors'
import { env } from '@beyonders/common/env'
import { extractApiErrorDetails } from '@beyonders/common/util/error'
import { formatDirectionerHardBlockedPrivacySignals } from '@beyonders/common/util/directioner-privacy'
import { getDirectionerGateCode } from '@beyonders/common/types/directioner-session'

import type { ChatMessage } from '../types/chat'
import type {
  DirectionerCountryBlockReason,
  DirectionerGateCode,
  DirectionerIpPrivacySignal,
} from '@beyonders/common/types/directioner-session'

import { IS_HOSTED } from './constants'

const defaultAppUrl = env.NEXT_PUBLIC_BEYONDERS_APP_URL || 'https://beyonders.com'

// Normalize unknown errors to a user-facing string.
const extractErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error === 'string') {
    return error
  }
  if (error instanceof Error && error.message) {
    return error.message + (error.stack ? `\n\n${error.stack}` : '')
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const candidate = (error as { message: unknown }).message
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate
    }
  }
  return fallback
}

/**
 * Check if an error indicates the user is out of credits.
 * Standardized on statusCode === 402 for payment required detection.
 */
export const isOutOfCreditsError = (error: unknown): boolean => {
  if (
    error &&
    typeof error === 'object' &&
    'statusCode' in error &&
    (error as { statusCode: unknown }).statusCode === 402
  ) {
    return true
  }
  return false
}

/**
 * Check if an error indicates free mode is not available in the user's country.
 * Standardized on statusCode === 403 + error === 'free_mode_unavailable'.
 */
export const isFreeModeUnavailableError = (error: unknown): boolean => {
  const details = getCliApiErrorDetails(error)
  return (
    details.statusCode === 403 &&
    details.errorCode === 'free_mode_unavailable'
  )
}

const getTopLevelApiErrorDetails = (
  error: unknown,
): {
  statusCode?: number
  errorCode?: string
  message?: string
  countryCode?: string
  countryBlockReason?: string
  ipPrivacySignals?: string[]
} => {
  if (!error || typeof error !== 'object') return {}
  const statusCode = (error as { statusCode?: unknown }).statusCode
  const status = (error as { status?: unknown }).status
  const errorCode = (error as { error?: unknown }).error
  const message = (error as { message?: unknown }).message
  const countryCode = (error as { countryCode?: unknown }).countryCode
  const countryBlockReason = (error as { countryBlockReason?: unknown })
    .countryBlockReason
  const ipPrivacySignals = (error as { ipPrivacySignals?: unknown })
    .ipPrivacySignals
  const resolvedStatusCode =
    typeof statusCode === 'number'
      ? statusCode
      : typeof status === 'number'
        ? status
        : undefined

  return {
    ...(resolvedStatusCode !== undefined && { statusCode: resolvedStatusCode }),
    ...(typeof errorCode === 'string' && { errorCode }),
    ...(typeof message === 'string' && message.length > 0 && { message }),
    ...(typeof countryCode === 'string' &&
      countryCode.length > 0 && { countryCode }),
    ...(typeof countryBlockReason === 'string' && { countryBlockReason }),
    ...(Array.isArray(ipPrivacySignals) && {
      ipPrivacySignals: ipPrivacySignals.filter(
        (signal): signal is string => typeof signal === 'string',
      ),
    }),
  }
}

const getCliApiErrorDetails = (error: unknown) => {
  const parsed = extractApiErrorDetails(error)
  const topLevel = getTopLevelApiErrorDetails(error)

  return {
    statusCode: topLevel.statusCode ?? parsed.statusCode,
    errorCode: topLevel.errorCode ?? parsed.errorCode,
    // Prefer responseBody messages over top-level HTTP status text.
    message: parsed.message ?? topLevel.message,
    countryCode: topLevel.countryCode ?? parsed.countryCode,
    countryBlockReason:
      topLevel.countryBlockReason ?? parsed.countryBlockReason,
    ipPrivacySignals: topLevel.ipPrivacySignals ?? parsed.ipPrivacySignals,
  }
}

export const getDirectionerRateLimitErrorMessage = (
  error: unknown,
): string | null => {
  const details = getCliApiErrorDetails(error)
  if (details.statusCode !== 429) return null
  if (details.errorCode === 'free_mode_rate_limited') {
    // Our own rate limiter's message is already user-facing and includes the
    // retry countdown — show it verbatim.
    return details.message ?? DIRECTIONER_RATE_LIMIT_MESSAGE
  }
  if (details.errorCode === DIRECTIONER_TURN_SPEND_LIMIT_ERROR_CODE) {
    // The per-turn spend breaker. Its copy already says what happened and
    // what to do (send a new message); a rate-limit framing would be wrong.
    return details.message ?? DIRECTIONER_TURN_SPEND_LIMIT_MESSAGE
  }
  // Other 429s (e.g. relayed upstream capacity errors) keep the branded
  // message but include the server detail so users aren't left guessing.
  // Only trust messages parsed from a server response body, or the curated
  // message on an agent-run output object — top-level messages on raw thrown
  // errors are HTTP status text or retry-wrapper noise.
  const isRunOutputObject =
    !!error &&
    typeof error === 'object' &&
    (error as { type?: unknown }).type === 'error'
  const detail =
    extractApiErrorDetails(error).message ??
    (isRunOutputObject ? details.message : undefined)
  if (detail && !/^too many requests\.?$/i.test(detail)) {
    return `${DIRECTIONER_RATE_LIMIT_MESSAGE} (${detail})`
  }
  return DIRECTIONER_RATE_LIMIT_MESSAGE
}

/**
 * Provider billing failures are an operator problem in Directioner, not a reason
 * to send a free user to Beyonders's credit-purchase flow. Upstreams disagree
 * on the status (observed as both 401 and 402), so retain the status check but
 * also recognize the provider wording that can survive into an agent output.
 */
export const isDirectionerProviderUsageError = (error: unknown): boolean => {
  const details = getCliApiErrorDetails(error)
  const message = details.message ?? extractErrorMessage(error, '')
  // The user's own Beyonders balance, not our provider: leave it to the
  // out-of-credits flow.
  if (BEYONDERS_OWN_CREDITS_ERROR_PATTERN.test(message)) return false
  return (
    details.statusCode === 402 ||
    DIRECTIONER_PROVIDER_USAGE_ERROR_PATTERN.test(message)
  )
}

export const getCountryBlockFromFreeModeError = (
  error: unknown,
): {
  countryCode: string
  countryBlockReason?: DirectionerCountryBlockReason
  ipPrivacySignals?: DirectionerIpPrivacySignal[]
} | null => {
  if (!isFreeModeUnavailableError(error)) return null
  const errorDetails = getCliApiErrorDetails(error)
  const countryCode =
    typeof errorDetails.countryCode === 'string' &&
    errorDetails.countryCode.length > 0
      ? errorDetails.countryCode
      : 'UNKNOWN'

  return {
    countryCode,
    countryBlockReason:
      typeof errorDetails.countryBlockReason === 'string'
        ? (errorDetails.countryBlockReason as DirectionerCountryBlockReason)
        : undefined,
    ipPrivacySignals: errorDetails.ipPrivacySignals as
      | DirectionerIpPrivacySignal[]
      | undefined,
  }
}

export const getFreeModeUnavailableErrorMessage = (
  error: unknown,
): string => {
  const details = getCliApiErrorDetails(error)
  const block = getCountryBlockFromFreeModeError(error)
  if (block?.countryBlockReason === 'anonymous_network') {
    return `${IS_HOSTED ? 'Directioner' : 'Free mode'} cannot be used from ${formatDirectionerHardBlockedPrivacySignals(
      block.ipPrivacySignals,
    )} traffic. Please disable it and try again.`
  }
  return details.message ?? FREE_MODE_UNAVAILABLE_MESSAGE
}

/**
 * The subset of the session gate the CLI has a recovery for. The codes and
 * their statuses come from DIRECTIONER_GATE_CODES (the shared wire contract, see
 * docs/directioner-session-admission.md); the narrowing is deliberate —
 * `session_limit_reached` is the Desktop concurrent-tab cap, and the CLI runs
 * one session per user, so it can never earn it and has no banner for it.
 *
 * The names keep their legacy waiting-room spelling for wire compatibility.
 */
export type DirectionerGateErrorKind = Exclude<
  DirectionerGateCode,
  'session_limit_reached'
>

export const getDirectionerGateErrorKind = (
  error: unknown,
): DirectionerGateErrorKind | null => {
  if (!error || typeof error !== 'object') return null
  const { error: errorCode, statusCode } = error as {
    error?: unknown
    statusCode?: unknown
  }
  if (typeof errorCode !== 'string') return null
  const code = getDirectionerGateCode({
    error: errorCode,
    statusCode: typeof statusCode === 'number' ? statusCode : undefined,
  })
  return code && code !== 'session_limit_reached' ? code : null
}

export const OUT_OF_CREDITS_MESSAGE = `Out of credits. Please add credits at ${defaultAppUrl}/usage`

export const DIRECTIONER_RATE_LIMIT_MESSAGE =
  'Directioner is temporarily busy. Please try again in a moment.'

export const FREE_MODE_UNAVAILABLE_MESSAGE = IS_HOSTED
  ? 'Directioner is not available in your country.'
  : 'Free mode is not available in your country. You can use another mode to continue.'

export const createErrorMessage = (
  error: unknown,
  aiMessageId: string,
): Partial<ChatMessage> => {
  const message = extractErrorMessage(error, 'Unknown error occurred')

  return {
    id: aiMessageId,
    content: `**Error:** ${message}`,
    blocks: undefined,
    isComplete: true,
  }
}
