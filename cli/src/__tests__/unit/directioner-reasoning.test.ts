import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DIRECTIONER_DEEPSEEK_V4_FLASH_MODEL_ID,
  getDirectionerModelDefaultEffort,
} from '@beyonders/common/constants/directioner-models'
import {
  useDirectionerModelStore,
  getDirectionerReasoningEffortForModel,
  getEffectiveDirectionerReasoningEffort,
} from '../../state/directioner-model-store'

const previous = useDirectionerModelStore.getState().reasoningEffortByModel
afterEach(() =>
  useDirectionerModelStore.setState({ reasoningEffortByModel: previous }),
)

describe('per-model reasoning', () => {
  const model = DIRECTIONER_DEEPSEEK_V4_FLASH_MODEL_ID
  test('uses the catalog default without sending an override', () => {
    useDirectionerModelStore.setState({ reasoningEffortByModel: {} })
    expect(getDirectionerReasoningEffortForModel(model)).toBeNull()
    expect(getEffectiveDirectionerReasoningEffort(model)).toBe(
      getDirectionerModelDefaultEffort(model),
    )
  })
  test('uses supported overrides and ignores stale unsupported levels', () => {
    useDirectionerModelStore.setState({
      reasoningEffortByModel: { [model]: 'low' },
    })
    expect(getDirectionerReasoningEffortForModel(model)).toBe('low')
    useDirectionerModelStore.setState({
      reasoningEffortByModel: { [model]: 'xhigh' },
    })
    expect(getDirectionerReasoningEffortForModel(model)).toBeNull()
  })
})

/**
 * The send path, asserted by reading the source for the same reason the runner's
 * effortForwarding test does: an absent metadata field IS how "use the default"
 * is expressed, so a dropped value is invisible to every other test.
 */
describe('the CLI turn carries the chosen effort', () => {
  const source = readFileSync(
    join(import.meta.dir, '..', '..', 'hooks', 'use-send-message.ts'),
    'utf8',
  )

  test('it reaches extraBeyondersMetadata under the name the server reads', () => {
    const metadata = source.slice(source.indexOf('extraBeyondersMetadata:'))
    expect(metadata).toContain('directioner_reasoning_effort')
    expect(metadata).toContain('directionerReasoningEffort')
  })
})
