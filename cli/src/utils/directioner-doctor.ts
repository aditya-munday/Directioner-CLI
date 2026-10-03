/**
 * `directioner --doctor`: a pre-flight report for the BYOK setup.
 *
 * Directioner's first-run and failure states are configuration states — no
 * config, an unset key variable, an unreachable endpoint, a model the provider
 * rejects. Each is actionable, but only if the user can see which one they are
 * in. This command answers, without opening the TUI:
 *
 *   - which config file is in use, and whether it parses;
 *   - which provider, upstream, model and endpoint the run would use;
 *   - whether the key environment variable is set (never its value);
 *   - whether the endpoint is reachable;
 *   - with `--ping`, whether a real minimal request is accepted.
 *
 * The API key is read from the environment and put only into an Authorization
 * header. It is never returned, logged, or rendered — the report carries the
 * variable NAME and a boolean, never the secret. The `fetch` implementation is
 * injectable so the checks can be tested without touching the network.
 */

import {
  DirectionerConfigError,
  resolveActiveProvider,
} from '@beyonders/common/constants/directioner-config'
import { normalizeByokBaseUrl } from '@beyonders/sdk'

import type { ByokProvider } from '@beyonders/sdk'

import { loadDirectionerConfig } from './directioner-config'

import type {
  DirectionerConfig,
  DirectionerResolvedProvider,
} from '@beyonders/common/constants/directioner-config'

export type DoctorStatus = 'ok' | 'warn' | 'fail' | 'info'

export interface DoctorCheck {
  name: string
  status: DoctorStatus
  detail: string
}

export interface DoctorReport {
  checks: DoctorCheck[]
  /** True when no check failed. Warnings (e.g. an unverified auth) do not fail. */
  ok: boolean
}

