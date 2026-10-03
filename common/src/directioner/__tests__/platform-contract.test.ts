import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  classifyError,
  recoveryForError,
} from '../platform-contract'

import type { DirectionerErrorCode } from '../platform-contract'

const ALL_CODES: DirectionerErrorCode[] = [
  'AUTH_REQUIRED',
  'AUTH_EXPIRED',
  'DEVICE_REVOKED',
  'SESSION_REVOKED',
  'BACKEND_UNAVAILABLE',
  'MODEL_SERVICE_UNAVAILABLE',
  'UNSUPPORTED_VERSION',
  'ENTITLEMENT_DENIED',
  'RATE_LIMITED',
  'APPROVAL_REQUIRED',
  'TASK_NOT_FOUND',
  'TASK_STATE_INVALID',
  'SYNC_FAILED',
  'LOCAL_EXECUTION_FAILED',
]

describe('error classification', () => {
  test('every code maps to a recovery', () => {
    for (const code of ALL_CODES) {
      expect(typeof recoveryForError(code)).toBe('string')
    }
  })

  test('an expired session says "authenticate", not "retry"', () => {
    // The whole point of the taxonomy: a misclassification here would tell the
    // user to retry a request that can never succeed.
    expect(recoveryForError('AUTH_EXPIRED')).toBe('authenticate')
    expect(classifyError('AUTH_EXPIRED', 'session expired').retryable).toBe(
      false,
    )
  })

  test('a revoked device says "register_device", not "authenticate"', () => {
    expect(recoveryForError('DEVICE_REVOKED')).toBe('register_device')
  })

  test('only transient codes are retryable', () => {
    expect(classifyError('BACKEND_UNAVAILABLE', 'down').retryable).toBe(true)
    expect(classifyError('MODEL_SERVICE_UNAVAILABLE', 'down').retryable).toBe(
      true,
    )
    expect(classifyError('RATE_LIMITED', 'slow down').retryable).toBe(true)
    // Not transient: retrying cannot help.
    expect(classifyError('ENTITLEMENT_DENIED', 'nope').retryable).toBe(false)
    expect(classifyError('UNSUPPORTED_VERSION', 'old').retryable).toBe(false)
    expect(classifyError('TASK_NOT_FOUND', 'gone').retryable).toBe(false)
    expect(classifyError('TASK_STATE_INVALID', 'bad move').retryable).toBe(
      false,
    )
    expect(classifyError('LOCAL_EXECUTION_FAILED', 'boom').retryable).toBe(false)
  })

  test('rate limiting carries a retry delay and a correlation id', () => {
    const err = classifyError('RATE_LIMITED', 'slow down', {
      retryAfterMs: 5000,
      correlationId: 'corr-1',
    })
    expect(err.retryAfterMs).toBe(5000)
    expect(err.correlationId).toBe('corr-1')
    expect(err.code).toBe('RATE_LIMITED')
  })

  test('a classified error carries the message it was given, unmodified', () => {
    expect(classifyError('AUTH_REQUIRED', 'sign in first').message).toBe(
      'sign in first',
    )
  })
})

describe('provider-neutrality of the contract', () => {
  const source = readFileSync(
    join(import.meta.dir, '..', 'platform-contract.ts'),
    'utf8',
  )

  test('the contract does not name a model vendor in code', () => {
    // Comments may discuss providers; the *code* must not import or reference
    // one. Strip comments before checking so prose cannot trip the guard.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    const vendorNames = [
      'groq',
      'openai',
      'anthropic',
      'gemini',
      'heital',
      'eternal',
      'infernal',
      'openrouter',
      'deepseek',
    ]
    for (const name of vendorNames) {
      expect(code.toLowerCase()).not.toContain(name)
    }
  })

  test('the contract does not reference the BYOK development adapter', () => {
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    expect(code).not.toContain('byok')
    expect(code).not.toContain('Byok')
  })

  test('the contract does not embed a URL or make a network call', () => {
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/https?:\/\//)
    expect(code).not.toContain('fetch(')
    expect(code).not.toContain('XMLHttpRequest')
  })

  test('an approval is only ever decided, never created by a client', () => {
    // The interface must not expose a method that produces an approval. It may
    // only submit a decision about one the authorization system issued.
    expect(source).toContain('submitApproval')
    expect(source).not.toMatch(/createApproval\s*[(:]/)
  })
})
