import {
  getDirectionerModel,
  DIRECTIONER_ENABLE_STREAK_IN_UI,
} from '@beyonders/common/constants/directioner-models'
import {
  getReferralInfo,
  getGlmPromo,
  getSubscriptionInfo,
  getFreeWindowsInfo,
} from '@beyonders/common/types/directioner-session'
import {
  directionerPlanSummary,
  directionerFreeWindowsSummary,
  formatPlanWindows,
} from '@beyonders/common/util/directioner-plan-summary'

import { DirectionerReferralBanner } from './directioner-referral-banner'
import {
  DIRECTIONER_WORDMARK,
  DIRECTIONER_WORDMARK_COMPACT,
} from '../utils/directioner-wordmark'
import { useTheme } from '../hooks/use-theme'
import { useTerminalDimensions } from '../hooks/use-terminal-dimensions'
import { useDirectionerStreakQuery } from '../hooks/use-directioner-streak-query'
import { useDirectionerModelStore } from '../state/directioner-model-store'
import {
  useDirectionerChatStore,
  selectDirectionerChatModel,
} from '../state/directioner-chat-store'
import { freebucksOf, formatFreebucks } from '../utils/freebucks'
import { getDirectionerStreakBonusNoteForLayout } from '../utils/directioner-streak-line'
import { getDirectionerModelAvailabilityNotice } from '@beyonders/common/util/directioner-model-availability'
import type { DirectionerSessionResponse } from '../types/directioner-session'

const ignoreFocusTargets = () => {}

const wordmarkVariants = [DIRECTIONER_WORDMARK, DIRECTIONER_WORDMARK_COMPACT].map(
  (text) => ({
    text,
    width: Math.max(...text.split('\n').map((line) => line.length)),
  }),
)

export function DirectionerChatHeader({
  session,
}: {
  projectRoot: string
  session: DirectionerSessionResponse | null
}) {
  const theme = useTheme()
  const { terminalWidth, terminalHeight } = useTerminalDimensions()
  const selected = useDirectionerModelStore((s) => s.selectedModel)
  const nextModel = useDirectionerChatStore((s) => s.nextModel)
  const model = getDirectionerModel(nextModel ?? selected)
  const freebucks = freebucksOf(session)
  const plan = directionerPlanSummary(getSubscriptionInfo(session))
  const windows = directionerFreeWindowsSummary(getFreeWindowsInfo(session))
  const streak = useDirectionerStreakQuery({
    enabled: DIRECTIONER_ENABLE_STREAK_IN_UI,
  })
  const width = Math.max(16, Math.min(68, terminalWidth - 5))
  // Use the panel's padded width budget so the wordmark stays whole on resize.
  const wordmark =
    wordmarkVariants.find((variant) => variant.width <= width)?.text ?? 'Directioner'
  const tier =
    session && 'accessTier' in session ? (session.accessTier ?? 'full') : 'full'
  const referral = getReferralInfo(session)
  const availability =
    freebucks === undefined
      ? getDirectionerModelAvailabilityNotice(
          session && 'countryBlockReason' in session ? session : null,
        )
      : ''
  const streakBonus = getDirectionerStreakBonusNoteForLayout({
    streak: streak.data?.streak ?? 0,
    accessTier: tier,
    freebucksDailyBonus: streak.data?.freebucksDailyBonus,
    terminalHeight,
    availableWidth: width - 4,
  })
  return (
    <box
      style={{
        flexDirection: 'column',
        alignItems: 'flex-start',
        width: '100%',
        marginBottom: 1,
      }}
    >
      <text style={{ fg: theme.foreground, wrapMode: 'none', marginBottom: 1 }}>
        {wordmark}
      </text>
      <box
        style={{
          width,
          border: true,
          borderColor: theme.border,
          paddingLeft: 1,
          paddingRight: 1,
          flexDirection: 'column',
        }}
      >
        {model.warning && (
          <text style={{ fg: theme.secondary, wrapMode: 'word' }}>
            {model.warning}
          </text>
        )}
        <text style={{ fg: theme.muted, wrapMode: 'word' }}>
          {session?.status === 'active'
            ? session.model === model.id
              ? 'Session active'
              : `Next message switches from ${getDirectionerModel(session.model).displayName}.`
            : 'Your first message starts the session.'}
        </text>
        {freebucks && (
          <text style={{ fg: theme.foreground, wrapMode: 'word' }}>
            {`${formatFreebucks(freebucks.daily.remaining)}/${formatFreebucks(freebucks.daily.limit)} Freebucks remaining`}
          </text>
        )}
        {freebucks === null && (
          <text style={{ fg: theme.secondary }}>Balance unavailable</text>
        )}
        {plan && (
          <text style={{ fg: theme.muted, wrapMode: 'word' }}>
            {freebucks === undefined
              ? `${plan.tierName} plan · ${formatPlanWindows(plan)}`
              : `${plan.tierName} plan`}
          </text>
        )}
        {freebucks === undefined && windows && (
          <text style={{ fg: theme.muted, wrapMode: 'word' }}>
            {windows.windows
              .map((w) => `${w.label} ${w.used} of ${w.limit}`)
              .join(' · ')}
          </text>
        )}
        {availability && (
          <text style={{ fg: theme.muted, wrapMode: 'word' }}>
            {availability}
          </text>
        )}
        {DIRECTIONER_ENABLE_STREAK_IN_UI && Boolean(streak.data?.streak) && (
          <text
            style={{ fg: theme.primary }}
          >{`${streak.data!.streak} day streak`}</text>
        )}
        {streakBonus && (
          <text style={{ fg: theme.muted, wrapMode: 'word' }}>
            {streakBonus}
          </text>
        )}
        {referral && (
          <DirectionerReferralBanner
            width={width - 4}
            referral={referral}
            glmPromo={getGlmPromo(session)}
            accessTier={tier}
            metered={freebucks !== undefined}
            focusedId=""
            onFocusTargetsChange={ignoreFocusTargets}
            onSelectModel={selectDirectionerChatModel}
          />
        )}
      </box>
    </box>
  )
}
