import { DIRECTIONER_SOLAR_PRO_4_MODEL_ID } from '@beyonders/common/constants/directioner-models'

import { createBase2 } from './base2'

const definition = {
  ...createBase2('free', {
    model: DIRECTIONER_SOLAR_PRO_4_MODEL_ID,
  }),
  id: 'base2-free-solar-pro4',
  displayName: 'Buffy the Solar Pro 4 Free Orchestrator',
}

export default definition
