import { DIRECTIONER_GLM_V53_FLASH_MODEL_ID } from '@beyonders/common/constants/directioner-models'

import { createBase2 } from './base2'

const definition = {
  ...createBase2('free', {
    model: DIRECTIONER_GLM_V53_FLASH_MODEL_ID,
  }),
  id: 'base2-free-glm-5-3-flash',
  displayName: 'Buffy the GLM 5.3 Flash Free Orchestrator',
}

export default definition
