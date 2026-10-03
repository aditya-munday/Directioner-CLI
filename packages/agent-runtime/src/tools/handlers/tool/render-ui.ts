import type { BeyondersToolHandlerFunction } from '../handler-function-type'
import type {
  BeyondersToolCall,
  BeyondersToolOutput,
} from '@beyonders/common/tools/list'

export const handleRenderUI = (async ({
  previousToolCallFinished,
}: {
  previousToolCallFinished: Promise<unknown>
  toolCall: BeyondersToolCall<'render_ui'>
}): Promise<{ output: BeyondersToolOutput<'render_ui'> }> => {
  await previousToolCallFinished
  return { output: [{ type: 'json', value: { message: 'UI rendered.' } }] }
}) satisfies BeyondersToolHandlerFunction<'render_ui'>
