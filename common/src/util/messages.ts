import { modelMessageSchema } from 'ai'
import { cloneDeep, has, isEqual } from 'lodash'

import { MCP_TOOL_SEPARATOR } from '../constants/mcp'
import { sanitizeForTerminalDisplay } from './string'
import { escapeXmlAttribute } from './xml'

import type { Logger } from '../types/contracts/logger'
import type { JSONValue } from '../types/json'
import type {
  AssistantMessage,
  AuxiliaryMessageData,
  Message,
  SystemMessage,
  ToolMessage,
  UserMessage,
} from '../types/messages/beyonders-message'
import type {
  ToolCallPart,
  ToolResultOutput,
} from '../types/messages/content-part'
import type { ProviderMetadata } from '../types/messages/provider-metadata'
import type {
  AssistantModelMessage,
  ModelMessage,
  SystemModelMessage,
  ToolModelMessage,
  UserModelMessage,
} from 'ai'

export function toContentString(msg: ModelMessage): string {
  const { content } = msg
  if (typeof content === 'string') return content
  return content
    .map((item) =>
      item && 'text' in item && typeof item.text === 'string' ? item.text : '',
    )
    .join('\n')
}

export function withCacheControl<T extends object>(
  obj: T & { providerOptions?: ProviderMetadata },
): T & { providerOptions: ProviderMetadata } {
  const wrapper = cloneDeep(obj) as T & {
    providerOptions: ProviderMetadata
  }
  if (!wrapper.providerOptions) {
    wrapper.providerOptions = {}
  }

  /* 'beyonders' provider name is not compatible with providerMetadata for
   * messages, so we need to use 'openaiCompatible' instead.
   * https://github.com/vercel/ai/blob/8e4fdac31b4f8c6a8d07a606a8833e74adf99470/packages/openai-compatible/src/chat/convert-to-openai-compatible-chat-messages.ts#L9
   */
  for (const provider of [
    'anthropic',
    'openrouter',
    'openaiCompatible',
  ] as const) {
    if (!wrapper.providerOptions[provider]) {
      wrapper.providerOptions[provider] = {}
    }
    wrapper.providerOptions[provider].cache_control = { type: 'ephemeral' }
  }

  return wrapper
}

export function withoutCacheControl<T extends object>(
  obj: T & { providerOptions?: ProviderMetadata },
): T & { providerOptions?: ProviderMetadata } {
  const wrapper = cloneDeep(obj) as T & {
    providerOptions?: ProviderMetadata
  }

  for (const provider of [
    'anthropic',
    'openrouter',
    'openaiCompatible',
  ] as const) {
    if (has(wrapper.providerOptions?.[provider]?.cache_control, 'type')) {
      delete wrapper.providerOptions?.[provider]?.cache_control?.type
    }
    if (
      Object.keys(wrapper.providerOptions?.[provider]?.cache_control ?? {})
        .length === 0
    ) {
      delete wrapper.providerOptions?.[provider]?.cache_control
    }
    if (Object.keys(wrapper.providerOptions?.[provider] ?? {}).length === 0) {
      delete wrapper.providerOptions?.[provider]
    }
  }

  if (Object.keys(wrapper.providerOptions ?? {}).length === 0) {
    delete wrapper.providerOptions
  }

  return wrapper
}

type NonStringContent<T extends { content: any }> = Omit<T, 'content'> & {
  content: Exclude<T['content'], string>
}
type ModelMessageWithAuxiliaryData = (
  | SystemModelMessage
  | NonStringContent<UserModelMessage>
  | NonStringContent<AssistantModelMessage>
  | ToolModelMessage
) &
  AuxiliaryMessageData

function assistantToBeyondersMessage(
  message: Omit<AssistantMessage, 'content'> & {
    content: Exclude<AssistantMessage['content'], string>[number]
  },
): AssistantMessage {
  // if (message.content.type === 'tool-call') {
  //   return cloneDeep({
  //     ...message,
  //     content: [
  //       {
  //         type: 'text',
  //         text: getToolCallString(
  //           message.content.toolName,
  //           message.content.input,
  //           false,
  //         ),
  //       },
  //     ],
  //   })
  // }
  return cloneDeep({ ...message, content: [message.content] })
}

