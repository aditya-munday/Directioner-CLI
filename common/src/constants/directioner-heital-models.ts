/**
 * Heital (Google Gemini) model variants.
 *
 * Configuration only — this module names model ids and their declared
 * capabilities; it does not build a provider or talk to the network. Execution
 * lives in `sdk/src/impl/model-provider.ts`, which is provider-generic and does
 * not change when a model is added. That separation is the point: adding a
 * Gemini variant is a data edit here, not a new branch in the agent runtime.
 *
 * Provider model ids are Google's own (`gemini-3.8-flash`) because the wire
 * request goes to Google's OpenAI-compatible endpoint. The Directioner catalog
 * id (`google/gemini-3.8-flash`) is kept alongside so the two naming schemes
 * can be mapped rather than guessed at.
 *
 * The list is deliberately not a closed set: `exampleModel` behaviour is
 * preserved — an unknown id is still forwarded, because Google's model list
 * changes and a hardcoded allowlist would reject valid models. These entries
 * describe the variants Directioner knows about well enough to show a label,
 * context window and honest capability flags.
 */

export interface HeitalModelVariant {
  /** Id sent to Google's OpenAI-compatible endpoint. */
  providerModelId: string
  /** The matching Directioner catalog id, when one exists. */
  directionerModelId?: string
  /** Short label for selection UI. */
  label: string
  /** Total context window in tokens. Conservative, provider-published value. */
  contextWindow: number
  /** Max tokens the model will emit in one response. */
  maxOutputTokens: number
  /** Declared capabilities — a claim about the wire, not about quality. */
  capabilities: HeitalCapabilities
}

export interface HeitalCapabilities {
  streaming: boolean
  /** Function/tool calling over the OpenAI-compatible `tools` field. */
  tools: boolean
  /** Image input on the wire. */
  images: boolean
  /** OpenAI-style `response_format: json_schema` structured output. */
  structuredOutputs: boolean
}

// Gemini Flash and Pro expose the same wire features over the OpenAI-compatible
// endpoint; the difference is capability of the model, not of the transport.
const GEMINI_OPENAI_COMPATIBLE: HeitalCapabilities = Object.freeze({
  streaming: true,
  tools: true,
  images: true,
  structuredOutputs: true,
})

export const HEITAL_MODEL_VARIANTS: readonly HeitalModelVariant[] = [
  {
    providerModelId: 'gemini-3.8-flash',
    directionerModelId: 'google/gemini-3.8-flash',
    label: 'Heital Flash 3.8',
    contextWindow: 1_000_000,
    maxOutputTokens: 65_536,
    capabilities: GEMINI_OPENAI_COMPATIBLE,
  },
  {
    providerModelId: 'gemini-3.7-flash',
    directionerModelId: 'google/gemini-3.7-flash',
    label: 'Heital Flash 3.7',
    contextWindow: 1_000_000,
    maxOutputTokens: 65_536,
    capabilities: GEMINI_OPENAI_COMPATIBLE,
  },
  {
    providerModelId: 'gemini-3.6-flash',
    directionerModelId: 'google/gemini-3.6-flash',
    label: 'Heital Flash 3.6',
    contextWindow: 1_000_000,
    maxOutputTokens: 65_536,
    capabilities: GEMINI_OPENAI_COMPATIBLE,
  },
  {
    providerModelId: 'gemini-3.5-flash',
    directionerModelId: 'google/gemini-3.5-flash',
    label: 'Heital Flash 3.5',
    contextWindow: 1_000_000,
    maxOutputTokens: 65_536,
    capabilities: GEMINI_OPENAI_COMPATIBLE,
  },
  {
    providerModelId: 'gemini-3.1-pro-preview',
    directionerModelId: 'google/gemini-3.1-pro-preview',
    label: 'Heital Pro 3.1 (preview)',
    contextWindow: 1_000_000,
    maxOutputTokens: 65_536,
    capabilities: GEMINI_OPENAI_COMPATIBLE,
  },
]

const BY_PROVIDER_ID = new Map(
  HEITAL_MODEL_VARIANTS.map((variant) => [variant.providerModelId, variant]),
)
const BY_DIRECTIONER_ID = new Map(
  HEITAL_MODEL_VARIANTS.filter((v) => v.directionerModelId).map((v) => [
    v.directionerModelId as string,
    v,
  ]),
)

/**
 * Look up a variant by either naming scheme. The `google/`-prefixed Directioner
 * id and Google's own id both resolve, so a config that mixed the two still
 * works instead of silently sending a prefixed id to Google.
 */
export function getHeitalVariant(id: string): HeitalModelVariant | undefined {
  const direct = BY_PROVIDER_ID.get(id) ?? BY_DIRECTIONER_ID.get(id)
  if (direct) return direct
  // Unknown ids are forwarded as-is, but a `google/` prefix is stripped so the
  // request still targets a real Google model id rather than 404ing on the
  // OpenRouter-style name.
  if (id.startsWith('google/')) {
    return BY_PROVIDER_ID.get(id.slice('google/'.length))
  }
  return undefined
}

/**
 * Normalize a user-supplied Heital model id to what the endpoint expects.
 * Returns the input unchanged when it is unknown: forward-compatibility with
 * models released after this build is preferable to rejecting them.
 */
export function normalizeHeitalModelId(model: string): string {
  const known = getHeitalVariant(model)
  if (known) return known.providerModelId
  return model.startsWith('google/') ? model.slice('google/'.length) : model
}
