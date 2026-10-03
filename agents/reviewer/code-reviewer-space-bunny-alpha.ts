import { DIRECTIONER_SPACE_BUNNY_ALPHA_MODEL_ID } from '@beyonders/common/constants/directioner-models'

import { publisher } from '../constants'
import type { SecretAgentDefinition } from '../types/secret-agent-definition'
import { createReviewer } from './code-reviewer'

const definition: SecretAgentDefinition = {
  id: 'code-reviewer-space-bunny-alpha',
  publisher,
  ...createReviewer(DIRECTIONER_SPACE_BUNNY_ALPHA_MODEL_ID),
}

export default definition