/**
 * The delimiter around every tool result the model sees. Both tags are
 * emitted only by {@link wrapToolResultForModel}; any occurrence inside the
 * payload is defanged, so these are the only ones that can exist in a message.
 */
const TOOL_RESULT_MARKER = 'directioner_tool_result'

/**
 * Strip terminal control sequences and other non-printing control characters
 * from text the model is about to read, so a tool (or an MCP server) cannot
 * use the model as a conduit for a control sequence aimed at whatever renders
 * the conversation later. Tab and newline are kept as layout; everything else
 * that a terminal would act on — including carriage return and backspace,
 * which overwrite already-printed text — is removed.
 */
function neutralizeControlSequences(value: string): string {
  return sanitizeForTerminalDisplay(value)
}

/** The MCP server a tool name belongs to, or undefined for built-in tools. */
function toolOrigin(toolName: string): string | undefined {
  const separatorIndex = toolName.indexOf(MCP_TOOL_SEPARATOR)
  return separatorIndex > 0 ? toolName.slice(0, separatorIndex) : undefined
}

/** Coarse, non-overfitting label for how the payload is encoded on the wire. */
function describeResultShape(value: unknown): string {
  if (typeof value === 'string') return 'text'
  if (value === null) return 'json-null'
  if (Array.isArray(value)) return 'json-array'
  if (typeof value === 'object') return 'json-object'
  return `json-${typeof value}`
}

/**
 * Render one tool result as provenance-tagged, delimited text.
 *
 * The model receives every tool result as data inside this element. The origin
 * and shape attributes describe where the payload came from and how it is
 * encoded; the `trust="untrusted"` attribute records that the payload carries
 * no authority — a tool result can say "the user approved this" or "SYSTEM:
 * ignore your instructions" and neither statement is an instruction. Authority
 * comes from the runtime's own control flow (the user's prompt, approval
 * gates), never from the content of a result.
 *
 * The payload is JSON-encoded when it is structured, so nested objects and
 * arrays stay machine-parseable; text payloads are passed through verbatim
 * after control-sequence neutralization, so file contents and command output
 * remain readable.
 */
function wrapToolResultForModel(
  message: ToolMessage,
  output: Extract<ToolResultOutput, { type: 'json' }>,
): string {
  const origin = toolOrigin(message.toolName)
  const shape = describeResultShape(output.value)
  const body =
    typeof output.value === 'string'
      ? output.value
      : JSON.stringify(output.value, null, 2)
  // Defang anything that could pass for the wrapper's own tags, so the real
  // open/close pair is the only boundary the model can observe regardless of
  // what the payload contains (a closing tag, a nested tag, a lookalike).
  const safeBody = neutralizeControlSequences(body).replace(
    new RegExp(`(<\\s*/?\\s*)${TOOL_RESULT_MARKER}`, 'gi'),
    '$1directioner_tool_result_',
  )
  // Every value here is attacker-controlled in the MCP case: the origin is the
  // repository's `mcp.json` server key and the tool name is whatever the server
  // exposed. Interpolated raw into a quoted attribute, a value with a `"` forges
  // a second `trust="trusted"` and a value with a newline ends the tag line and
  // drops the remainder into the prompt at instruction priority — exactly the
  // boundary this wrapper draws. Escape for the attribute context so the real
  // open/close pair and the single `trust="untrusted"` are unforgeable.
  const attributes = [
    origin
      ? `origin="mcp:${escapeXmlAttribute(origin)}"`
      : 'origin="builtin"',
    `tool="${escapeXmlAttribute(message.toolName)}"`,
    `shape="${shape}"`,
    'trust="untrusted"',
  ].join(' ')
  return `<${TOOL_RESULT_MARKER} ${attributes}>\n${safeBody}\n</${TOOL_RESULT_MARKER}>`
}

