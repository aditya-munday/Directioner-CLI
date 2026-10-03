import { DIRECTIONER_FABLE_5_1_MODEL_ID } from '@beyonders/common/constants/directioner-models'

import { FABLE_PROVIDER_OPTIONS, publisher } from '../constants'
import type { SecretAgentDefinition } from '../types/secret-agent-definition'
import { createReviewer } from './code-reviewer'

const definition: SecretAgentDefinition = {
  id: 'code-reviewer-fable',
  publisher,
  ...createReviewer(DIRECTIONER_FABLE_5_1_MODEL_ID),
  providerOptions: FABLE_PROVIDER_OPTIONS,
}

export default definition
