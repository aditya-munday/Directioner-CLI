import { DIRECTIONER_MINIMAX_M3_MODEL_ID } from '@beyonders/common/constants/directioner-models'

import { createBase2 } from './base2'

const definition = {
  ...createBase2('free', {
    model: DIRECTIONER_MINIMAX_M3_MODEL_ID,
  }),
  id: 'base2-free-minimax-m3',
  displayName: 'Buffy the MiniMax M3 Free Orchestrator',
}

export default definition
