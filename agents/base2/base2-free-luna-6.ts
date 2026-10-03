import {
  DIRECTIONER_GPT_6_LUNA_MODEL_ID,
  DIRECTIONER_GPT_6_LUNA_REASONING_EFFORT,
} from '@beyonders/common/constants/directioner-models'

import { createBase2 } from './base2'

// The base2 rollback root for GPT-6 Luna, bundled alongside its base3 twin so
// the DIRECTIONER_BASE3_HARNESS_DISABLED kill switch has somewhere to route.
const definition = {
  ...createBase2('free', {
    model: DIRECTIONER_GPT_6_LUNA_MODEL_ID,
  }),
  id: 'base2-free-luna-6',
  displayName: 'Buffy the GPT-6 Luna Free Orchestrator',
  // Same rule as base2-free-luna: the server applies this default too
  // (applyDirectionerReasoningDefaults), both reading the shared constant.
  reasoningOptions: {
    enabled: true,
    effort: DIRECTIONER_GPT_6_LUNA_REASONING_EFFORT,
  },
}

export default definition
