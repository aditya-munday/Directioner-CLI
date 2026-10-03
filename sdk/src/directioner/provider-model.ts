/**
 * Directioner provider model factory.
 *
 * Turns a resolved Directioner provider configuration into an AI SDK
 * `LanguageModel`. This replaces the Beyonders hosted gateway: there is no
 * fallback to any Beyonders/Directioner endpoint.
 *
 * Two wire protocols are supported:
 *
 *   openai-compatible — Heital (Gemini) and Infernal (Groq). These use the
 *     repo's own OpenAI-compatible client so provider metadata, usage and
 *     redaction behave exactly as the existing BYOK path already does.
 *
 *   anthropic — Eternal (Claude). Claude's native API is the Messages API;
 *     `https://api.anthropic.com/v1/chat/completions` returns 404, so this
 *     provider cannot use the OpenAI-compatible path and is built with the
 *     official `@ai-sdk/anthropic` provider instead.
 */

import { createAnthropic } from '@ai-sdk/anthropic'
import {
  OpenAICompatibleChatLanguageModel,
  VERSION,
} from '@beyonders/llm-providers/openai-compatible'

import type { DirectionerResolvedProvider } from '@beyonders/common/constants/directioner-config'

import type { LanguageModel } from 'ai'

/**
 * Redacts a credential from a provider error stream before it can reach logs.
 * Provider gateways commonly echo credential fragments in error bodies.
 */
export function redactProviderStream(
  body: ReadableStream<Uint8Array> | null,
  secret: string,
): ReadableStream<Uint8Array> | null {
  if (!body || !secret) return body
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const text = decoder.decode(chunk, { stream: true })
        controller.enqueue(encoder.encode(text.split(secret).join('[redacted]')))
      },
    }),
  )
}

/**
 * Build the language model for a resolved provider.
 *
 * `apiKey` is passed in rather than read here so the caller controls where the
 * secret comes from (environment variable name resolution) and this function
 * stays pure.
 */
export function getDirectionerModel(
  provider: DirectionerResolvedProvider,
  apiKey: string,
): LanguageModel {
  if (provider.protocol === 'anthropic') {
    const anthropic = createAnthropic({
      apiKey,
      baseURL: provider.baseUrl,
    })
    return anthropic(provider.model)
  }

  return new OpenAICompatibleChatLanguageModel(provider.model, {
    provider: 'directioner',
    url: () => `${provider.baseUrl}/chat/completions`,
    headers: () => ({
      Authorization: `Bearer ${apiKey}`,
      'user-agent': `ai-sdk/openai-compatible/${VERSION}/directioner`,
    }),
    // Never follow a redirect: a provider that 302s could hand the request,
    // including the bearer token, to an arbitrary host.
    fetch: (async (...args: Parameters<typeof globalThis.fetch>) => {
      const response = await globalThis.fetch(args[0], {
        ...(args[1] ?? {}),
        redirect: 'error',
      })
      return new Response(redactProviderStream(response.body, apiKey), {
        status: response.status,
        headers: {
          'content-type':
            response.headers.get('content-type') ?? 'text/event-stream',
        },
      })
    }) as typeof globalThis.fetch,
    includeUsage: true,
    supportsStructuredOutputs: true,
  })
}
