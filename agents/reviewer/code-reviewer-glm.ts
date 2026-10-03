import { DIRECTIONER_GLM_V52_MODEL_ID } from '@beyonders/common/constants/directioner-models'

import { publisher } from '../constants'
import type { SecretAgentDefinition } from '../types/secret-agent-definition'
import { createReviewer } from './code-reviewer'

const definition: SecretAgentDefinition = {
  id: 'code-reviewer-glm',
  publisher,
  ...createReviewer(DIRECTIONER_GLM_V52_MODEL_ID),
}

export default definition
