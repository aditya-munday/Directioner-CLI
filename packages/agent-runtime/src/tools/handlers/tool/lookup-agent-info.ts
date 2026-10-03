import { jsonToolResult } from '@beyonders/common/util/messages'
import { removeUndefinedProps } from '@beyonders/common/util/object'
import z from 'zod/v4'

import { getAgentTemplate } from '../../../templates/agent-registry'

import type { BeyondersToolHandlerFunction } from '../handler-function-type'
import type {
  BeyondersToolCall,
  BeyondersToolOutput,
} from '@beyonders/common/tools/list'
import type {
  AgentTemplate,
  Logger,
} from '@beyonders/common/types/agent-template'
import type { FetchAgentFromDatabaseFn } from '@beyonders/common/types/contracts/database'

export const handleLookupAgentInfo = (async (params: {
  toolCall: BeyondersToolCall<'lookup_agent_info'>
  previousToolCallFinished: Promise<void>

  apiKey: string
  databaseAgentCache: Map<string, AgentTemplate | null>
  localAgentTemplates: Record<string, AgentTemplate>
  logger: Logger
  fetchAgentFromDatabase: FetchAgentFromDatabaseFn
}): Promise<{ output: BeyondersToolOutput<'lookup_agent_info'> }> => {
  const { toolCall, previousToolCallFinished } = params
  const { agentId } = toolCall.input

  await previousToolCallFinished

  const agentTemplate = await getAgentTemplate({
    ...params,
    agentId,
  })

  if (!agentTemplate) {
    return {
      output: jsonToolResult({
        found: false,
        error: `Agent '${agentId}' not found`,
      }),
    }
  }
  const {
    id,
    displayName,
    model,
    includeMessageHistory,
    inputSchema,
    spawnerPrompt,
    outputMode,
    outputSchema,
    toolNames,
    spawnableAgents,
  } = agentTemplate

  return {
    output: jsonToolResult({
      found: true,
      agent: {
        ...removeUndefinedProps({
          fullAgentId: agentId,
          id,
          displayName,
          model,
          toolNames,
          spawnableAgents,
          includeMessageHistory,
          spawnerPrompt,
          ...(inputSchema && {
            inputSchema: inputSchemaToJSONSchema(inputSchema),
          }),
          outputMode,
          ...(outputSchema && {
            outputSchema: toJSONSchema(outputSchema),
          }),
        }),
      },
    }),
  }
}) satisfies BeyondersToolHandlerFunction<'lookup_agent_info'>

const toJSONSchema = (schema: z.ZodSchema) => {
  try {
    const jsonSchema = z.toJSONSchema(schema, { io: 'input' }) as {
      [key: string]: any
    }
    delete jsonSchema['$schema']
    return jsonSchema
  } catch {
    return { type: 'object', description: 'Schema unavailable' }
  }
}

const inputSchemaToJSONSchema = (inputSchema: {
  prompt?: z.ZodSchema
  params?: z.ZodSchema
}) => {
  return removeUndefinedProps({
    prompt: inputSchema.prompt ? toJSONSchema(inputSchema.prompt) : undefined,
    params: inputSchema.params ? toJSONSchema(inputSchema.params) : undefined,
  })
}