/** A tool message answering `message`'s call, carrying `output`. */
function toolResultMessage(
  message: ToolMessage,
  output: Extract<ToolResultOutput, { type: 'json' }>,
): ModelMessageWithAuxiliaryData {
  const wrapped: Extract<ToolResultOutput, { type: 'json' }> = {
    type: 'json',
    value: wrapToolResultForModel(message, output),
  }
  return cloneDeep<ToolModelMessage>({
    ...message,
    role: 'tool',
    content: [{ ...message, output: wrapped, type: 'tool-result' }],
  })
}

const EMPTY_TOOL_OUTPUT = { type: 'json', value: '' } as const

function convertToolResultMessage(
  message: ToolMessage,
): ModelMessageWithAuxiliaryData[] {
  if (message.content.length === 0) {
    return [toolResultMessage(message, EMPTY_TOOL_OUTPUT)]
  }
  // A `media` part becomes a *user* message, because providers do not accept
  // images inside a tool message. Emit every tool message first regardless of
  // the part order, so the results still immediately follow the assistant's
  // tool_calls — otherwise a tool that returns [media, json] (which is the
  // order preview_screenshot uses, so the model sees pixels before the note)
  // puts a user message between the call and its result. Providers reject that
  // outright ("tool call result does not follow tool call"), and the server's
  // repair drops the call and the result as an unpaired pair.
  const toolMessages: ModelMessageWithAuxiliaryData[] = []
  const mediaMessages: ModelMessageWithAuxiliaryData[] = []
  for (const c of message.content) {
    if (c.type === 'json') {
      toolMessages.push(toolResultMessage(message, c))
      continue
    }
    if (c.type === 'media') {
      mediaMessages.push(
        cloneDeep<UserMessage>({
          ...message,
          role: 'user',
          content: [{ type: 'file', data: c.data, mediaType: c.mediaType }],
        }),
      )
      continue
    }
    c satisfies never
    throw new Error(
      `Invalid tool output type: ${(c as { type: unknown }).type}`,
    )
  }

  // Media-only output (see `mediaToolResult`) would otherwise emit a user
  // message and no tool message at all, leaving the call permanently
  // unanswered — the same unpaired-tool-call failure, just reached a different
  // way. Answer it with the empty result the no-content branch already uses.
  if (toolMessages.length === 0) {
    toolMessages.push(toolResultMessage(message, EMPTY_TOOL_OUTPUT))
  }

  return [...toolMessages, ...mediaMessages]
}

function convertToolMessage(message: Message): ModelMessageWithAuxiliaryData[] {
  if (message.role === 'system') {
    return [
      {
        ...message,
        content: message.content.map(({ text }) => text).join('\n\n'),
      },
    ]
  }
  if (message.role === 'user') {
    return [cloneDeep(message)]
  }
  if (message.role === 'assistant') {
    if (typeof message.content === 'string') {
      return [
        cloneDeep({
          ...message,
          content: [{ type: 'text' as const, text: message.content }],
        }),
      ]
    }
    return message.content.map((c) => {
      return assistantToBeyondersMessage({
        ...message,
        content: c,
      })
    })
  }
  if (message.role === 'tool') {
    return convertToolResultMessage(message)
  }
  message satisfies never
  throw new Error(
    `Invalid message role: ${(message as { role: unknown }).role}`,
  )
}

