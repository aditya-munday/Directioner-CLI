/**
 * Provider conformance suite.
 *
 * Shared properties every configured provider must satisfy, plus
 * protocol-specific properties asserted only where the protocol actually has
 * them. This is deliberately NOT a uniform matrix: Heital and Infernal speak
 * OpenAI's wire format, Eternal speaks Anthropic's Messages API, and the tests
 * say so rather than pretending the two behave identically.
 *
 * CLIENT-CONTRACT tests only. Passing this proves transport, error taxonomy and
 * stream handling. It says nothing about model intelligence, which needs a real
 * provider.
 */

import { afterEach, describe, expect, test } from 'bun:test'

import { getModelForRequest } from '../model-provider'

import {
  MOCK_CONNECTION,
  errorResponse,
  installMockProvider,
  jsonCompletion,
  sseResponse,
} from './testing/mock-provider'

import type { ResolvedByokConnection } from '../../byok'
import type { LanguageModelV2, LanguageModelV2CallOptions } from '@ai-sdk/provider'

const ORIGINAL_FETCH = globalThis.fetch
afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
})

const HEITAL: ResolvedByokConnection = {
  ...MOCK_CONNECTION,
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Heital',
  provider: 'heital',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  model: 'google/gemini-3.8-flash',
  apiKey: 'heital-key-canary',
  credentialRef: 'env:HEITAL_API_KEY',
}

const INFERNAL: ResolvedByokConnection = {
  ...MOCK_CONNECTION,
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Infernal',
  provider: 'infernal',
  baseUrl: 'https://api.groq.com/openai/v1',
  model: 'llama-3.3-70b-versatile',
  apiKey: 'infernal-key-canary',
  credentialRef: 'env:INFERNAL_API_KEY',
}

const ETERNAL: ResolvedByokConnection = {
  ...MOCK_CONNECTION,
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Eternal',
  provider: 'eternal',
  protocol: 'anthropic',
  baseUrl: 'https://api.anthropic.com/v1',
  model: 'claude-sonnet-4-5',
  apiKey: 'eternal-key-canary',
  credentialRef: 'env:ETERNAL_API_KEY',
}

function modelFor(connection: ResolvedByokConnection): LanguageModelV2 {
  return getModelForRequest({
    apiKey: 'hosted-key-must-not-be-sent',
    model: 'ignored',
    byok: connection,
  }) as LanguageModelV2
}

function textOptions(): LanguageModelV2CallOptions {
  return {
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'reply OK' }] }],
    maxOutputTokens: 128,
  }
}

/** Read every part from a provider stream, typed as the SDK's stream parts. */
async function drain<T>(stream: ReadableStream<T>): Promise<T[]> {
  const parts: T[] = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
  }
  return parts
}

function textOf(parts: Array<{ type: string; delta?: string }>): string {
  return parts
    .filter((p) => p.type === 'text-delta')
    .map((p) => p.delta ?? '')
    .join('')
}

/** Anthropic Messages API response shape. */
function anthropicBody(text = 'OK'): Record<string, unknown> {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-5',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 5, output_tokens: 3 },
  }
}

