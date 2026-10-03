import { FIRST_TAB_DISCOUNT_HEADER } from '@beyonders/common/util/directioner-first-tab-discount'
import type { DirectionerWalletSpendLimit } from '@beyonders/common/types/directioner-session'
import { freebucksTimeZoneHeaders } from '@beyonders/common/util/freebucks-timezone'
import { env } from '@beyonders/common/env'
import {
  DIRECTIONER_DESKTOP_ATTEMPT_HEADER,
  DIRECTIONER_PURCHASE_CONTINUITY_HEADER,
} from '@beyonders/common/constants/directioner-desktop-sessions'
import { directionerCliAttemptId } from './directioner-session-identity'
import {
  DIRECTIONER_COMPACT_SESSION_HEADER,
  DIRECTIONER_HEARTBEAT_HEADER,
  DIRECTIONER_INCLUDE_UNUSED_RATE_LIMITS_HEADER,
  DIRECTIONER_INSTANCE_HEADER,
  HOSTED_MODEL_HEADER,
  DIRECTIONER_MULTI_SESSION_HEADER,
  DIRECTIONER_TAKEOVER_INSTANCE_HEADER,
  DIRECTIONER_WALLET_SPEND_LIMIT_HEADER,
  DIRECTIONER_SESSION_ADMISSION_PATH,
  DIRECTIONER_SESSION_UNSUPPORTED_MESSAGE,
} from '@beyonders/common/constants/directioner-models'

import type { DirectionerSessionResponse } from '../types/directioner-session'
import type { DirectionerSessionServerResponse } from '@beyonders/common/types/directioner-session'

const SESSION_FETCH_TIMEOUT_MS = 20_000
export type DirectionerSessionMethod = 'POST' | 'GET' | 'DELETE'

export class DirectionerSessionRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly retryAfterMs?: number,
    readonly errorCode?: string,
  ) {
    super(message)
    this.name = 'DirectionerSessionRequestError'
  }
}

export function isDirectionerSessionTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' || /timeout|timed out/i.test(error.message))
  )
}

export type DirectionerSessionFailureDisposition = 'retry' | 'stop' | 'unknown'

/** How the poll loop should handle a failed request.
 *
 * A POST without a response may already have rotated the active instance, so
 * repeating it is unsafe without protocol-level idempotency. HTTP 408, 429,
 * and 503 responses are the exception: edge rejection or admission shedding
 * produces them before the session mutation can commit. GET is read-only and
 * can retry transient failures normally. */
export function classifyDirectionerSessionRequestFailure(
  method: Extract<DirectionerSessionMethod, 'POST' | 'GET'>,
  error: unknown,
): DirectionerSessionFailureDisposition {
  if (method === 'POST') {
    if (!(error instanceof DirectionerSessionRequestError)) return 'unknown'
    // These responses are produced before the session mutation can commit:
    // 408/429 come from an edge or unparsed response (the endpoint's typed
    // rate-limit responses are returned above), and a 503 means no handler was
    // available or admission shed the request. Retrying them cannot repeat a
    // successful takeover.
    if ([408, 429, 503].includes(error.statusCode)) {
      return 'retry'
    }
    return error.statusCode >= 400 && error.statusCode < 500
      ? 'stop'
      : 'unknown'
  }

  if (!(error instanceof DirectionerSessionRequestError)) return 'retry'
  return error.statusCode === 408 ||
    error.statusCode === 429 ||
    error.statusCode >= 500
    ? 'retry'
    : 'stop'
}

export function parseRetryAfterMs(
  value: string | null,
  nowMs = Date.now(),
): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) {
    const milliseconds = seconds * 1_000
    return Number.isFinite(milliseconds) ? Math.ceil(milliseconds) : undefined
  }
  const dateMs = Date.parse(value)
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - nowMs) : undefined
}

/** Combine the caller's abort signal with a per-request timeout. */
export function sessionFetchSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number = SESSION_FETCH_TIMEOUT_MS,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

