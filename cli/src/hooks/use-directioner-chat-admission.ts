import { useEffect, useRef } from 'react'
import { formatDirectionerHardBlockedPrivacySignals } from '@beyonders/common/util/directioner-privacy'
import { getDirectionerModel } from '@beyonders/common/constants/directioner-models'

import {
  resolveDirectionerModelPickForSession,
  refreshDirectionerSessionMetadata,
  startDirectionerSession,
} from './use-directioner-session'
import {
  useDirectionerChatStore,
  type ChatAdmission,
} from '../state/directioner-chat-store'
import { useDirectionerSessionStore } from '../state/directioner-session-store'
import {
  freebucksOf,
  freebucksRowIntent,
  freebucksPriceLabel,
  formatFreebucks,
} from '../utils/freebucks'
import type { DirectionerSessionResponse } from '../types/directioner-session'

export function directionerAdmissionNotice(
  session: DirectionerSessionResponse | null,
): string | null {
  if (!session) return null
  switch (session.status) {
    case 'banned':
      return 'This account is suspended. If this is a mistake, contact support@beyonders.com.'
    case 'country_blocked':
      return session.countryBlockReason === 'anonymous_network'
        ? `Directioner detected ${formatDirectionerHardBlockedPrivacySignals(session.ipPrivacySignals)} traffic. Disable VPN, proxy or Tor traffic and try again.`
        : session.countryCode === 'UNKNOWN'
          ? 'Directioner could not verify your location. Check your VPN or proxy settings and try again.'
          : `Directioner is unavailable in ${session.countryCode}. Use /byok to use your own API key.`
    case 'rate_limited':
      return session.freebucksShortfall
        ? `Not enough Freebucks: ${formatFreebucks(session.freebucksShortfall.balance)} available. See https://directioner.com/plans or use /model.`
        : 'Session limit reached. See https://directioner.com/plans or choose another model with /model.'
    case 'spend_limited':
      return session.message
    case 'ip_capped':
      return 'Too many Directioner sessions on this network. Try again after another session finishes.'
    case 'superseded':
      return 'This session was taken over elsewhere. Send again to start a new session.'
    default:
      return null
  }
}

/** Identity-check every continuation: a cancelled send must never restart itself. */
export async function beginDirectionerChatAdmission(admission: ChatAdmission) {
  if (useDirectionerChatStore.getState().admission !== admission) return
  if (admission.phase === 'confirm') {
    const intentFor = (session: DirectionerSessionResponse | null | undefined) =>
      freebucksRowIntent(
        freebucksOf(session),
        admission.model,
        session?.status === 'active' ? session.model : undefined,
      )
    // A price/balance change must update the question before its answer can
    // authorize spending. The server still enforces the bounded wallet grant.
    if (
      JSON.stringify(intentFor(admission.previousSession)) !==
      JSON.stringify(intentFor(useDirectionerSessionStore.getState().session))
    ) {
      useDirectionerChatStore.setState({
        admission: { phase: 'requested', model: admission.model },
      })
      return
    }
  }
  const starting: ChatAdmission = {
    ...admission,
    phase: 'starting',
    message: undefined,
    previousSession: useDirectionerSessionStore.getState().session,
  }
  useDirectionerSessionStore.getState().setFailure(null)
  useDirectionerChatStore.setState({ admission: starting })
  try {
    await startDirectionerSession(starting.model, starting.walletSpendLimit, {
      preserveQueue: true,
      persistSelection: false,
    })
  } catch (error) {
    if (useDirectionerChatStore.getState().admission !== starting) return
    useDirectionerChatStore.setState({
      admission: {
        ...starting,
        phase: 'failed',
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

/** The queue holds the submitted text and attachments while admission runs. */
export function useDirectionerChatAdmission(enabled: boolean) {
  const checking = useRef<ChatAdmission | null>(null)
  const admission = useDirectionerChatStore((s) => s.admission)
  const session = useDirectionerSessionStore((s) => s.session)
  const failure = useDirectionerSessionStore((s) => s.failure)

  useEffect(() => {
    if (!enabled || !admission) return
    if (admission.phase === 'starting') {
      if (failure && !failure.retry) {
        useDirectionerChatStore.setState({
          admission: {
            ...admission,
            phase: 'failed',
            message: failure.message,
          },
        })
      } else if (session === admission.previousSession) {
        return
      } else if (session?.status === 'active') {
        useDirectionerChatStore.setState({ admission: null, nextModel: null })
      } else {
        const message = directionerAdmissionNotice(session)
        if (message)
          useDirectionerChatStore.setState({
            admission: { ...admission, phase: 'failed', message },
          })
      }
      return
    }
    if (admission.phase !== 'requested') return
    if (!session) {
      if (failure && !failure.retry)
        useDirectionerChatStore.setState({
          admission: {
            ...admission,
            phase: 'failed',
            message: failure.message,
          },
        })
      return
    }
    if (!admission.metadataChecked) {
      if (checking.current === admission) return
      checking.current = admission
      void refreshDirectionerSessionMetadata()
        .then(() => {
          if (useDirectionerChatStore.getState().admission === admission)
            useDirectionerChatStore.setState({
              admission: { ...admission, metadataChecked: true },
            })
        })
        .catch((error) => {
          if (useDirectionerChatStore.getState().admission === admission)
            useDirectionerChatStore.setState({
              admission: {
                ...admission,
                phase: 'failed',
                message: error instanceof Error ? error.message : String(error),
              },
            })
        })
      return
    }
    if (session.status === 'banned' || session.status === 'country_blocked') {
      useDirectionerChatStore.setState({
        admission: {
          ...admission,
          phase: 'failed',
          message: directionerAdmissionNotice(session)!,
        },
      })
      return
    }
    const model = resolveDirectionerModelPickForSession(admission.model, session)
    const intent = freebucksRowIntent(
      freebucksOf(session),
      model,
      session.status === 'active' ? session.model : undefined,
    )
    const resolved = { ...admission, model }
    if (intent.kind === 'paywall') {
      useDirectionerChatStore.setState({
        admission: {
          ...resolved,
          phase: 'failed',
          message: `Not enough Freebucks for ${getDirectionerModel(model).displayName} (${freebucksPriceLabel(intent.price)}). Choose another model with /model or visit https://directioner.com/plans.`,
        },
      })
    } else if (
      intent.kind === 'confirm' ||
      (session.status === 'active' && session.model !== model)
    ) {
      const cost =
        intent.price === undefined
          ? freebucksOf(session) === null
            ? 'may spend wallet Freebucks'
            : 'starts a new session'
          : `costs ${freebucksPriceLabel(intent.price)}`
      const wallet =
        intent.kind === 'confirm' && intent.walletSpend
          ? ` Uses ${formatFreebucks(intent.walletSpend)} from your wallet.`
          : ''
      useDirectionerChatStore.setState({
        admission: {
          ...resolved,
          phase: 'confirm',
          previousSession: session,
          walletSpendLimit:
            intent.kind === 'confirm'
              ? (intent.walletSpend ?? 'session')
              : undefined,
          message: `${getDirectionerModel(model).displayName} ${cost}.${wallet}${session.status === 'active' ? ' This ends your current model session; your conversation is kept.' : ''}${intent.kind === 'confirm' && 'claimEarned' in intent && intent.claimEarned ? ' Earned Freebucks will be claimed on admission.' : ''}`,
        },
      })
    } else {
      // Keep the exact object used by the asynchronous admission continuation.
      useDirectionerChatStore.setState({ admission: resolved })
      void beginDirectionerChatAdmission(resolved)
    }
  }, [enabled, admission, session, failure])
}
