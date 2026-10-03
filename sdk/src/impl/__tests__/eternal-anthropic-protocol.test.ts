/**
 * Native Anthropic-protocol (Eternal) client-contract tests.
 *
 * The Eternal provider speaks Anthropic's Messages API, which is not
 * OpenAI-compatible, so `getModelForRequest` builds it with `createAnthropic`
 * instead of the OpenAI-compatible client. That branch had no test coverage;
 * these tests drive it through a deterministic fetch double and assert the
 * native request/response shape normalizes into the shared client abstraction.
 *
 * CLIENT CONTRACT tests only — not a claim about model quality.
 */

import { afterEach, describe, expect, test } from 'bun:test'

import { getModelForRequest } from '../model-provider'

import { installMockProvider } from './testing/mock-provider'

import type { LanguageModelV2, LanguageModelV2CallOptions } from '@ai-sdk/provider'
import type { ResolvedByokConnection } from '../../byok'

const ETERNAL: ResolvedByokConnection = {
  id: 'eternal-1',
  revision: 1,
  name: 'Eternal',
  provider: 'eternal',
  baseUrl: 'https://api.anthropic.example/v1',
  model: 'claude-sonnet-4-5',
  apiKey: 'eternal-key-canary',
  credentialRef: 'env:ETERNAL_API_KEY',
  protocol: 'anthropic',
  createdAt: 'x',
  updatedAt: 'x',
}

// Anthropic Messages API response shape.
function messagesBody(params: {
  text?: string
  toolUse?: { name: string; input: unknown }
  stopReason?: string
  usage?: { input_tokens: number; output_tokens: number }
}): Record<string, unknown> {
  const content: unknown[] = []
  if (params.toolUse) {
    content.push({
      type: 'tool_use',
      id: 'toolu_1',
      name: params.toolUse.name,
      input: params.toolUse.input,
    })
  } else {
    content.push({ type: 'text', text: params.text ?? 'OK' })
  }
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-5',
    content,
    stop_reason: params.stopReason ?? 'end_turn',
    usage: params.usage ?? { input_tokens: 5, output_tokens: 3 },
  }
}

const options: LanguageModelV2CallOptions = {
  prompt: [
    { role: 'system', content: 'You are helpful.' },
    { role: 'user', content: [{ type: 'text', text: 'hi' }] },
  ],
  maxOutputTokens: 256,
}

let restore: (() => void) | null = null
afterEach(() => {
  restore?.()
  restore = null
})

function eternal(overrides: Partial<ResolvedByokConnection> = {}) {
  return getModelForRequest({
    apiKey: 'hosted-key-must-not-be-sent',
    model: 'ignored',
    byok: { ...ETERNAL, ...overrides },
  }) as LanguageModelV2
}

describe('Eternal / Anthropic protocol: request shape', () => {
  test('posts to the native /messages endpoint with the anthropic-version header', async () => {
    const mock = installMockProvider(() => Response.json(messagesBody({ text: 'OK' })))
    restore = mock.restore
    await eternal().doGenerate({ ...options })
    expect(mock.captured[0].url).toBe('https://api.anthropic.example/v1/messages')
    expect(mock.captured[0].headers['x-api-key']).toBe('eternal-key-canary')
    expect(mock.captured[0].headers['anthropic-version']).toBeDefined()
  })

  test('does not leak the hosted key and does not use a vendor OpenAI path', async () => {
    const mock = installMockProvider(() => Response.json(messagesBody({ text: 'OK' })))
    restore = mock.restore
    await eternal().doGenerate({ ...options })
    expect(mock.captured[0].url).not.toContain('/chat/completions')
    expect(JSON.stringify(mock.captured[0].body)).not.toContain('hosted-key-must-not-be-sent')
    expect(JSON.stringify(mock.captured[0].body)).not.toContain('eternal-key-canary')
  })

  test('system prompt is lifted into the top-level system field, not messages', async () => {
    const mock = installMockProvider(() => Response.json(messagesBody({ text: 'OK' })))
    restore = mock.restore
    await eternal().doGenerate({ ...options })
    const body = mock.captured[0].body as any
    expect(body.system).toBeDefined()
    expect(body.messages.every((m: any) => m.role !== 'system')).toBe(true)
  })
})

describe('Eternal / Anthropic protocol: response normalization', () => {
  test('text content normalizes into the shared content part', async () => {
    const mock = installMockProvider(() => Response.json(messagesBody({ text: 'Hello' })))
    restore = mock.restore
    const result = await eternal().doGenerate({ ...options })
    expect(result.content).toContainEqual({ type: 'text', text: 'Hello' })
    expect(result.finishReason).toBe('stop')
  })

  test('tool_use normalizes into a tool-call part with parsed input', async () => {
    const mock = installMockProvider(() =>
      Response.json(messagesBody({ toolUse: { name: 'read_files', input: { paths: ['a.ts'] } }, stopReason: 'tool_use' })),
    )
    restore = mock.restore
    const result = await eternal().doGenerate({ ...options })
    const call = result.content.find((p: any) => p.type === 'tool-call') as any
    expect(call).toBeDefined()
    expect(call.toolName).toBe('read_files')
    expect(JSON.parse(call.input)).toEqual({ paths: ['a.ts'] })
    expect(result.finishReason).toBe('tool-calls')
  })

  test('usage input/output tokens are surfaced', async () => {
    const mock = installMockProvider(() =>
      Response.json(messagesBody({ text: 'OK', usage: { input_tokens: 42, output_tokens: 8 } })),
    )
    restore = mock.restore
    const result = await eternal().doGenerate({ ...options })
    expect(result.usage.inputTokens).toBe(42)
    expect(result.usage.outputTokens).toBe(8)
  })

  test('stop_reason max_tokens normalizes to length', async () => {
    const mock = installMockProvider(() =>
      Response.json(messagesBody({ text: 'x', stopReason: 'max_tokens' })),
    )
    restore = mock.restore
    const result = await eternal().doGenerate({ ...options })
    expect(result.finishReason).toBe('length')
  })
})

describe('Eternal / Anthropic protocol: failures', () => {
  test('an HTTP 400 refusal is not a fabricated success', async () => {
    const mock = installMockProvider(() =>
      Response.json({ type: 'error', error: { type: 'invalid_request_error', message: 'bad' } }, { status: 400 }),
    )
    restore = mock.restore
    await expect(eternal().doGenerate({ ...options })).rejects.toThrow()
  })

  test('a malformed body is a hard failure', async () => {
    const mock = installMockProvider(
      () => new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    restore = mock.restore
    await expect(eternal().doGenerate({ ...options })).rejects.toThrow()
  })
})
