import { DIRECTIONER_GEMINI_38_FLASH_MODEL_ID } from '@beyonders/common/constants/directioner-models'

import { createBase2 } from './base2'

// The base2 rollback root for Gemini 3.8 Flash, bundled alongside its base3
// twin so the DIRECTIONER_BASE3_HARNESS_DISABLED kill switch has somewhere to
// route and a run resumed from base2 state still resolves.
const definition = {
  ...createBase2('free', {
    model: DIRECTIONER_GEMINI_38_FLASH_MODEL_ID,
  }),
  id: 'base2-free-gemini-3-8-flash',
  displayName: 'Buffy the Gemini 3.8 Flash Free Orchestrator',
}

export default definition
