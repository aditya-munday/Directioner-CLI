import { describe, expect, test } from 'bun:test'

import {
  directionerModelNavigationDirectionForKey,
  nextDirectionerModelId,
} from '../directioner-model-navigation'

describe('nextDirectionerModelId', () => {
  test('moves to the next model when moving forward', () => {
    const modelIds = ['glm', 'minimax']

    expect(
      nextDirectionerModelId({
        modelIds,
        focusedId: 'minimax',
        direction: 'forward',
      }),
    ).toBe('glm')
  })

  test('moves to the previous model when moving backward', () => {
    const modelIds = ['glm', 'minimax']

    expect(
      nextDirectionerModelId({
        modelIds,
        focusedId: 'minimax',
        direction: 'backward',
      }),
    ).toBe('glm')
  })

  test('wraps through every model regardless of selectability', () => {
    const modelIds = ['glm', 'minimax', 'other']

    expect(
      nextDirectionerModelId({
        modelIds,
        focusedId: 'minimax',
        direction: 'forward',
      }),
    ).toBe('other')
  })

  test('returns null when no model exists', () => {
    expect(
      nextDirectionerModelId({
        modelIds: [],
        focusedId: 'glm',
        direction: 'forward',
      }),
    ).toBeNull()
  })
})

describe('directionerModelNavigationDirectionForKey', () => {
  test('maps arrow keys to model navigation directions', () => {
    expect(directionerModelNavigationDirectionForKey({ name: 'down' })).toBe(
      'forward',
    )
    expect(directionerModelNavigationDirectionForKey({ name: 'right' })).toBe(
      'forward',
    )
    expect(directionerModelNavigationDirectionForKey({ name: 'up' })).toBe(
      'backward',
    )
    expect(directionerModelNavigationDirectionForKey({ name: 'left' })).toBe(
      'backward',
    )
  })

  test('maps tab and shift-tab to model navigation directions', () => {
    expect(directionerModelNavigationDirectionForKey({ name: 'tab' })).toBe(
      'forward',
    )
    expect(
      directionerModelNavigationDirectionForKey({ name: 'tab', shift: true }),
    ).toBe('backward')
  })

  test('maps terminal tab sequences to model navigation directions', () => {
    expect(directionerModelNavigationDirectionForKey({ sequence: '\t' })).toBe(
      'forward',
    )
    expect(
      directionerModelNavigationDirectionForKey({ sequence: '\x1b[9u' }),
    ).toBe('forward')
    expect(
      directionerModelNavigationDirectionForKey({ sequence: '\x1b[Z' }),
    ).toBe('backward')
    expect(
      directionerModelNavigationDirectionForKey({ sequence: '\x1b[9;2u' }),
    ).toBe('backward')
    expect(
      directionerModelNavigationDirectionForKey({ sequence: '\x1b[27;2;9~' }),
    ).toBe('backward')
  })

  test('ignores non-navigation keys', () => {
    expect(directionerModelNavigationDirectionForKey({ name: 'enter' })).toBeNull()
  })
})
