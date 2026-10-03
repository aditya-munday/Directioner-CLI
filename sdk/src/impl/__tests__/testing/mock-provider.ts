/**
 * Deterministic mock provider transport for client-contract testing.
 *
 * This is TEST ONLY. It is never imported by production source under cli/,
 * sdk/src (outside __tests__), packages/, or common/; `provider-mock-matrix`
 * and a source-import guard enforce that.
 *
 * There is no real provider in CI, so the provider-neutral properties of the
 * client were asserted only against a hand-rolled fetch double. This helper
 * makes the client-facing abstraction explicit: a request the client sends, a
 * body it parses, a fetch it observes.
 *
 * IMPORTANT DISTINCTION: passing these scenarios proves the *client contract*
 * (transport, error taxonomy, retry classification, streaming, usage). It does
 * NOT prove model intelligence. Real model quality requires a real provider or
 * backend and is out of scope here.
 */

import type { ResolvedByokConnection } from '../../../byok'

/** Shape captured from the request the client actually sent. */
export interface CapturedRequest {
  url: string
  method: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

export interface MockResult {
  captured: CapturedRequest
  /** Uses the captured request; the mock already answered. */
  response: Response
}

/** A JSON (non-streaming) chat completion body. */
export function jsonCompletion(params: {
  text?: string
  toolCalls?: Array<{ name: string; arguments: string }>
  finishReason?: string
  usage?: Record<string, number>
}): Record<string, unknown> {
  const message: Record<string, unknown> = { role: 'assistant' }
  if (params.toolCalls?.length) {
    message.content = null
    message.tool_calls = params.toolCalls.map((tc, i) => ({
      id: `call_${i}`,
      type: 'function',
      function: { name: tc.name, arguments: tc.arguments },
    }))
  } else {
    message.content = params.text ?? 'OK'
  }
  return {
    id: 'cmpl-mock-1',
    object: 'chat.completion',
    created: 1_700_000_000,
    model: 'mock-model',
    choices: [{ index: 0, message, finish_reason: params.finishReason ?? 'stop' }],
    ...(params.usage ? { usage: params.usage } : {}),
  }
}

/** Build SSE chunks for a streaming completion. */
export function sseChunks(
  deltas: Array<Record<string, unknown>>,
  opts: { finishReason?: string; usage?: Record<string, number>; done?: boolean } = {},
): string[] {
  const lines = deltas.map((delta) =>
    JSON.stringify({
      id: 'cmpl-mock-1',
      object: 'chat.completion.chunk',
      created: 1_700_000_000,
      model: 'mock-model',
      choices: [{ index: 0, delta }],
    }),
  )
  if (opts.finishReason) {
    lines.push(
      JSON.stringify({
        id: 'cmpl-mock-1',
        object: 'chat.completion.chunk',
        created: 1_700_000_000,
        model: 'mock-model',
        choices: [{ index: 0, delta: {}, finish_reason: opts.finishReason }],
        ...(opts.usage ? { usage: opts.usage } : {}),
      }),
    )
  }
  return lines
}

export function sseResponse(lines: string[], opts: { end?: 'done' | 'truncate' } = {}): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(`data: ${line}\n\n`))
      if (opts.end !== 'truncate') controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

export function errorResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

export const MOCK_CONNECTION: ResolvedByokConnection = {
  id: 'mock-connection',
  revision: 1,
  name: 'Mock',
  provider: 'openai-compatible',
  baseUrl: 'https://mock.invalid/v1/',
  model: 'mock-model',
  apiKey: 'mock-key-canary',
  credentialRef: 'env:MOCK_KEY',
  createdAt: 'x',
  updatedAt: 'x',
}

/**
 * Install a fetch double that captures the outgoing request and returns the
 * supplied responder's result. Restores the original fetch via `restore()`.
 */
export function installMockProvider(
  responder: (captured: CapturedRequest) => Response | Promise<Response>,
): { captured: CapturedRequest[]; restore: () => void } {
  const original = globalThis.fetch
  const captured: CapturedRequest[] = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const headers: Record<string, string> = {}
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value
    })
    let body: Record<string, unknown> = {}
    try {
      body = JSON.parse(String(init?.body ?? '{}'))
    } catch {
      body = {}
    }
    const record: CapturedRequest = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body,
    }
    captured.push(record)
    return responder(record)
  }) as unknown as typeof globalThis.fetch
  return { captured, restore: () => { globalThis.fetch = original } }
}