/** Anthropic SSE for a text delta. */
function anthropicSse(text: string): Response {
  const events = [
    { type: 'message_start', message: { id: 'msg_1', usage: { input_tokens: 1, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ]
  const body = events
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join('')
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

const OPENAI_COMPATIBLE = [
  { label: 'Heital (Gemini)', connection: HEITAL, path: '/chat/completions', authHeader: 'authorization' },
  { label: 'Infernal (Groq)', connection: INFERNAL, path: '/chat/completions', authHeader: 'authorization' },
] as const

describe('Provider conformance: transport guards (all protocols)', () => {
  for (const { label, connection, authHeader } of [
    ...OPENAI_COMPATIBLE,
    { label: 'Eternal (Claude)', connection: ETERNAL, path: '/messages', authHeader: 'x-api-key' },
  ]) {
    // Each protocol has its own success shape; a mismatch would throw before the
    // assertion runs and mask what the test is actually checking.
    const okBody = () =>
      Response.json(
        connection.protocol === 'anthropic' ? anthropicBody() : jsonCompletion({ text: 'OK' }),
      )

    test(`${label}: refuses redirects so the key cannot be forwarded to another host`, async () => {
      const mock = installMockProvider(okBody)
      await modelFor(connection).doGenerate(textOptions())
      expect(mock.captured[0].redirect).toBe('error')
    })

    test(`${label}: sends the key only in the ${authHeader} header, never the body`, async () => {
      const mock = installMockProvider(() =>
        Response.json(connection.protocol === 'anthropic' ? anthropicBody() : jsonCompletion({ text: 'OK' })),
      )
      await modelFor(connection).doGenerate(textOptions())
      const sent = mock.captured[0].headers[authHeader]
      expect(sent).toContain(connection.apiKey)
      if (authHeader === 'authorization') expect(sent).toContain('Bearer ')
      expect(JSON.stringify(mock.captured[0].body)).not.toContain(connection.apiKey)
      expect(JSON.stringify(mock.captured[0].body)).not.toContain('hosted-key-must-not-be-sent')
    })

    test(`${label}: attaches an abort signal to the provider request`, async () => {
      const mock = installMockProvider(okBody)
      await modelFor(connection).doGenerate({
        ...textOptions(),
        abortSignal: new AbortController().signal,
      })
      expect(mock.captured[0].hasSignal).toBe(true)
    })

    test(`${label}: a provider error body that echoes the key is redacted before it can surface`, async () => {
      const mock = installMockProvider(() =>
        errorResponse(400, {
          error: { message: `bad request for key ${connection.apiKey} on model x` },
        }),
      )
      let thrown: unknown
      try {
        await modelFor(connection).doGenerate(textOptions())
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeDefined()
      expect(JSON.stringify(thrown)).not.toContain(connection.apiKey)
    })
  }
})

describe('Provider conformance: OpenAI-compatible wire (Heital, Infernal)', () => {
  for (const { label, connection, path } of OPENAI_COMPATIBLE) {
    test(`${label}: posts to ${path}`, async () => {
      const mock = installMockProvider(() => Response.json(jsonCompletion({ text: 'hi' })))
      await modelFor(connection).doGenerate(textOptions())
      expect(mock.captured[0].url.endsWith(path)).toBe(true)
    })

    test(`${label}: 429 normalizes to an actionable rate-limit error without upstream text`, async () => {
      installMockProvider(() =>
        errorResponse(429, { error: { message: 'slow down secret-xyz' } }),
      )
      let message = ''
      try {
        await modelFor(connection).doGenerate(textOptions())
      } catch (error) {
        message = error instanceof Error ? error.message : String(error)
      }
      expect(message).toContain('429')
      expect(message.toLowerCase()).toContain('rate limit')
      expect(message).not.toContain('secret-xyz')
    })

    test(`${label}: 401 normalizes to a key error without echoing the key`, async () => {
      installMockProvider(() => errorResponse(401, { error: { message: 'invalid api key' } }))
      let message = ''
      try {
        await modelFor(connection).doGenerate(textOptions())
      } catch (error) {
        message = error instanceof Error ? error.message : String(error)
      }
      expect(message).toContain('401')
      expect(message).not.toContain(connection.apiKey)
    })

    test(`${label}: a malformed 200 body is rejected, not treated as a completion`, async () => {
      installMockProvider(
        () =>
          new Response('this is not json', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      )
      await expect(modelFor(connection).doGenerate(textOptions())).rejects.toBeDefined()
    })

    test(`${label}: forwards tool declarations on the wire`, async () => {
      const mock = installMockProvider(() => Response.json(jsonCompletion({ text: 'ok' })))
      await modelFor(connection).doGenerate({
        ...textOptions(),
        tools: [
          { type: 'function', name: 'read_files', inputSchema: { type: 'object', properties: {} } },
        ],
      })
      const body = mock.captured[0].body as { tools?: unknown[] }
      expect(Array.isArray(body.tools)).toBe(true)
      expect(JSON.stringify(body.tools)).toContain('read_files')
    })

    test(`${label}: streams text deltas`, async () => {
      installMockProvider(() =>
        sseResponse([
          JSON.stringify({
            id: 'c1',
            object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: { content: 'Hel' } }],
          }),
          JSON.stringify({
            id: 'c1',
            object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: { content: 'lo' }, finish_reason: 'stop' }],
          }),
        ]),
      )
      const { stream } = await modelFor(connection).doStream(textOptions())
      const parts = await drain(stream)
      expect(
        textOf(parts as Array<{ type: string; delta?: string }>),
      ).toBe('Hello')
    })
  }
})

describe('Provider conformance: Heital model-id normalization', () => {
  test('a Directioner catalog id is rewritten to Google’s model id on the wire', async () => {
    const mock = installMockProvider(() => Response.json(jsonCompletion({ text: 'ok' })))
    await modelFor(HEITAL).doGenerate(textOptions())
    expect((mock.captured[0].body as { model: string }).model).toBe('gemini-3.8-flash')
  })

  test('an unknown model id is forwarded unchanged (forward compatibility)', async () => {
    const mock = installMockProvider(() => Response.json(jsonCompletion({ text: 'ok' })))
    await modelFor({ ...HEITAL, model: 'gemini-9.9-future' }).doGenerate(textOptions())
    expect((mock.captured[0].body as { model: string }).model).toBe('gemini-9.9-future')
  })

  test('normalization is Heital-only: an Infernal model id is not rewritten', async () => {
    const mock = installMockProvider(() => Response.json(jsonCompletion({ text: 'ok' })))
    await modelFor(INFERNAL).doGenerate(textOptions())
    expect((mock.captured[0].body as { model: string }).model).toBe('llama-3.3-70b-versatile')
  })
})

describe('Provider conformance: Anthropic wire (Eternal)', () => {
  test('posts to the native /messages endpoint, not /chat/completions', async () => {
    const mock = installMockProvider(() => Response.json(anthropicBody()))
    await modelFor(ETERNAL).doGenerate(textOptions())
    expect(mock.captured[0].url.endsWith('/messages')).toBe(true)
    expect(mock.captured[0].url).not.toContain('/chat/completions')
  })

  test('streams text via Anthropic SSE', async () => {
    installMockProvider(() => anthropicSse('Hi'))
    const { stream } = await modelFor(ETERNAL).doStream(textOptions())
    const parts = await drain(stream)
    expect(textOf(parts as Array<{ type: string; delta?: string }>)).toBe('Hi')
  })

  test('a 401 is surfaced as an auth failure without the key', async () => {
    installMockProvider(() =>
      errorResponse(401, { type: 'error', error: { type: 'authentication_error', message: 'bad key' } }),
    )
    let thrown: unknown
    try {
      await modelFor(ETERNAL).doGenerate(textOptions())
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeDefined()
    expect(JSON.stringify(thrown)).not.toContain(ETERNAL.apiKey)
  })
})

describe('Provider conformance: shared failures', () => {
  test('a network failure is a key-free, actionable message (OpenAI-compatible)', async () => {
    installMockProvider(() => {
      throw new Error('ECONNREFUSED 127.0.0.1')
    })
    let message = ''
    try {
      await modelFor(INFERNAL).doGenerate(textOptions())
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain('Could not connect to the BYOK provider')
    expect(message).not.toContain('infernal-key-canary')
  })

  test('an interrupted stream surfaces an error rather than a clean completion', async () => {
    installMockProvider(() => {
      const encoder = new TextEncoder()
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                id: 'c1',
                object: 'chat.completion.chunk',
                choices: [{ index: 0, delta: { content: 'partial' } }],
              })}\n\n`,
            ),
          )
          controller.error(new Error('socket hang up'))
        },
      })
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    })

    let failed = false
    try {
      const { stream } = await modelFor(INFERNAL).doStream(textOptions())
      await drain(stream)
    } catch {
      failed = true
    }
    expect(failed).toBe(true)
  })
})
