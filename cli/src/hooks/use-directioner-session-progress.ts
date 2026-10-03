import { useNow } from './use-now'
import { IS_HOSTED } from '../utils/constants'

import type { DirectionerSessionResponse } from '../types/directioner-session'

export interface DirectionerSessionProgress {
  /** 0..1, fraction of the session remaining. 1 at admission, 0 at expiry. */
  fraction: number
  remainingMs: number
}

/**
 * Computes a live progress value for the active directioner session, ticking at
 * 1Hz. Returns null outside of active state or in non-directioner builds, so
 * callers can short-circuit their rendering.
 */
export function useDirectionerSessionProgress(
  session: DirectionerSessionResponse | null,
): DirectionerSessionProgress | null {
  const expiresAtMs =
    session?.status === 'active' ? Date.parse(session.expiresAt) : null
  const admittedAtMs =
    session?.status === 'active' ? Date.parse(session.admittedAt) : null

  const nowMs = useNow(1000, expiresAtMs !== null)

  if (!IS_HOSTED || !expiresAtMs || !admittedAtMs) return null

  const totalMs = expiresAtMs - admittedAtMs
  if (totalMs <= 0) return null
  const remainingMs = Math.max(0, expiresAtMs - nowMs)
  const fraction = Math.max(0, Math.min(1, remainingMs / totalMs))
  return { fraction, remainingMs }
}
