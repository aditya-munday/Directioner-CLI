import { DIRECTIONER_MIMO_V25_MODEL_ID } from '@beyonders/common/constants/directioner-models'

import { createBase3CliRoot } from './base3'

const definition = {
  ...createBase3CliRoot({
    model: DIRECTIONER_MIMO_V25_MODEL_ID,
    isHosted: true,
  }),
  id: 'base3-free-mimo',
  displayName: 'Buffy on MiMo',
}

export default definition
