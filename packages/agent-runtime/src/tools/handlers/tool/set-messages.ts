import type { BeyondersToolHandlerFunction } from '../handler-function-type'
import type {
  BeyondersToolCall,
  BeyondersToolOutput,
} from '@beyonders/common/tools/list'
import type { AgentState } from '@beyonders/common/types/session-state'

export const handleSetMessages = (async (params: {
  previousToolCallFinished: Promise<void>
  toolCall: BeyondersToolCall<'set_messages'>

  agentState: AgentState
}): Promise<{ output: BeyondersToolOutput<'set_messages'> }> => {
  const { previousToolCallFinished, toolCall, agentState } = params

  await previousToolCallFinished
  agentState.messageHistory = toolCall.input.messages
  agentState.contextTokenBaseline = undefined
  return { output: [{ type: 'json', value: { message: 'Messages set.' } }] }
}) satisfies BeyondersToolHandlerFunction<'set_messages'>
