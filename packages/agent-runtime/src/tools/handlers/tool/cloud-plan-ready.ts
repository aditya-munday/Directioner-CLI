import type { BeyondersToolHandlerFunction } from '../handler-function-type'
import type {
  BeyondersToolCall,
  BeyondersToolOutput,
} from '@beyonders/common/tools/list'

export const handleCloudPlanReady = (async (params: {
  previousToolCallFinished: Promise<unknown>
  toolCall: BeyondersToolCall<'cloud_plan_ready'>
}): Promise<{ output: BeyondersToolOutput<'cloud_plan_ready'> }> => {
  await params.previousToolCallFinished
  return {
    output: [
      {
        type: 'json',
        value: { message: 'The project plan is ready for approval.' },
      },
    ],
  }
}) satisfies BeyondersToolHandlerFunction<'cloud_plan_ready'>
