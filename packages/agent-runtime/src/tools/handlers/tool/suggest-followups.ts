import type { BeyondersToolHandlerFunction } from '../handler-function-type'
import type {
  BeyondersToolCall,
  BeyondersToolOutput,
} from '@beyonders/common/tools/list'
import type { Logger } from '@beyonders/common/types/contracts/logger'

export const handleSuggestFollowups = (async (params: {
  previousToolCallFinished: Promise<unknown>
  toolCall: BeyondersToolCall<'suggest_followups'>
  logger: Logger
}): Promise<{ output: BeyondersToolOutput<'suggest_followups'> }> => {
  const { previousToolCallFinished, toolCall } = params
  const { followups: _followups } = toolCall.input

  await previousToolCallFinished
  return { output: [{ type: 'json', value: { message: 'Followups suggested!' } }] }
}) satisfies BeyondersToolHandlerFunction<'suggest_followups'>
