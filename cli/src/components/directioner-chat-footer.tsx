import { getDirectionerModel } from '@beyonders/common/constants/directioner-models'

import { Button } from './button'
import { useTheme } from '../hooks/use-theme'
import { useChatStore } from '../state/chat-store'
import {
  useDirectionerChatStore,
  openDirectionerModelPicker,
} from '../state/directioner-chat-store'
import {
  useDirectionerModelStore,
  getEffectiveDirectionerReasoningEffort,
} from '../state/directioner-model-store'
import { getFirstUserPrompt } from '../utils/chat-meta'
import { formatCwd } from '../utils/path-helpers'

export function DirectionerChatFooter({ projectRoot }: { projectRoot: string }) {
  const theme = useTheme()
  const selected = useDirectionerModelStore((s) => s.selectedModel)
  useDirectionerModelStore((s) => s.reasoningEffortByModel)
  const nextModel = useDirectionerChatStore((s) => s.nextModel)
  const model = getDirectionerModel(nextModel ?? selected)
  const effort = getEffectiveDirectionerReasoningEffort(model.id)
  const name = useChatStore((s) => getFirstUserPrompt(s.messages))
  return (
    <box style={{ flexDirection: 'column', flexShrink: 0, paddingLeft: 1 }}>
      <Button onClick={openDirectionerModelPicker}>
        <text style={{ wrapMode: 'word', fg: theme.foreground }}>
          <span
            fg={theme.primary}
          >{`${model.displayName}${effort ? ` • ${effort}` : ''}`}</span>
          <span fg={theme.muted}>{` · ${formatCwd(projectRoot)} · `}</span>
          <span fg={theme.primary}>/model</span>
          <span
            fg={theme.muted}
          >{` to change · Chat: ${name === '(empty chat)' ? 'New chat' : name.replace(/\s+/g, ' ')}`}</span>
        </text>
      </Button>
      <text style={{ fg: theme.muted }}>
        <span fg={theme.foreground}>←</span> for history ·{' '}
        <span fg={theme.foreground}>?</span> for help
      </text>
    </box>
  )
}
