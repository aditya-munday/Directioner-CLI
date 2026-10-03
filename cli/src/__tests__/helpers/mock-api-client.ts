import { mock } from 'bun:test'

import type { BeyondersApiClient } from '../../utils/beyonders-api'

export interface MockApiClientOverrides {
  get?: ReturnType<typeof mock>
  post?: ReturnType<typeof mock>
  put?: ReturnType<typeof mock>
  patch?: ReturnType<typeof mock>
  delete?: ReturnType<typeof mock>
  request?: ReturnType<typeof mock>
  me?: ReturnType<typeof mock>
  usage?: ReturnType<typeof mock>
  loginCode?: ReturnType<typeof mock>
  loginStatus?: ReturnType<typeof mock>
  publish?: ReturnType<typeof mock>
  logout?: ReturnType<typeof mock>
  feedback?: ReturnType<typeof mock>
  baseUrl?: string
  authToken?: string
}

/**
 * Default OK response for mock API methods.
 * Returns { ok: true, status: 200 } without data, matching our ApiResponse type
 * where `data` is optional for responses without a body.
 */
const defaultOkResponse = () =>
  Promise.resolve({ ok: true as const, status: 200 })

/**
 * Creates a mock BeyondersApiClient with sensible defaults.
 * All methods return { ok: true, status: 200 } by default.
 * Pass overrides to customize specific methods.
 */
export const createMockApiClient = (
  overrides: MockApiClientOverrides = {},
): BeyondersApiClient => ({
  get: (overrides.get ?? mock(defaultOkResponse)) as BeyondersApiClient['get'],
  post: (overrides.post ??
    mock(defaultOkResponse)) as BeyondersApiClient['post'],
  put: (overrides.put ?? mock(defaultOkResponse)) as BeyondersApiClient['put'],
  patch: (overrides.patch ??
    mock(defaultOkResponse)) as BeyondersApiClient['patch'],
  delete: (overrides.delete ??
    mock(defaultOkResponse)) as BeyondersApiClient['delete'],
  request: (overrides.request ??
    mock(defaultOkResponse)) as BeyondersApiClient['request'],
  me: (overrides.me ?? mock(defaultOkResponse)) as BeyondersApiClient['me'],
  usage: (overrides.usage ??
    mock(defaultOkResponse)) as BeyondersApiClient['usage'],
  loginCode: (overrides.loginCode ??
    mock(defaultOkResponse)) as BeyondersApiClient['loginCode'],
  loginStatus: (overrides.loginStatus ??
    mock(defaultOkResponse)) as BeyondersApiClient['loginStatus'],
  publish: (overrides.publish ??
    mock(defaultOkResponse)) as BeyondersApiClient['publish'],
  logout: (overrides.logout ??
    mock(defaultOkResponse)) as BeyondersApiClient['logout'],
  feedback: (overrides.feedback ??
    mock(defaultOkResponse)) as BeyondersApiClient['feedback'],
  baseUrl: overrides.baseUrl ?? 'https://test.beyonders.com',
  authToken: overrides.authToken,
})
