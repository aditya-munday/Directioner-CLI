/**
 * Directioner provider registry.
 *
 * Directioner talks only to model providers the user configured. This module is
 * the single source of truth for the built-in providers, and it is deliberately
 * self-contained: it must not import anything from the Beyonders/Directioner
 * product surface.
 *
 * Three providers are built in:
 *
 *   Heital   — Google Gemini, over its OpenAI-compatible endpoint.
 *   Eternal  — Anthropic Claude, over Anthropic's native Messages API. Claude
 *              does NOT expose an OpenAI-compatible /chat/completions endpoint
 *              (it 404s), so it cannot use the OpenAI-compatible path and needs
 *              a native adapter.
 *   Infernal — Groq, over its OpenAI-compatible endpoint.
 *
 * The custom product names are what the user sees. Each entry records the
 * upstream company, so a user can still tell what they are configuring.
 */

/** Wire protocol a provider speaks. */
export type DirectionerWireProtocol = 'openai-compatible' | 'anthropic'

export type DirectionerProviderId = 'heital' | 'eternal' | 'infernal'

export interface DirectionerProviderDefinition {
  /** Stable id, used in config files and commands. */
  id: DirectionerProviderId
  /** Product name shown to the user. */
  displayName: string
  /** Upstream company, for transparency about where requests go. */
  upstream: string
  /** Which wire protocol the client must use. */
  protocol: DirectionerWireProtocol
  /**
   * Default base URL. Every provider here is hosted; a user may override this
   * to point at a self-hosted or gateway endpoint speaking the same protocol.
   */
  defaultBaseUrl: string
  /**
   * Default environment variable name holding the API key. The value is read
   * from the environment at request time and never written to disk by
   * Directioner.
   */
  defaultApiKeyEnvVar: string
  /**
   * A model id that is expected to exist. Kept as an example, not a constraint:
   * the provider's model list is not enumerated here, because a hardcoded list
   * goes stale and would reject valid models.
   */
  exampleModel: string
  /** Whether the endpoint can accept image input on the wire. */
  supportsImages: boolean
}

export const DIRECTIONER_PROVIDERS: readonly DirectionerProviderDefinition[] = [
  {
    id: 'heital',
    displayName: 'Heital',
    upstream: 'Google Gemini',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultApiKeyEnvVar: 'HEITAL_API_KEY',
    exampleModel: 'gemini-3.8-flash',
    supportsImages: true,
  },
  {
    id: 'eternal',
    displayName: 'Eternal',
    upstream: 'Anthropic Claude',
    protocol: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultApiKeyEnvVar: 'ETERNAL_API_KEY',
    exampleModel: 'claude-sonnet-4-5',
    supportsImages: true,
  },
  {
    id: 'infernal',
    displayName: 'Infernal',
    upstream: 'Groq',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    defaultApiKeyEnvVar: 'INFERNAL_API_KEY',
    exampleModel: 'llama-3.3-70b-versatile',
    supportsImages: false,
  },
] as const

const BY_ID = new Map(DIRECTIONER_PROVIDERS.map((p) => [p.id, p]))

export function getProvider(
  id: string,
): DirectionerProviderDefinition | undefined {
  return BY_ID.get(id as DirectionerProviderId)
}

export function isProviderId(id: string): id is DirectionerProviderId {
  return BY_ID.has(id as DirectionerProviderId)
}

/** Product names, for error copy that should not mention upstream vendors. */
export function providerDisplayName(id: string): string {
  return getProvider(id)?.displayName ?? id
}
