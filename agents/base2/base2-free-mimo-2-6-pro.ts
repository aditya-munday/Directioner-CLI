import { DIRECTIONER_MIMO_V26_PRO_MODEL_ID } from '@beyonders/common/constants/directioner-models'

import { createBase2 } from './base2'

// The base2 rollback root for MiMo 2.6 Pro, bundled alongside its base3 twin so
// the DIRECTIONER_BASE3_HARNESS_DISABLED kill switch has somewhere to route and a
// run resumed from base2 state still resolves.
const definition = {
  ...createBase2('free', {
    model: DIRECTIONER_MIMO_V26_PRO_MODEL_ID,
  }),
  id: 'base2-free-mimo-2-6-pro',
  displayName: 'Buffy the MiMo 2.6 Pro Free Orchestrator',
}

export default definition
