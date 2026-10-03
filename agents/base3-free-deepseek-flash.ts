import { DIRECTIONER_DEEPSEEK_V4_FLASH_MODEL_ID } from '@beyonders/common/constants/directioner-models'

import { createBase3CliRoot } from './base3'

const definition = {
  ...createBase3CliRoot({
    model: DIRECTIONER_DEEPSEEK_V4_FLASH_MODEL_ID,
    isHosted: true,
  }),
  id: 'base3-free-deepseek-flash',
  displayName: 'Buffy on DeepSeek Flash',
}

export default definition
