/**
 * Bridge a Directioner provider config to the SDK's local-inference connection.
 *
 * The SDK's BYOK path (`ResolvedByokConnection`) is the one that both streams
 * locally and threads the connection through every helper and subagent. Rather
 * than build a second inference path, Directioner resolves its own provider
 * config into that shape. The provider id becomes the connection's `provider`
 * label (which is why `providerSchema` accepts the Directioner ids) and the
 * wire protocol is carried on the runtime-only `protocol` field.
 */

import { randomUUID } from 'node:crypto'

import {
  DirectionerConfigError,
  resolveActiveProvider,
} from '@beyonders/common/constants/directioner-config'

import { loadDirectionerConfig } from './directioner-config'

import type {
  DirectionerResolvedProvider,
} from '@beyonders/common/constants/directioner-config'
import type { ResolvedByokConnection } from '@beyonders/sdk'

let runProviderOverride: string | undefined

/** Record the `--provider` id for this run, set once at startup. */
export function setDirectionerProviderOverride(id?: string): void {
  runProviderOverride = id
}

/**
 * Resolve the active provider, or `undefined` when no config file exists yet.
 *
 * A config file that exists but is invalid throws, so the caller reports the
 * real problem ("not valid JSON", "unknown provider id") rather than the
 * generic "no provider configured". Absence is the one case worth a silent
 * fallthrough: it is the first-run path that shows setup instructions.
 */
export function tryDirectionerByok(
  providerIdOverride: string | undefined = runProviderOverride,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedByokConnection | undefined {
  if (!loadDirectionerConfig()) {
    return undefined
  }
  return resolveDirectionerByok(providerIdOverride, env)
}

/**
 * Load the config, pick the active provider (or the one named by `--provider`),
 * and resolve its key from the environment.
 *
 * Throws `DirectionerConfigError` with a message the user can act on: no config
 * file, an unknown `--provider` id, or an unset key environment variable.
 */
export function resolveDirectionerByok(
  providerIdOverride?: string,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedByokConnection {
  const config = loadDirectionerConfig()
  if (!config) {
    throw new DirectionerConfigError(
      'No Directioner provider is configured. Run once to see setup instructions.',
    )
  }

  let activeId = config.active
  if (providerIdOverride) {
    if (!config.providers.some((p) => p.id === providerIdOverride)) {
      const configured = config.providers.map((p) => p.id).join(', ')
      throw new DirectionerConfigError(
        `--provider "${providerIdOverride}" is not configured. Configured providers: ${configured}.`,
      )
    }
    activeId = providerIdOverride
  }

  const resolved = resolveActiveProvider({ ...config, active: activeId }, env)
  return toByokConnection(resolved)
}

/** Map a resolved Directioner provider onto the SDK connection shape. */
export function toByokConnection(
  provider: DirectionerResolvedProvider,
): ResolvedByokConnection {
  return {
    id: randomUUID(),
    revision: 1,
    name: provider.displayName,
    // The SDK's stored schema enumerates its own two labels; the Directioner
    // ids are accepted at runtime and never persisted.
    provider: provider.id as ResolvedByokConnection['provider'],
    model: provider.model,
    baseUrl: provider.baseUrl,
    credentialRef: `env:${provider.apiKeyEnvVar}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    apiKey: provider.apiKey,
    ...(provider.protocol === 'anthropic'
      ? { protocol: 'anthropic' as const }
      : {}),
  }
}
