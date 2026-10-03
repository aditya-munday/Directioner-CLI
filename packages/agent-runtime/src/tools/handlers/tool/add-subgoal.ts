import { buildArray } from '@beyonders/common/util/array'
import { jsonToolResult } from '@beyonders/common/util/messages'

import type { BeyondersToolHandlerFunction } from '../handler-function-type'
import type {
  BeyondersToolCall,
  BeyondersToolOutput,
} from '@beyonders/common/tools/list'
import type { Subgoal } from '@beyonders/common/types/session-state'

export const handleAddSubgoal = (async (params: {
  previousToolCallFinished: Promise<void>
  toolCall: BeyondersToolCall<'add_subgoal'>

  agentContext: Record<string, Subgoal>
}): Promise<{
  output: BeyondersToolOutput<'add_subgoal'>
}> => {
  const { previousToolCallFinished, toolCall, agentContext } = params

  agentContext[toolCall.input.id] = {
    objective: toolCall.input.objective,
    status: toolCall.input.status,
    plan: toolCall.input.plan,
    logs: buildArray([toolCall.input.log]),
  }

  await previousToolCallFinished
  return { output: jsonToolResult({ message: 'Successfully added subgoal' }) }
}) satisfies BeyondersToolHandlerFunction<'add_subgoal'>
