import { DIRECTIONER_GLM_V52_MODEL_ID } from '@beyonders/common/constants/directioner-models'

import { createBase3CliRoot } from './base3'

const definition = {
  ...createBase3CliRoot({
    model: DIRECTIONER_GLM_V52_MODEL_ID,
    isHosted: true,
  }),
  id: 'base3-free-glm',
  displayName: 'Buffy on GLM 5.2',
}

export default definition
