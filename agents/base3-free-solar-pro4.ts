import { DIRECTIONER_SOLAR_PRO_4_MODEL_ID } from '@beyonders/common/constants/directioner-models'

import { createBase3CliRoot } from './base3'

const definition = {
  ...createBase3CliRoot({
    model: DIRECTIONER_SOLAR_PRO_4_MODEL_ID,
    isHosted: true,
  }),
  id: 'base3-free-solar-pro4',
  displayName: 'Buffy on Solar Pro 4',
}

export default definition
