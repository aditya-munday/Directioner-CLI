import type { BeyondersToolHandlerFunction } from '../handler-function-type'
import type {
  BeyondersToolCall,
  BeyondersToolOutput,
} from '@beyonders/common/tools/list'

export const handleReportProjectProfile = (async (params: {
  previousToolCallFinished: Promise<any>
  toolCall: BeyondersToolCall<'report_project_profile'>
}): Promise<{ output: BeyondersToolOutput<'report_project_profile'> }> => {
  await params.previousToolCallFinished
  return {
    output: [
      {
        type: 'json',
        value: {
          message:
            'Not requested. Do not call this tool unless explicitly asked.',
        },
      },
    ],
  }
}) satisfies BeyondersToolHandlerFunction<'report_project_profile'>
