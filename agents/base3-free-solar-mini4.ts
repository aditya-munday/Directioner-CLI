import { DIRECTIONER_SOLAR_MINI_4_MODEL_ID } from '@beyonders/common/constants/directioner-models'

import { createBase3CliRoot } from './base3'

const definition = {
  ...createBase3CliRoot({
    model: DIRECTIONER_SOLAR_MINI_4_MODEL_ID,
    isHosted: true,
  }),
  id: 'base3-free-solar-mini4',
  displayName: 'Buffy on Solar Mini 4',
}

export default definition
