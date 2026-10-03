import React from 'react'
import { getFreebucksInfo } from '@beyonders/common/types/directioner-session'
import { getDirectionerModelMeter } from '@beyonders/common/util/directioner-session-pools'

import { useDirectionerSessionProgress } from '../hooks/use-directioner-session-progress'
import { useNow } from '../hooks/use-now'
import { useTheme } from '../hooks/use-theme'
import { formatDirectionerPremiumResetCountdown } from '../utils/directioner-premium-reset'
import { formatSessionUnits } from '../utils/format-session-units'

import type { DirectionerSessionResponse } from '../types/directioner-session'

interface DirectionerActiveSessionSummaryProps {
  session: DirectionerSessionResponse | null
}

export const DirectionerActiveSessionSummary: React.FC<
  DirectionerActiveSessionSummaryProps
> = ({ session }) => {
  const theme = useTheme()
  const now = useNow(60_000, session?.status === 'active')
  const progress = useDirectionerSessionProgress(session)
  if (session?.status !== 'active' || !progress) return null

  const { quota } = getDirectionerModelMeter({
    model: session.model,
    freebucks: getFreebucksInfo(session),
    quota: session.rateLimit,
  })

  if (!quota) {
    return null
  }

  const resetCountdown = formatDirectionerPremiumResetCountdown(
    new Date(quota.resetAt),
    now,
  )
  const label =
    'accessTier' in session && session.accessTier === 'limited'
      ? 'sessions'
      : 'premium sessions'
  // recentCount already includes the active session's 1.0-unit reservation
  // (written as an admit row at promotion), so it reflects everything counted
  // against the quota — spent plus in-flight. Show it as the total used to match
  // the model selection menu and the other session-status screens.
  return (
    <box
      style={{
        paddingLeft: 1,
        paddingRight: 1,
        marginBottom: 1,
        flexShrink: 0,
      }}
    >
      <text style={{ wrapMode: 'word', fg: theme.muted }}>
        <span fg={theme.foreground}>
          {formatSessionUnits(quota.recentCount)} of {quota.limit}
        </span>
        <span fg={theme.muted}>
          {' '}
          {label} used · resets in {resetCountdown}
        </span>
      </text>
    </box>
  )
}
