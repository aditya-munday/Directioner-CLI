/**
 * Directioner configuration.
 *
 * A single JSON file names the provider(s) the user configured. The API key is
 * NEVER stored here — only the NAME of an environment variable. The value is
 * read from the environment at request time. This is the same discipline the
 * existing BYOK design uses, and it is deliberate: a config file is easy to
 * commit, copy or back up by accident, an environment variable is not.
 *
 * Location: `$DIRECTIONER_CONFIG_DIR/config.json` when set (must be absolute;
 * `HOSTED_CONFIG_DIR` is honoured as a fallback), otherwise
 * `~/.config/directioner/config.json`.
 */

import { z } from 'zod/v4'

import {
  DIRECTIONER_PROVIDERS,
  getProvider,
  isProviderId,
} from './directioner-providers'

/** A configured provider entry, as stored on disk. Contains no secrets. */
export const directionerProviderConfigSchema = z
  .object({
    /** One of the built-in provider ids: heital | eternal | infernal. */
    id: z.string().refine(isProviderId, {
      message: `Unknown provider id. Known providers: ${DIRECTIONER_PROVIDERS.map((p) => p.id).join(', ')}`,
    }),
    /** The model id to send, in the provider's own naming. */
    model: z.string().trim().min(1).max(256),
    /**
     * Environment variable name holding the API key. Validated as an
     * identifier, not as a value, so a pasted key cannot land here.
     */
    apiKeyEnvVar: z
      .string()
      .trim()
      .regex(
        /^[A-Za-z_][A-Za-z0-9_]*$/,
        'Must be an environment variable NAME, not a key value',
      ),
    /** Optional endpoint override (self-hosted or gateway). */
    baseUrl: z.url().max(2048).optional(),
  })
  .strict()

export const directionerConfigSchema = z
  .object({
    version: z.literal(1),
    providers: z.array(directionerProviderConfigSchema).min(1),
    /** Which configured provider requests use. */
    active: z.string().min(1),
  })
  .strict()
  .refine((config) => config.providers.some((p) => p.id === config.active), {
    message: 'active must name a configured provider',
    path: ['active'],
  })

export type DirectionerProviderConfig = z.infer<
  typeof directionerProviderConfigSchema
>
export type DirectionerConfig = z.infer<typeof directionerConfigSchema>

/**
 * A provider config with the registry defaults resolved and the environment
 * variable name looked up. `apiKey` is present only when the variable is set;
 * its absence is reported as a configuration error, not as an empty string.
 */
export interface DirectionerResolvedProvider {
  id: string
  displayName: string
  upstream: string
  protocol: 'openai-compatible' | 'anthropic'
  baseUrl: string
  model: string
  apiKeyEnvVar: string
  apiKey: string
  supportsImages: boolean
}

export class DirectionerConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DirectionerConfigError'
  }
}

/** Resolve one configured provider against the registry and the environment. */
export function resolveProvider(
  config: DirectionerProviderConfig,
  env: NodeJS.ProcessEnv = process.env,
): DirectionerResolvedProvider {
  const definition = getProvider(config.id)
  if (!definition) {
    throw new DirectionerConfigError(
      `Unknown provider "${config.id}". Configured providers: ${DIRECTIONER_PROVIDERS.map((p) => p.id).join(', ')}.`,
    )
  }
  const apiKey = env[config.apiKeyEnvVar]
  if (!apiKey) {
    throw new DirectionerConfigError(
      `${definition.displayName} needs its API key in $${config.apiKeyEnvVar}, which is not set. Export it and retry.`,
    )
  }
  return {
    id: definition.id,
    displayName: definition.displayName,
    upstream: definition.upstream,
    protocol: definition.protocol,
    baseUrl: (config.baseUrl ?? definition.defaultBaseUrl).replace(/\/+$/, ''),
    model: config.model,
    apiKeyEnvVar: config.apiKeyEnvVar,
    apiKey,
    supportsImages: definition.supportsImages,
  }
}

/** Resolve the active provider, or throw a message a user can act on. */
export function resolveActiveProvider(
  config: DirectionerConfig,
  env: NodeJS.ProcessEnv = process.env,
): DirectionerResolvedProvider {
  const entry = config.providers.find((p) => p.id === config.active)
  if (!entry) {
    throw new DirectionerConfigError(
      `No provider named "${config.active}" is configured.`,
    )
  }
  return resolveProvider(entry, env)
}

/** A starter config, to show the format rather than to be executed blindly. */
export function sampleConfig(): DirectionerConfig {
  return {
    version: 1,
    providers: [
      {
        id: 'heital',
        model: getProvider('heital')!.exampleModel,
        apiKeyEnvVar: 'HEITAL_API_KEY',
      },
    ],
    active: 'heital',
  }
}
