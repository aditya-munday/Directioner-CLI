import { DIRECTIONER_DEEPSEEK_V4_FLASH_MODEL_ID } from '@beyonders/common/constants/directioner-models'

import { createBase2 } from './base2'

const definition = {
  ...createBase2('free', {
    model: DIRECTIONER_DEEPSEEK_V4_FLASH_MODEL_ID,
  }),
  id: 'base2-free-deepseek-flash',
  displayName: 'Buffy the DeepSeek Flash Free Orchestrator',
}

export default definition
