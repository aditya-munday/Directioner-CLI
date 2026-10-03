import { create } from 'zustand'

import { getSelectedDirectionerModel } from './directioner-model-store'
import { useDirectionerSessionStore } from './directioner-session-store'
import { saveDirectionerModelPreference } from '../utils/settings'

import type { DirectionerSessionResponse } from '../types/directioner-session'
import type { DirectionerWalletSpendLimit } from '@beyonders/common/types/directioner-session'

export type ChatAdmission = {
  phase: 'requested' | 'confirm' | 'starting' | 'failed'
  model: string
  message?: string
  previousSession?: DirectionerSessionResponse | null
  metadataChecked?: boolean
  walletSpendLimit?: DirectionerWalletSpendLimit
}

/** Choosing a model is a preference. Only submitting a message admits it. */
export const useDirectionerChatStore = create<{
  pickerOpen: boolean
  nextModel: string | null
  admission: ChatAdmission | null
}>(() => ({ pickerOpen: false, nextModel: null, admission: null }))

export function openDirectionerModelPicker() {
  if (useDirectionerChatStore.getState().admission) return
  useDirectionerChatStore.setState({ pickerOpen: true })
}

export function selectDirectionerChatModel(model: string) {
  if (useDirectionerChatStore.getState().admission) return
  saveDirectionerModelPreference(model)
  useDirectionerChatStore.setState({ nextModel: model, pickerOpen: false })
}

export function directionerChatModel() {
  return useDirectionerChatStore.getState().nextModel ?? getSelectedDirectionerModel()
}

export function directionerChatNeedsAdmission() {
  const { session } = useDirectionerSessionStore.getState()
  return (
    session?.status !== 'active' ||
    (session?.status === 'active' && session.model !== directionerChatModel())
  )
}

export function requestDirectionerChatAdmission() {
  const { admission } = useDirectionerChatStore.getState()
  if (admission && admission.phase !== 'failed') return
  useDirectionerChatStore.setState({
    admission: { phase: 'requested', model: directionerChatModel() },
  })
}
