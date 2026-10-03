import { DIRECTIONER_MINIMAX_M3_MODEL_ID } from '@beyonders/common/constants/directioner-models'

import { createBase3CliRoot } from './base3'

const definition = {
  ...createBase3CliRoot({
    model: DIRECTIONER_MINIMAX_M3_MODEL_ID,
    isHosted: true,
  }),
  id: 'base3-free-minimax-m3',
  displayName: 'Buffy on MiniMax M3',
}

export default definition