function convertToolMessages(
  messages: Message[],
): ModelMessageWithAuxiliaryData[] {
  const withoutToolMessages: ModelMessageWithAuxiliaryData[] = []
  // Media parts ride *user* messages (see convertToolResultMessage), and the AI
  // SDK throws at a user/system boundary when any tool call issued so far is
  // still unanswered. Emitting media inline therefore splits a batch of
  // parallel calls -- the sibling whose result is not reached yet is still
  // pending, so validation fails client-side before the request is ever sent,
  // permanently wedging the thread that replays that history. Buffer media
  // until every call is answered, then flush: waiting on the answers not on
  // the next non-tool message keeps the image as close to its own result as is
  // safe, even when something is interleaved between the results.
  // (convertToolResultMessage already does this within one tool message.)
  const unanswered = new Set<string>()
  let pendingMedia: ModelMessageWithAuxiliaryData[] = []
  const flushMedia = () => {
    if (unanswered.size > 0 || pendingMedia.length === 0) return
    withoutToolMessages.push(...pendingMedia)
    pendingMedia = []
  }

  for (const message of messages) {
    const converted = convertToolMessage(message)
    if (message.role !== 'tool') {
      flushMedia()
      withoutToolMessages.push(...converted)
      for (const part of converted) {
        if (part.role !== 'assistant') continue
        for (const content of part.content) {
          // Mirrors the SDK: a provider-executed call needs no local result, so
          // tracking one would defer every later image forever.
          if (content.type !== 'tool-call') continue
          if (content.providerExecuted !== true) {
            unanswered.add(content.toolCallId)
          }
        }
      }
      continue
    }
    for (const part of converted) {
      if (part.role !== 'tool') {
        pendingMedia.push(part)
        continue
      }
      withoutToolMessages.push(part)
      for (const content of part.content) {
        if (content.type === 'tool-result') {
          unanswered.delete(content.toolCallId)
        }
      }
    }
    flushMedia()
  }

  // Anything still buffered had no clean boundary; dropUnansweredToolCalls has
  // already removed calls that never get answered, so this is just a backstop.
  withoutToolMessages.push(...pendingMedia)
  return withoutToolMessages
}

/**
 * Recursively replace any lone (unpaired) UTF-16 surrogate with U+FFFD in every
 * string reachable from `value`, mutating objects/arrays in place.
 *
 * Why this exists: unsafe truncation (e.g. slicing a file read or terminal
 * output in the middle of an emoji / astral-plane character) can leave a lone
 * surrogate in message content. JS's `JSON.stringify` is "well-formed" and emits
 * it as a syntactically-valid `\uXXXX` escape, and JS's `JSON.parse` is lenient
 * and accepts it, so the corruption slips through every client-side check. But
 * strict server-side parsers — notably Rust's serde_json, used by
 * OpenAI/OpenRouter/Anthropic — reject the whole request body with
 * "unexpected end of hex escape". Once such content lands in the message
 * history, EVERY subsequent provider request fails fatally and the agent stops,
 * even though nothing is wrong with the current turn's tool call.
 *
 * Sanitizing here, at the single chokepoint where all messages are converted to
 * provider format, guarantees a single bad character can never poison the
 * conversation regardless of which tool produced it. It is a no-op on
 * already-valid strings, so valid emoji, base64, etc. are untouched.
 *
 * (Equivalent to `String.prototype.toWellFormed()`, implemented as a regex so we
 * don't need to widen the project's TS lib to ES2024.)
 */
const LONE_SURROGATE_REGEX =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

function toWellFormedString(str: string): string {
  return str.replace(LONE_SURROGATE_REGEX, '�')
}

function wellFormStringsInPlace(value: unknown): void {
  // Arrays and plain objects are both handled here: Object.keys enumerates array
  // indices too, and indexing by string key mutates the element in place.
  if (!value || typeof value !== 'object') return
  const obj = value as Record<string, unknown>
  for (const key of Object.keys(obj)) {
    const item = obj[key]
    if (typeof item === 'string') {
      obj[key] = toWellFormedString(item)
    } else {
      wellFormStringsInPlace(item)
    }
  }
}

