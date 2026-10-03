import { useKeyboard } from '@opentui/react'
import { useCallback, useEffect } from 'react'

import { Button } from './button'
import { DirectionerModelSelector } from './directioner-model-selector'
import { useTheme } from '../hooks/use-theme'
import { useTerminalDimensions } from '../hooks/use-terminal-dimensions'
import { beginDirectionerChatAdmission } from '../hooks/use-directioner-chat-admission'
import {
  returnToDirectionerLanding,
  refreshDirectionerSessionMetadata,
  takeOverDirectionerSession,
} from '../hooks/use-directioner-session'
import { useChatRuntime } from '../contexts/chat-runtime-context'
import { useChatStore } from '../state/chat-store'
import { useDirectionerModelStore } from '../state/directioner-model-store'
import { useDirectionerSessionStore } from '../state/directioner-session-store'
import {
  useDirectionerChatStore,
  selectDirectionerChatModel,
  requestDirectionerChatAdmission,
} from '../state/directioner-chat-store'
import { isPlainEnterKey } from '../utils/terminal-enter-detection'

export function DirectionerChatControls() {
  const theme = useTheme()
  const { terminalHeight } = useTerminalDimensions()
  const pickerOpen = useDirectionerChatStore((s) => s.pickerOpen)
  const admission = useDirectionerChatStore((s) => s.admission)
  const nextModel = useDirectionerChatStore((s) => s.nextModel)
  const model = useDirectionerModelStore((s) => s.selectedModel)
  const session = useDirectionerSessionStore((s) => s.session)
  const { clearQueue } = useChatRuntime()
  useEffect(() => {
    if (pickerOpen) void refreshDirectionerSessionMetadata().catch(() => {})
  }, [pickerOpen])

  const cancel = useCallback(async () => {
    if (pickerOpen) {
      useDirectionerChatStore.setState({ pickerOpen: false })
      return
    }
    const current = useDirectionerChatStore.getState().admission
    if (!current) return
    // Abort/release an in-flight claim before returning to the composer. The
    // queue remains held until DELETE confirms, including a lost POST reply.
    if (
      current.phase === 'starting' ||
      (current.phase === 'failed' &&
        current.previousSession !== undefined &&
        useDirectionerSessionStore.getState().pendingAdmission)
    ) {
      try {
        await returnToDirectionerLanding({ preserveQueue: true })
      } catch {
        return
      }
    }
    const queued = clearQueue()
    const chat = useChatStore.getState()
    const text = [...queued.map((m) => m.content), chat.inputValue]
      .filter(Boolean)
      .join('\n\n')
    useChatStore.setState((s) => {
      s.pendingAttachments = [
        ...queued.flatMap((m) => m.attachments),
        ...s.pendingAttachments,
      ]
    })
    chat.setInputValue({
      text,
      cursorPosition: text.length,
      lastEditDueToNav: false,
    })
    useDirectionerChatStore.setState({ admission: null })
  }, [pickerOpen, clearQueue])

  const confirm = useCallback(() => {
    if (!admission) return
    if (session?.status === 'takeover_prompt') {
      void takeOverDirectionerSession()
    } else if (admission.phase === 'confirm') {
      void beginDirectionerChatAdmission(admission)
    } else if (admission.phase === 'failed') {
      requestDirectionerChatAdmission()
    }
  }, [admission, session])

  useKeyboard(
    useCallback(
      (key) => {
        if ((!pickerOpen && key.name === 'escape') || (key.ctrl && key.name === 'c')) {
          key.preventDefault?.()
          key.stopPropagation?.()
          void cancel()
        } else if (!pickerOpen && isPlainEnterKey(key)) {
          key.preventDefault?.()
          key.stopPropagation?.()
          confirm()
        }
      },
      [cancel, confirm, pickerOpen],
    ),
  )

  if (pickerOpen)
    return (
      <box style={{ flexDirection: 'column', paddingLeft: 1, paddingRight: 1 }}>
        <text style={{ fg: theme.foreground }}>
          ↑↓ choose model · Tab reasoning · Enter select · Esc cancel
        </text>
        <DirectionerModelSelector
          maxHeight={Math.max(4, Math.floor(terminalHeight * 0.65) - 2)}
          selectedModelOverride={nextModel ?? model}
          onSelectModel={selectDirectionerChatModel}
          onCancel={() => useDirectionerChatStore.setState({ pickerOpen: false })}
        />
      </box>
    )
  if (!admission) return null
  const takeover = session?.status === 'takeover_prompt'
  const canConfirm =
    takeover || admission.phase === 'confirm' || admission.phase === 'failed'
  return (
    <box
      style={{
        border: true,
        borderColor: theme.border,
        paddingLeft: 1,
        paddingRight: 1,
        flexDirection: 'column',
      }}
    >
      <text style={{ fg: theme.foreground, wrapMode: 'word' }}>
        {takeover
          ? (session.message ??
            'Directioner is already running elsewhere. Take over that session?')
          : (admission.message ??
            'Starting your model session… Your message is saved.')}
      </text>
      <box style={{ flexDirection: 'row', gap: 2 }}>
        {canConfirm && (
          <Button onClick={confirm}>
            <text style={{ fg: theme.primary }}>
              {takeover
                ? 'Enter: take over'
                : admission.phase === 'failed'
                  ? 'Enter: retry'
                  : 'Enter: confirm and send'}
            </text>
          </Button>
        )}
        <Button
          onClick={() => {
            void cancel()
          }}
        >
          <text style={{ fg: theme.muted }}>Esc: back to draft</text>
        </Button>
      </box>
    </box>
  )
}
