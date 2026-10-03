import { DIRECTIONER_MIMO_V26_PRO_MODEL_ID } from '@beyonders/common/constants/directioner-models'

import { createBase3CliRoot } from './base3'

/** MiMo 2.6 Pro on the CLI (and, by the shared root id, the Desktop). */
const definition = {
  ...createBase3CliRoot({
    model: DIRECTIONER_MIMO_V26_PRO_MODEL_ID,
    isHosted: true,
  }),
  id: 'base3-free-mimo-2-6-pro',
  displayName: 'Buffy on MiMo 2.6 Pro',
}

export default definition