function sessionBaseUrl(): string {
  return (env.NEXT_PUBLIC_BEYONDERS_APP_URL || 'https://beyonders.com').replace(
    /\/$/,
    '',
  )
}

function sessionEndpoint(method: DirectionerSessionMethod): string {
  return `${sessionBaseUrl()}${method === 'POST' ? DIRECTIONER_SESSION_ADMISSION_PATH : '/api/v1/directioner/session'}`
}

/** The host the session API is reached on, for copy that names it. */
export function directionerSessionHost(): string {
  try {
    return new URL(sessionBaseUrl()).host
  } catch {
    return sessionBaseUrl()
  }
}

/**
 * A network-layer failure: nothing came back, as opposed to a response we did
 * not like. Bun's `fetch` surfaces these as `fetch failed`, a TimeoutError, or
 * a bare socket code.
 */
export function isDirectionerSessionNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (isDirectionerSessionTimeoutError(error)) return true
  return /fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN|network/i.test(
    `${error.message} ${(error.cause as Error | undefined)?.message ?? ''}`,
  )
}

/**
 * What the landing screen shows for a session request that never got an
 * answer.
 *
 * Until 2026-09-19 it printed the runtime's error verbatim, so a user whose
 * ISP could not route to this host — while every browser on the machine
 * reached directioner.com, which sits on a different address — read
 * `The operation timed out.` and reinstalled. Four PLDT (Philippines) users
 * reported exactly that in two days; switching ISP fixed each one. Name the
 * host we could not reach and the two things that actually help, and never
 * blame the machine: the server was serving everyone else at the time.
 */
export function directionerSessionUnreachableMessage(host: string): string {
  return (
    `Couldn't get a response from ${host}. If your browser can open ` +
    `directioner.com, this network isn't routing to that host: try mobile data ` +
    `or another ISP, or use directioner.com/web meanwhile.`
  )
}

