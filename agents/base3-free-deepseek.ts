import { DIRECTIONER_DEEPSEEK_V4_PRO_MODEL_ID } from '@beyonders/common/constants/directioner-models'

import { createBase3CliRoot } from './base3'

/**
 * Directioner CLI on DeepSeek V4 Pro, running the base3 single-loop harness.
 *
 * Shares its id with the Web/Cloud root of the same name — the two surfaces
 * ship separate definitions under one id, exactly as the `base2-free-*` family
 * already does, and split in the DB by `message.surface`.
 */
const definition = {
  ...createBase3CliRoot({
    model: DIRECTIONER_DEEPSEEK_V4_PRO_MODEL_ID,
    isHosted: true,
  }),
  id: 'base3-free-deepseek',
  displayName: 'Buffy on DeepSeek',
}

export default definition
