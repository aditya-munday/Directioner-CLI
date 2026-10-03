import type { BeyondersToolHandlerFunction } from '../handler-function-type'
import type {
  ClientToolCall,
  BeyondersToolCall,
  BeyondersToolOutput,
} from '@beyonders/common/tools/list'

type ToolName = 'list_directory'
export const handleListDirectory = (async (params: {
  previousToolCallFinished: Promise<void>
  toolCall: BeyondersToolCall<ToolName>
  requestClientToolCall: (
    toolCall: ClientToolCall<ToolName>,
  ) => Promise<BeyondersToolOutput<ToolName>>
}): Promise<{
  output: BeyondersToolOutput<ToolName>
}> => {
  const { previousToolCallFinished, toolCall, requestClientToolCall } = params

  await previousToolCallFinished
  return { output: await requestClientToolCall(toolCall) }
}) satisfies BeyondersToolHandlerFunction<ToolName>
