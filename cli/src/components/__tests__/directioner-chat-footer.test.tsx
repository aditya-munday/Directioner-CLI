import { beforeAll, expect, test } from 'bun:test'
import { createTestRenderer } from '@opentui/core/testing'
import { createRoot, flushSync } from '@opentui/react'
import { DIRECTIONER_GLM_V53_FLASH_MODEL_ID } from '@beyonders/common/constants/directioner-models'
import { DirectionerChatFooter } from '../directioner-chat-footer'
import { initializeThemeStore } from '../../hooks/use-theme'
import { useChatStore } from '../../state/chat-store'
import { useDirectionerModelStore } from '../../state/directioner-model-store'
import { useDirectionerChatStore } from '../../state/directioner-chat-store'

beforeAll(initializeThemeStore)

test.each([120, 42])(
  'footer reflects model, reasoning and chat name at %s columns',
  async (width) => {
    const previousModel = useDirectionerModelStore.getState()
    const previousNext = useDirectionerChatStore.getState().nextModel
    const previousMessages = useChatStore.getState().messages
    const setup = await createTestRenderer({ width, height: 5 })
    const root = createRoot(setup.renderer)
    try {
      useDirectionerModelStore.setState({
        selectedModel: DIRECTIONER_GLM_V53_FLASH_MODEL_ID,
        reasoningEffortByModel: {},
      })
      useDirectionerChatStore.setState({ nextModel: null })
      useChatStore.setState({ messages: [] })
      flushSync(() =>
        root.render(<DirectionerChatFooter projectRoot="/tmp/project" />),
      )
      await setup.renderOnce()
      expect(setup.captureCharFrame().replace(/\s+/g, ' ')).toContain('Chat: New chat')
      flushSync(() => {
        useDirectionerModelStore.setState({
          reasoningEffortByModel: { [DIRECTIONER_GLM_V53_FLASH_MODEL_ID]: 'low' },
        })
        useChatStore.setState({
          messages: [
            {
              id: 'first',
              variant: 'user',
              content: 'Build a game',
              timestamp: new Date().toISOString(),
            },
          ],
        })
      })
      await setup.renderOnce()
      const frame = setup.captureCharFrame().replace(/\s+/g, ' ')
      expect(frame).toContain('GLM 5.3 Flash • low')
      expect(frame).toContain('/tmp/project')
      expect(frame).toContain('Chat: Build a game')
    } finally {
      flushSync(() => root.unmount())
      setup.renderer.destroy()
      useDirectionerModelStore.setState(previousModel)
      useDirectionerChatStore.setState({ nextModel: previousNext })
      useChatStore.setState({ messages: previousMessages })
    }
  },
)