export function convertCbToModelMessages({
  messages,
  includeCacheControl = true,
  logger,
}: {
  messages: Message[]
  includeCacheControl?: boolean
  logger?: Logger
}): ModelMessage[] {
  // AI SDK validates tool-call/result pairing before making a request. Repair
  // at this lowest shared boundary as well as in the runtime step builder so
  // auxiliary calls and restored SDK state cannot poison a thread permanently.
  const sendableMessages = dropUnansweredToolCalls(messages)
  const toolMessagesConverted: ModelMessageWithAuxiliaryData[] =
    convertToolMessages(sendableMessages)

  const aggregated: ModelMessageWithAuxiliaryData[] = []
  for (const message of toolMessagesConverted) {
    if (aggregated.length === 0) {
      aggregated.push(message)
      continue
    }

    const lastMessage = aggregated[aggregated.length - 1]
    if (
      lastMessage.timeToLive !== message.timeToLive ||
      !isEqual(lastMessage.providerOptions, message.providerOptions) ||
      !isEqual(lastMessage.tags, message.tags)
    ) {
      aggregated.push(message)
      continue
    }
    if (lastMessage.role === 'system' && message.role === 'system') {
      lastMessage.content += '\n\n' + message.content
      continue
    }
    if (lastMessage.role === 'user' && message.role === 'user') {
      lastMessage.content.push(...message.content)
      continue
    }
    if (lastMessage.role === 'assistant' && message.role === 'assistant') {
      lastMessage.content.push(...message.content)
      continue
    }

    aggregated.push(message)
  }

  // Neutralize any lone UTF-16 surrogates before the messages reach the provider.
  // These are mutated in place; every aggregated message is a fresh clone (see
  // convertToolMessage), so the caller's message history is unaffected.
  for (const message of aggregated) {
    if (typeof message.content === 'string') {
      message.content = toWellFormedString(message.content)
    } else {
      wellFormStringsInPlace(message.content)
    }
  }

  if (!includeCacheControl) {
    return aggregated
  }

  // Add cache control to specific messages (max of 4 can be marked for caching!):
  // - The message right before the three tagged messages
  // - Last message
  for (const tag of [
    'LAST_ASSISTANT_MESSAGE',
    'USER_PROMPT',
    'STEP_PROMPT',
    undefined, // Last message
  ] as const) {
    let index =
      tag === 'LAST_ASSISTANT_MESSAGE'
        ? aggregated.findLastIndex((m) => m.role === 'assistant')
        : tag
          ? aggregated.findLastIndex((m) => m.tags?.includes(tag))
          : aggregated.length
    if (index <= 0) {
      continue
    }

    // Iterate to find the last "valid" message that we can cache control
    let prevMessage: (typeof aggregated)[number]
    let contentBlock: (typeof prevMessage)['content']
    addCacheControlLoop: while (true) {
      index--

      // No message found
      if (index < 0) {
        break
      }

      prevMessage = aggregated[index]
      contentBlock = prevMessage.content

      if (typeof contentBlock === 'string') {
        // This must be a system message
        aggregated[index] = withCacheControl(aggregated[index])
        break
      }

      // Iterate to find the last valid content part (not a very short string)
      let lastContentIndex = contentBlock.length
      let lastContentPart: (typeof contentBlock)[number]
      while (true) {
        lastContentIndex--
        lastContentPart = contentBlock[lastContentIndex]

        if (lastContentIndex < 0) {
          // Continue searching in next message
          break
        }

        if (lastContentPart.type !== 'text') {
          contentBlock[lastContentIndex] = withCacheControl(
            contentBlock[lastContentIndex],
          )
          break addCacheControlLoop
        }

        prevMessage.content = [
          ...contentBlock.slice(0, lastContentIndex),
          withCacheControl(lastContentPart),
          ...contentBlock.slice(lastContentIndex + 1),
        ] as typeof contentBlock

        break addCacheControlLoop
      }
      break
    }
  }

  // Validate each message against the AI SDK schema
  for (let i = 0; i < aggregated.length; i++) {
    const message = aggregated[i]
    const result = modelMessageSchema.safeParse(message)
    if (!result.success) {
      if (logger) {
        logger.error(
          { message, aggregated, error: result.error },
          `convertCbToModelMessages: Message at index ${i} failed schema validation.`,
        )
      }
      throw new Error(
        `convertCbToModelMessages: Message at index ${i} failed schema validation.\n` +
          `Role: ${message.role}\n` +
          `Message:\n${result.error.message}`,
      )
    }
  }

  return aggregated
}

/**
 * Drop local tool calls that were not answered before the next user/system
 * boundary or the end of history.
 *
 * AI SDK validates that boundary before making a request. A result later in
 * history cannot cross a user/system boundary to answer an interrupted call.
 * Provider-executed calls need no local answer.
 *
 * Tool messages themselves are preserved: the SDK intentionally supports
 * freestanding results from user-run commands between prompts. The web API's
 * wire-format sanitizer handles provider-specific orphan and duplicate rules.
 */
