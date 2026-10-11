import { describe, expect, test } from 'bun:test'

import {
  HEITAL_MODEL_VARIANTS,
  getHeitalVariant,
  normalizeHeitalModelId,
} from '../directioner-heital-models'

describe('Heital model variant registry', () => {
  test('every variant carries the OpenAI-compatible capability set', () => {
    for (const variant of HEITAL_MODEL_VARIANTS) {
      expect(variant.capabilities.streaming).toBe(true)
      expect(variant.capabilities.tools).toBe(true)
      expect(variant.capabilities.images).toBe(true)
      expect(variant.capabilities.structuredOutputs).toBe(true)
      expect(variant.contextWindow).toBeGreaterThan(0)
      expect(variant.maxOutputTokens).toBeGreaterThan(0)
    }
  })

  test('variant ids are unique', () => {
    const ids = HEITAL_MODEL_VARIANTS.map((v) => v.providerModelId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('looks a variant up by Google’s own id', () => {
    const variant = getHeitalVariant('gemini-3.8-flash')
    expect(variant?.providerModelId).toBe('gemini-3.8-flash')
    expect(variant?.label).toContain('Flash')
  })

  test('looks a variant up by the Directioner catalog id', () => {
    const variant = getHeitalVariant('google/gemini-3.1-pro-preview')
    expect(variant?.providerModelId).toBe('gemini-3.1-pro-preview')
  })

  test('returns undefined for a wholly unknown id', () => {
    expect(getHeitalVariant('llama-3.3-70b-versatile')).toBeUndefined()
    // The prefix is only stripped to reach a REGISTERED bare id; an unregistered
    // model is not invented here. normalizeHeitalModelId handles forwarding.
    expect(getHeitalVariant('google/gemini-9.9-future')).toBeUndefined()
  })
})

describe('normalizeHeitalModelId', () => {
  test('rewrites a known Directioner id to Google’s id', () => {
    expect(normalizeHeitalModelId('google/gemini-3.8-flash')).toBe('gemini-3.8-flash')
  })

  test('leaves a known Google id unchanged', () => {
    expect(normalizeHeitalModelId('gemini-3.7-flash')).toBe('gemini-3.7-flash')
  })

  test('strips google/ for an unregistered id so the request still targets Google', () => {
    expect(normalizeHeitalModelId('google/gemini-9.9-future')).toBe('gemini-9.9-future')
  })

  test('forwards an unknown bare id unchanged (forward compatibility)', () => {
    expect(normalizeHeitalModelId('gemini-9.9-future')).toBe('gemini-9.9-future')
  })
})
