import type { BeyondersToolHandlerFunction } from '../handler-function-type'
import type {
  BeyondersToolCall,
  BeyondersToolOutput,
} from '@beyonders/common/tools/list'
import type { Logger } from '@beyonders/common/types/contracts/logger'

export const handleThinkDeeply = (async (params: {
  previousToolCallFinished: Promise<any>
  toolCall: BeyondersToolCall<'think_deeply'>
  logger: Logger
}): Promise<{ output: BeyondersToolOutput<'think_deeply'> }> => {
  const { previousToolCallFinished, toolCall, logger } = params
  const { thought } = toolCall.input

  logger.debug(
    {
      thought,
    },
    'Thought deeply',
  )

  await previousToolCallFinished
  return { output: [{ type: 'json', value: { message: 'Thought logged.' } }] }
}) satisfies BeyondersToolHandlerFunction<'think_deeply'>