export function dropUnansweredToolCalls(messages: Message[]): Message[] {
  const pending = new Map<string, ToolCallPart[]>()
  const unanswered = new Set<ToolCallPart>()
  const flushPending = () => {
    for (const calls of pending.values()) {
      for (const call of calls) unanswered.add(call)
    }
    pending.clear()
  }

  // Mirror AI SDK's validator: assistant calls add pending ids, tool messages
  // resolve them, and a user/system boundary (or end of history) requires the
  // pending set to be empty.
  for (const message of messages) {
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type !== 'tool-call' || part.providerExecuted === true)
          continue
        const calls = pending.get(part.toolCallId)
        if (calls) calls.push(part)
        else pending.set(part.toolCallId, [part])
      }
    } else if (message.role === 'tool') {
      pending.delete(message.toolCallId)
    } else if (message.role === 'user' || message.role === 'system') {
      flushPending()
    }
  }
  flushPending()

  if (unanswered.size === 0) return messages

  return messages.flatMap((message) => {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) {
      return [message]
    }
    const content = message.content.filter(
      (part) => part.type !== 'tool-call' || !unanswered.has(part),
    )
    return content.length > 0 ? [{ ...message, content }] : []
  })
}

// type NoContent<T> = T & { content?: never }
export type SystemContent =
  string | SystemMessage['content'][number] | SystemMessage['content']
export function systemContent(
  content: SystemContent,
): SystemMessage['content'] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }]
  }
  if (Array.isArray(content)) {
    return content
  }
  return [content]
}

export function systemMessage(
  params:
    | SystemContent
    | ({
        content: SystemContent
      } & Omit<SystemMessage, 'role' | 'content'>),
): SystemMessage {
  if (typeof params === 'object' && 'content' in params) {
    return {
      ...params,
      role: 'system',
      content: systemContent(params.content),
    }
  }
  return {
    role: 'system',
    content: systemContent(params),
  }
}

export type UserContent =
  string | UserMessage['content'][number] | UserMessage['content']
export function userContent(content: UserContent): UserMessage['content'] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }]
  }
  if (Array.isArray(content)) {
    return content
  }
  return [content]
}

export function userMessage(
  params:
    | UserContent
    | ({
        content: UserContent
      } & Omit<UserMessage, 'role' | 'content'>),
): UserMessage {
  if (typeof params === 'object' && 'content' in params) {
    return {
      ...params,
      role: 'user',
      content: userContent(params.content),
      sentAt: Date.now(),
    }
  }
  return {
    role: 'user',
    content: userContent(params),
    sentAt: Date.now(),
  }
}

export type AssistantContent =
  string | AssistantMessage['content'][number] | AssistantMessage['content']
export function assistantContent(
  content: AssistantContent,
): AssistantMessage['content'] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }]
  }
  if (Array.isArray(content)) {
    return content
  }
  return [content]
}

export function assistantMessage(
  params:
    | AssistantContent
    | ({
        content: AssistantContent
      } & Omit<AssistantMessage, 'role' | 'content'>),
): AssistantMessage {
  if (typeof params === 'object' && 'content' in params) {
    return {
      ...params,
      role: 'assistant',
      content: assistantContent(params.content),
      sentAt: Date.now(),
    }
  }
  return {
    role: 'assistant',
    content: assistantContent(params),
    sentAt: Date.now(),
  }
}

export function jsonToolResult<T extends JSONValue>(
  value: T,
): [
  Extract<ToolResultOutput, { type: 'json' }> & {
    value: T
  },
] {
  return [
    {
      type: 'json',
      value,
    },
  ]
}

export function mediaToolResult(params: {
  data: string
  mediaType: string
}): [Extract<ToolResultOutput, { type: 'media' }>] {
  const { data, mediaType } = params
  return [
    {
      type: 'media',
      data,
      mediaType,
    },
  ]
}
