import type { BeyondersToolHandlerFunction } from '../handler-function-type'
import type {
  ClientToolCall,
  BeyondersToolCall,
  BeyondersToolOutput,
} from '@beyonders/common/tools/list'

export const handleCodeSearch = (async (params: {
  previousToolCallFinished: Promise<void>
  toolCall: BeyondersToolCall<'code_search'>
  requestClientToolCall: (
    toolCall: ClientToolCall<'code_search'>,
  ) => Promise<BeyondersToolOutput<'code_search'>>
}): Promise<{
  output: BeyondersToolOutput<'code_search'>
}> => {
  const { previousToolCallFinished, toolCall, requestClientToolCall } = params

  await previousToolCallFinished
  return { output: await requestClientToolCall(toolCall) }
}) satisfies BeyondersToolHandlerFunction<'code_search'>