export async function callDirectionerSession(
  method: DirectionerSessionMethod,
  token: string,
  opts: {
    instanceId?: string
    multiSession?: boolean
    takeoverInstanceId?: string
    model?: string
    walletSpendLimit?: DirectionerWalletSpendLimit
    firstTabDiscount?: boolean
    signal?: AbortSignal
    compact?: boolean
  } = {},
): Promise<DirectionerSessionServerResponse> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...freebucksTimeZoneHeaders(),
    [FIRST_TAB_DISCOUNT_HEADER]: opts.firstTabDiscount ? '1' : '0',
  }
  const attemptId = directionerCliAttemptId(opts.instanceId)
  const multiSession = opts.multiSession ?? Boolean(attemptId)
  if (multiSession) {
    headers[DIRECTIONER_MULTI_SESSION_HEADER] = '1'
    headers[DIRECTIONER_PURCHASE_CONTINUITY_HEADER] = '1'
    if (attemptId && method !== 'GET') {
      headers[DIRECTIONER_DESKTOP_ATTEMPT_HEADER] = attemptId
    }
    if (method === 'GET' && opts.instanceId) {
      headers[DIRECTIONER_HEARTBEAT_HEADER] = '1'
      // A bare heartbeat omits balances and quotas. Rich refreshes (including
      // expiry and identity changes) must explicitly ask for that snapshot.
      if (!opts.compact)
        headers[DIRECTIONER_INCLUDE_UNUSED_RATE_LIMITS_HEADER] = '1'
    }
  }
  if ((multiSession || method !== 'POST') && opts.instanceId) {
    headers[DIRECTIONER_INSTANCE_HEADER] = opts.instanceId
  }
  if (method === 'GET' && opts.compact) {
    headers[DIRECTIONER_COMPACT_SESSION_HEADER] = '1'
  }
  if (method === 'POST') {
    if (opts.takeoverInstanceId)
      headers[DIRECTIONER_TAKEOVER_INSTANCE_HEADER] = opts.takeoverInstanceId
    if (opts.model) headers[HOSTED_MODEL_HEADER] = opts.model
    headers[DIRECTIONER_WALLET_SPEND_LIMIT_HEADER] = String(
      opts.walletSpendLimit ?? 0,
    )
  }

  const endpoint =
    method === 'DELETE' && attemptId
      ? `${sessionEndpoint(method)}/attempt`
      : sessionEndpoint(method)
  const response = await fetch(endpoint, {
    method,
    headers,
    signal: sessionFetchSignal(opts.signal),
  })

  if (method === 'POST' && [404, 405].includes(response.status)) {
    throw new DirectionerSessionRequestError(
      DIRECTIONER_SESSION_UNSUPPORTED_MESSAGE,
      response.status,
      undefined,
      'session_admission_unsupported',
    )
  }
  if (response.status === 404) {
    return { status: 'none' }
  }

  if (response.status === 403) {
    const body = (await response
      .json()
      .catch(() => null)) as DirectionerSessionServerResponse | null
    if (
      body &&
      (body.status === 'country_blocked' || body.status === 'banned')
    ) {
      return body
    }
  }

  if (response.status === 409 && method === 'POST') {
    const body = (await response
      .clone()
      .json()
      .catch(() => null)) as DirectionerSessionServerResponse | null
    if (
      body &&
      (body.status === 'model_locked' ||
        body.status === 'model_unavailable' ||
        body.status === 'premium_slot_taken' ||
        body.status === 'purchase_claim_released' ||
        body.status === 'purchase_in_use' ||
        body.status === 'purchase_capacity' ||
        body.status === 'first_tab_discount_changed' ||
        body.status === 'consent_required')
    ) {
      return body
    }
  }

  if (response.status === 429 && method === 'POST') {
    const body = (await response
      .json()
      .catch(() => null)) as DirectionerSessionServerResponse | null
    if (
      body &&
      (body.status === 'rate_limited' ||
        body.status === 'spend_limited' ||
        body.status === 'ip_capped')
    ) {
      return body
    }
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    let errorCode: string | undefined
    try {
      const body = JSON.parse(text) as { error?: unknown }
      if (typeof body.error === 'string') errorCode = body.error
    } catch {
      // Non-JSON errors have no machine-readable code.
    }
    throw new DirectionerSessionRequestError(
      `directioner session ${method} failed: ${response.status} ${text.slice(0, 200)}`,
      response.status,
      parseRetryAfterMs(response.headers.get('retry-after')),
      errorCode,
    )
  }

  return (await response.json()) as DirectionerSessionServerResponse
}

/** A compact poll omits quota fields that were already returned by admission.
 * Keep that snapshot only for the same active session; null tells the poller
 * to fetch one full response before compacting again. */
export function mergeCompactActiveSession(
  current: DirectionerSessionResponse | null,
  next: DirectionerSessionServerResponse,
): DirectionerSessionServerResponse | null {
  if (
    current?.status !== 'active' ||
    next.status !== 'active' ||
    current.instanceId !== next.instanceId ||
    current.model !== next.model
  ) {
    return null
  }
  return {
    ...next,
    rateLimit: next.rateLimit ?? current.rateLimit,
    rateLimitsByModel: next.rateLimitsByModel ?? current.rateLimitsByModel,
    // Compact polls omit the subscription block along with the rate limits;
    // dropping it here would blank the plan panel until the next full poll.
    subscription: next.subscription ?? current.subscription,
    // Same carry, and it matters MORE here: the Freebucks header is the whole
    // meter for a metered account, so losing it mid-session would drop the
    // picker back to session rings that no longer gate anything. The balance
    // is refreshed on a full poll/admission. Other instances can spend from
    // it meanwhile; admission rechecks both the balance and wallet consent.
    freebucks:
      next.freebucks !== undefined ? next.freebucks : current.freebucks,
  }
}

export function holdsLiveDirectionerSlot(
  current: DirectionerSessionResponse | null,
): boolean {
  if (!current) return false
  return (
    current.status === 'active' ||
    (current.status === 'ended' && Boolean(current.instanceId))
  )
}
