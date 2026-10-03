import type { BeyondersToolHandlerFunction } from '../handler-function-type'
import type {
  ClientToolCall,
  BeyondersToolCall,
  BeyondersToolOutput,
} from '@beyonders/common/tools/list'
import type { AgentTemplate } from '@beyonders/common/types/agent-template'

const WINDOWED_GLOB_RESULTS = 100

type ToolName = 'glob'
export const handleGlob = (async (params: {
  previousToolCallFinished: Promise<void>
  toolCall: BeyondersToolCall<ToolName>
  agentTemplate: AgentTemplate
  requestClientToolCall: (
    toolCall: ClientToolCall<ToolName>,
  ) => Promise<BeyondersToolOutput<ToolName>>
}): Promise<{
  output: BeyondersToolOutput<ToolName>
}> => {
  const { previousToolCallFinished, toolCall, agentTemplate, requestClientToolCall } =
    params

  await previousToolCallFinished
  const finalToolCall =
    agentTemplate.windowedFileReads === true &&
    toolCall.input.max_results === undefined
      ? {
          ...toolCall,
          input: { ...toolCall.input, max_results: WINDOWED_GLOB_RESULTS },
        }
      : toolCall
  return { output: await requestClientToolCall(finalToolCall) }
}) satisfies BeyondersToolHandlerFunction<ToolName>
