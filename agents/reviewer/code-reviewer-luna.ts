import { DIRECTIONER_GPT_5_6_LUNA_MODEL_ID } from '@beyonders/common/constants/directioner-models'

import { publisher } from '../constants'
import type { SecretAgentDefinition } from '../types/secret-agent-definition'
import { createReviewer } from './code-reviewer'

const definition: SecretAgentDefinition = {
  id: 'code-reviewer-luna',
  publisher,
  ...createReviewer(DIRECTIONER_GPT_5_6_LUNA_MODEL_ID),
}

export default definition
