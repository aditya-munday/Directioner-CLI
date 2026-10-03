/**
 * Streaming edge cases, driven through the real OpenAI-compatible client.
 *
 * Run brief §10: chunk ordering, empty chunk, duplicate chunk, malformed
 * chunk, finalization, and the invariant that a partial stream is never
 * reported as a clean completion. CLIENT CONTRACT tests, not model quality.
 */

import { afterEach, describe, expect, test } from 'bun:test'

import { getModelForRequest } from '../model-provider'

import { MOCK_CONNECTION, installMockProvider, sseChunks, sseResponse } from './testing/mock-provider'

import type { LanguageModelV2, LanguageModelV2CallOptions } from '@ai-sdk/provider'

const options: LanguageModelV2CallOptions = {
  prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
  maxOutputTokens: 256,
}

let restore: (() => void) | null = null
afterEach(() => {
  restore?.()
  restore = null
})

function model(): LanguageModelV2 {
  return getModelForRequest({
    apiKey: 'hosted-key-must-not-be-sent',
    model: 'ignored',
    byok: MOCK_CONNECTION,
  }) as LanguageModelV2
}

async function collect(responder: Parameters<typeof installMockProvider>[0]) {
  const mock = installMockProvider(responder)
  restore = mock.restore
  const { stream } = await model().doStream({ ...options })
  const reader = stream.getReader()
  let text = ''
  let finishReason: string | undefined
  let error: unknown
  const deltas: string[] = []
  while (true) {
    const next = await reader.read()
    if (next.done) break
    const part = next.value
    if (part.type === 'text-delta') {
      deltas.push(part.delta)
      text += part.delta
    } else if (part.type === 'finish') {
      finishReason = part.finishReason
    } else if (part.type === 'error') {
      error = part.error
    }
  }
  return { text, deltas, finishReason, error }
}

describe('streaming edge cases', () => {
  test('chunk ordering is preserved', async () => {
    const { deltas } = await collect(() =>
      sseResponse(sseChunks([{ content: 'a' }, { content: 'b' }, { content: 'c' }], { finishReason: 'stop' })),
    )
    // The client may coalesce, but concatenation order must be a-b-c.
    expect(deltas.join('')).toBe('abc')
  })

  test('empty deltas do not corrupt the text', async () => {
    const { text, finishReason } = await collect(() =>
      sseResponse(sseChunks([{ content: 'He' }, { content: '' }, { content: 'llo' }], { finishReason: 'stop' })),
    )
    expect(text).toBe('Hello')
    expect(finishReason).toBe('stop')
  })

  test('a duplicate chunk is delivered as-is (client does not dedupe silently)', async () => {
    // The transport must not invent de-duplication; that is a higher-layer
    // concern. Assert the raw order is preserved for the caller to handle.
    const { deltas } = await collect(() =>
      sseResponse(sseChunks([{ content: 'x' }, { content: 'x' }], { finishReason: 'stop' })),
    )
    expect(deltas.join('')).toBe('xx')
  })

  test('a malformed chunk mid-stream surfaces an error, not a silent truncation', async () => {
    const encoder = new TextEncoder()
    const good = sseChunks([{ content: 'partial' }])
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const line of good) controller.enqueue(encoder.encode(`data: ${line}\n\n`))
        controller.enqueue(encoder.encode('data: {not valid json}\n\n'))
        controller.enqueue(encoder.encode('data\n'))
        controller.close()
      },
    })
    const { error, finishReason } = await collect(
      () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    )
    expect(error).toBeDefined()
    expect(finishReason).not.toBe('stop')
  })

  test('a partial stream without a finish is not reported as stop', async () => {
    const { finishReason } = await collect(() =>
      sseResponse(sseChunks([{ content: 'cut off' }]), { end: 'truncate' }),
    )
    expect(finishReason).not.toBe('stop')
  })

  test('an in-band error chunk becomes an error part with a status', async () => {
    const { error } = await collect(() =>
      sseResponse([
        JSON.stringify({
          id: 'x',
          object: 'chat.completion.chunk',
          choices: [],
          error: { message: 'Provider returned error', code: 503, metadata: { raw: 'upstream down' } },
        }),
      ]),
    )
    expect(error).toBeDefined()
    expect(String((error as any)?.message ?? '')).toContain('upstream down')
  })

  test('streaming with tool calls still terminates cleanly', async () => {
    const { finishReason } = await collect(() =>
      sseResponse(
        sseChunks(
          [
            { tool_calls: [{ index: 0, id: 'call_0', type: 'function', function: { name: 'read_files', arguments: '' } }] },
            { tool_calls: [{ index: 0, function: { arguments: '{"paths":["a.ts"]}' } }] },
          ],
          { finishReason: 'tool_calls' },
        ),
      ),
    )
    expect(finishReason).toBe('tool-calls')
  })
})
