import type { BeyondersToolHandlerFunction } from '../handler-function-type'
import type {
  ClientToolCall,
  BeyondersToolCall,
  BeyondersToolOutput,
} from '@beyonders/common/tools/list'

export const handleReadUrl = (async (params: {
  previousToolCallFinished: Promise<void>
  toolCall: BeyondersToolCall<'read_url'>
  requestClientToolCall: (
    toolCall: ClientToolCall<'read_url'>,
  ) => Promise<BeyondersToolOutput<'read_url'>>
}): Promise<{
  output: BeyondersToolOutput<'read_url'>
}> => {
  const { previousToolCallFinished, toolCall, requestClientToolCall } = params

  await previousToolCallFinished
  return { output: await requestClientToolCall(toolCall) }
}) satisfies BeyondersToolHandlerFunction<'read_url'>
