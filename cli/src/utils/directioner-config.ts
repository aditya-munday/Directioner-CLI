/**
 * Load and validate the Directioner provider config.
 *
 * File I/O lives here (not in `common/`) so the shared constants stay pure and
 * testable. The API key value is never read or returned by this module — only
 * the environment variable NAME is carried, and resolution against the
 * environment happens separately in `resolveActiveProvider`.
 */

import fs from 'fs'
import path from 'path'

import {
  DirectionerConfigError,
  directionerConfigSchema,
  sampleConfig,
} from '@beyonders/common/constants/directioner-config'

import { getConfigDir } from './config-dir'

import type { DirectionerConfig } from '@beyonders/common/constants/directioner-config'

export const DIRECTIONER_CONFIG_FILE = 'config.json'

export function getDirectionerConfigPath(): string {
  return path.join(getConfigDir(), DIRECTIONER_CONFIG_FILE)
}

/** Human-readable instructions for a machine with no config yet. */
export function describeMissingConfig(): string {
  const configPath = getDirectionerConfigPath()
  const sample = JSON.stringify(sampleConfig(), null, 2)
  return [
    'Directioner developer preview.',
    '',
    'Production Directioner signs in to a Directioner account and runs against',
    'Directioner-owned model services, so you never configure a provider key.',
    'That backend is still being built.',
    '',
    'This preview is for local development and testing: it runs on a model',
    'provider you choose, and there is no Directioner account, hosted backend or',
    'ads in the request path. You configure a provider and your own key, and',
    'requests go from this machine straight to that provider.',
    '',
    'No provider is configured yet. Create',
    `  ${configPath}`,
    'with:',
    '',
    sample,
    '',
    'Then export the API key it names. The key is read from the environment at',
    'request time and is never written to disk:',
    `  export ${sampleConfig().providers[0]!.apiKeyEnvVar}=...`,
    '',
    'Providers: heital (Google Gemini), eternal (Anthropic Claude), infernal (Groq).',
    'Add a "baseUrl" to a provider to use a self-hosted or OpenAI-compatible',
    'endpoint; http is allowed only for localhost.',
    '',
    'The only data that leaves this machine is what you send to the provider',
    'above. Check the setup without opening the chat:',
    '  directioner --doctor          # config, key, endpoint reachability',
    '  directioner --doctor --ping   # also send one minimal request',
  ].join('\n')
}

/**
 * Read and validate the config.
 *
 * Returns `undefined` when the file does not exist, so a caller can present
 * setup instructions rather than an error. Throws `DirectionerConfigError` for
 * a file that exists but is invalid — those are different problems and deserve
 * different messages.
 */
export function loadDirectionerConfig(
  configPath: string = getDirectionerConfigPath(),
): DirectionerConfig | undefined {
  if (!fs.existsSync(configPath)) {
    return undefined
  }
  let raw: string
  try {
    raw = fs.readFileSync(configPath, 'utf8')
  } catch (error) {
    throw new DirectionerConfigError(
      `Could not read ${configPath}: ${(error as Error).message}`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new DirectionerConfigError(
      `${configPath} is not valid JSON: ${(error as Error).message}`,
    )
  }
  const result = directionerConfigSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
    throw new DirectionerConfigError(
      `${configPath} is not a valid Directioner config:\n${issues}`,
    )
  }
  return result.data
}