export interface DoctorOptions {
  /** The `--provider` id for this run, if any. */
  providerOverride?: string
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
  /** Also send a real minimal request to confirm auth and model acceptance. */
  ping?: boolean
  configPath?: string
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 10_000

/** Host for display; never includes credentials or query. */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function resolveProviderForReport(
  config: DirectionerConfig,
  providerOverride: string | undefined,
  env: NodeJS.ProcessEnv,
): DirectionerResolvedProvider {
  let activeId = config.active
  if (providerOverride) {
    if (!config.providers.some((p) => p.id === providerOverride)) {
      const configured = config.providers.map((p) => p.id).join(', ')
      throw new DirectionerConfigError(
        `--provider "${providerOverride}" is not configured. Configured providers: ${configured}.`,
      )
    }
    activeId = providerOverride
  }
  return resolveActiveProvider({ ...config, active: activeId }, env)
}

/** Probe reachability: any HTTP response means the host answered. */
async function checkReachability(
  provider: DirectionerResolvedProvider,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<DoctorCheck> {
  const base = normalizeByokBaseUrl(provider.id as ByokProvider, provider.baseUrl)
  const host = hostOf(base)
  try {
    const response = await fetchWithTimeout(
      fetchImpl,
      base,
      { method: 'GET', redirect: 'error' },
      timeoutMs,
    )
    return {
      name: 'endpoint reachable',
      status: 'ok',
      detail: `${host} answered (HTTP ${response.status})`,
    }
  } catch (error) {
    const message = (error as Error).name === 'AbortError'
      ? `timed out after ${timeoutMs}ms`
      : (error as Error).message
    return {
      name: 'endpoint reachable',
      status: 'fail',
      detail: `cannot reach ${host}: ${message}`,
    }
  }
}

/**
 * A real, minimal request that exercises the same URL, auth header and body
 * shape a turn uses. A 2xx proves the key is accepted and the model exists;
 * anything else is classified so the user knows which of the two to change.
 */
async function checkPing(
  provider: DirectionerResolvedProvider,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<DoctorCheck> {
  const host = hostOf(provider.baseUrl)
  let url: string
  let init: RequestInit
  if (provider.protocol === 'anthropic') {
    url = `${normalizeByokBaseUrl(provider.id as ByokProvider, provider.baseUrl)}/messages`
    init = {
      method: 'POST',
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        'x-api-key': provider.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    }
  } else {
    url = `${normalizeByokBaseUrl(provider.id as ByokProvider, provider.baseUrl)}/chat/completions`
    init = {
      method: 'POST',
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    }
  }

  let response: Response
  try {
    response = await fetchWithTimeout(fetchImpl, url, init, timeoutMs)
  } catch (error) {
    const message = (error as Error).name === 'AbortError'
      ? `timed out after ${timeoutMs}ms`
      : (error as Error).message
    return {
      name: 'live request',
      status: 'fail',
      detail: `request to ${host} failed: ${message}`,
    }
  }

  if (response.ok) {
    return {
      name: 'live request',
      status: 'ok',
      detail: `${host} accepted the key and model "${provider.model}"`,
    }
  }
  if (response.status === 401 || response.status === 403) {
    return {
      name: 'live request',
      status: 'fail',
      detail: `${host} rejected the credential (HTTP ${response.status}); check $${provider.apiKeyEnvVar}`,
    }
  }
  if (response.status === 404 || response.status === 422) {
    return {
      name: 'live request',
      status: 'fail',
      detail: `${host} did not accept model "${provider.model}" (HTTP ${response.status}); set a model the provider serves`,
    }
  }
  if (response.status === 429) {
    return {
      name: 'live request',
      status: 'warn',
      detail: `${host} rate-limited the probe (HTTP 429); the credential and model are otherwise valid`,
    }
  }
  return {
    name: 'live request',
    status: 'warn',
    detail: `${host} answered HTTP ${response.status}`,
  }
}

/**
 * Run every check and return a report. Static checks run first; the network
 * checks run only once a provider has resolved, so a missing key is reported as
 * that, not as an unreachable endpoint.
 */
export async function runDirectionerDoctor(
  options: DoctorOptions = {},
): Promise<DoctorReport> {
  const env = options.env ?? process.env
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const checks: DoctorCheck[] = []

  const config = (() => {
    try {
      return loadDirectionerConfig(options.configPath)
    } catch (error) {
      checks.push({
        name: 'config',
        status: 'fail',
        detail: (error as Error).message,
      })
      return null
    }
  })()

  if (config === null) {
    return { checks, ok: false }
  }
  if (config === undefined) {
    checks.push({
      name: 'config',
      status: 'fail',
      detail:
        'no provider config found; run `directioner` once to see the setup template, or see the README "Configure" section',
    })
    return { checks, ok: false }
  }

  checks.push({
    name: 'config',
    status: 'ok',
    detail: `${config.providers.length} provider(s) configured; active "${config.active}"`,
  })

  let provider: DirectionerResolvedProvider
  try {
    provider = resolveProviderForReport(config, options.providerOverride, env)
  } catch (error) {
    checks.push({
      name: 'provider',
      status: 'fail',
      detail: (error as Error).message,
    })
    return { checks, ok: false }
  }

  checks.push({
    name: 'provider',
    status: 'ok',
    detail: `${provider.displayName} [${provider.id}] · model "${provider.model}" · ${provider.protocol}`,
  })
  checks.push({
    name: 'credential',
    status: 'ok',
    detail: `$${provider.apiKeyEnvVar} is set (value never displayed)`,
  })
  checks.push({
    name: 'endpoint',
    status: 'ok',
    detail: provider.baseUrl,
  })

  checks.push(await checkReachability(provider, fetchImpl, timeoutMs))
  if (options.ping) {
    checks.push(await checkPing(provider, fetchImpl, timeoutMs))
  } else {
    checks.push({
      name: 'live request',
      status: 'info',
      detail: 'skipped; re-run with --doctor --ping to send one minimal request',
    })
  }

  return { checks, ok: !checks.some((c) => c.status === 'fail') }
}

/** Render a report as plain text. Never includes a secret. */
export function formatDoctorReport(report: DoctorReport): string {
  const mark: Record<DoctorStatus, string> = {
    ok: '✓',
    warn: '!',
    fail: '✗',
    info: '·',
  }
  const lines = [
    'Directioner doctor — checks the provider this machine would run on.',
    '',
    ...report.checks.map((c) => `  ${mark[c.status]} ${c.name}: ${c.detail}`),
    '',
    report.ok
      ? 'All checks passed.'
      : 'Some checks failed. Fix the ✗ lines above, then re-run.',
  ]
  return lines.join('\n')
}
