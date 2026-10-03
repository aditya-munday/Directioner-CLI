import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'bun:test'

import {
  formatDoctorReport,
  runDirectionerDoctor,
} from '../directioner-doctor'

const dirs: string[] = []

function writeConfig(config: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'directioner-doctor-'))
  dirs.push(dir)
  const path = join(dir, 'config.json')
  writeFileSync(path, JSON.stringify(config))
  return path
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

const SECRET = 'sk-do-not-leak-this-value'

const validConfig = {
  version: 1,
  providers: [
    {
      id: 'heital',
      model: 'gemini-test-model',
      apiKeyEnvVar: 'TEST_PROVIDER_KEY',
      baseUrl: 'https://provider.test/v1',
    },
  ],
  active: 'heital',
}

/** A fetch that records requests and returns a fixed response. */
function stubFetch(
  respond: (url: string, init?: RequestInit) => Response,
): { fetch: typeof fetch; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    calls.push({ url, init })
    return respond(url, init)
  }) as typeof fetch
  return { fetch: fetchImpl, calls }
}

describe('runDirectionerDoctor', () => {
  test('reports a missing config as a failure with setup guidance', async () => {
    const report = await runDirectionerDoctor({
      configPath: join(tmpdir(), 'does-not-exist-directioner.json'),
    })
    expect(report.ok).toBe(false)
    expect(report.checks[0]!.name).toBe('config')
    expect(report.checks[0]!.status).toBe('fail')
    expect(report.checks[0]!.detail).toContain('no provider config')
  })

  test('reports an invalid config as a failure', async () => {
    const path = writeConfig({ version: 1, providers: [], active: 'x' })
    const report = await runDirectionerDoctor({ configPath: path })
    expect(report.ok).toBe(false)
    expect(report.checks[0]!.status).toBe('fail')
  })

  test('reports the provider, model and endpoint without the secret', async () => {
    const path = writeConfig(validConfig)
    const { fetch } = stubFetch(() => new Response('{}', { status: 200 }))
    const report = await runDirectionerDoctor({
      configPath: path,
      env: { TEST_PROVIDER_KEY: SECRET },
      fetchImpl: fetch,
    })

    expect(report.ok).toBe(true)
    const names = report.checks.map((c) => c.name)
    expect(names).toContain('provider')
    expect(names).toContain('credential')
    expect(names).toContain('endpoint')

    const provider = report.checks.find((c) => c.name === 'provider')!
    expect(provider.detail).toContain('gemini-test-model')
    expect(provider.detail).toContain('heital')

    // The credential line names the variable, never the value.
    const credential = report.checks.find((c) => c.name === 'credential')!
    expect(credential.detail).toContain('$TEST_PROVIDER_KEY')
    expect(credential.detail).not.toContain(SECRET)

    expect(formatDoctorReport(report)).not.toContain(SECRET)
  })

  test('fails when the key environment variable is unset', async () => {
    const path = writeConfig(validConfig)
    const { fetch, calls } = stubFetch(() => new Response('{}', { status: 200 }))
    const report = await runDirectionerDoctor({
      configPath: path,
      env: {},
      fetchImpl: fetch,
    })

    expect(report.ok).toBe(false)
    const provider = report.checks.find((c) => c.name === 'provider')!
    expect(provider.detail).toContain('TEST_PROVIDER_KEY')
    // No provider resolved, so no network probe was attempted.
    expect(calls).toEqual([])
  })

  test('rejects an unknown --provider id', async () => {
    const path = writeConfig(validConfig)
    const { fetch } = stubFetch(() => new Response('{}', { status: 200 }))
    const report = await runDirectionerDoctor({
      configPath: path,
      providerOverride: 'nope',
      env: { TEST_PROVIDER_KEY: SECRET },
      fetchImpl: fetch,
    })
    expect(report.ok).toBe(false)
    expect(report.checks.find((c) => c.name === 'provider')!.detail).toContain(
      'nope',
    )
  })

  test('reports an unreachable endpoint as a failure', async () => {
    const path = writeConfig(validConfig)
    const { fetch } = stubFetch(() => {
      throw new Error('ECONNREFUSED')
    })
    const report = await runDirectionerDoctor({
      configPath: path,
      env: { TEST_PROVIDER_KEY: SECRET },
      fetchImpl: fetch,
    })
    expect(report.ok).toBe(false)
    const reach = report.checks.find((c) => c.name === 'endpoint reachable')!
    expect(reach.status).toBe('fail')
    expect(reach.detail).toContain('provider.test')
  })

  test('--ping accepts a 2xx and never echoes the key', async () => {
    const path = writeConfig(validConfig)
    const { fetch, calls } = stubFetch(
      () => new Response('{"ok":true}', { status: 200 }),
    )
    const report = await runDirectionerDoctor({
      configPath: path,
      env: { TEST_PROVIDER_KEY: SECRET },
      fetchImpl: fetch,
      ping: true,
    })

    expect(report.ok).toBe(true)
    const ping = report.checks.find((c) => c.name === 'live request')!
    expect(ping.status).toBe('ok')
    expect(formatDoctorReport(report)).not.toContain(SECRET)

    // The probe used the same URL and bearer auth a turn would.
    const post = calls.find((c) => c.init?.method === 'POST')!
    expect(post.url).toBe('https://provider.test/v1/chat/completions')
    const headers = post.init!.headers as Record<string, string>
    expect(headers.authorization).toBe(`Bearer ${SECRET}`)
  })

  test('--ping classifies a rejected credential (401)', async () => {
    const path = writeConfig(validConfig)
    const { fetch } = stubFetch(
      () => new Response('unauthorized', { status: 401 }),
    )
    const report = await runDirectionerDoctor({
      configPath: path,
      env: { TEST_PROVIDER_KEY: SECRET },
      fetchImpl: fetch,
      ping: true,
    })
    expect(report.ok).toBe(false)
    const ping = report.checks.find((c) => c.name === 'live request')!
    expect(ping.status).toBe('fail')
    expect(ping.detail).toContain('TEST_PROVIDER_KEY')
    expect(ping.detail).not.toContain(SECRET)
  })

  test('--ping classifies a rejected model (404)', async () => {
    const path = writeConfig(validConfig)
    const { fetch } = stubFetch(
      () => new Response('no such model', { status: 404 }),
    )
    const report = await runDirectionerDoctor({
      configPath: path,
      env: { TEST_PROVIDER_KEY: SECRET },
      fetchImpl: fetch,
      ping: true,
    })
    expect(report.ok).toBe(false)
    const ping = report.checks.find((c) => c.name === 'live request')!
    expect(ping.detail).toContain('gemini-test-model')
  })

  test('--ping treats a rate limit (429) as a warning, not a failure', async () => {
    const path = writeConfig(validConfig)
    const { fetch } = stubFetch(() => new Response('slow down', { status: 429 }))
    const report = await runDirectionerDoctor({
      configPath: path,
      env: { TEST_PROVIDER_KEY: SECRET },
      fetchImpl: fetch,
      ping: true,
    })
    expect(report.ok).toBe(true)
    expect(report.checks.find((c) => c.name === 'live request')!.status).toBe(
      'warn',
    )
  })

  test('supports an http loopback endpoint for local models', async () => {
    const path = writeConfig({
      ...validConfig,
      providers: [
        {
          id: 'heital',
          model: 'local-model',
          apiKeyEnvVar: 'TEST_PROVIDER_KEY',
          baseUrl: 'http://localhost:11434/v1',
        },
      ],
    })
    const { fetch, calls } = stubFetch(() => new Response('{}', { status: 200 }))
    const report = await runDirectionerDoctor({
      configPath: path,
      env: { TEST_PROVIDER_KEY: SECRET },
      fetchImpl: fetch,
      ping: true,
    })
    expect(report.ok).toBe(true)
    expect(calls.some((c) => c.url.includes('localhost:11434'))).toBe(true)
  })
})
