import { DIRECTIONER_GLM_V53_FLASH_MODEL_ID } from '@beyonders/common/constants/directioner-models'

import { publisher } from '../constants'
import type { SecretAgentDefinition } from '../types/secret-agent-definition'
import { createReviewer } from './code-reviewer'

// Runs the SAME model as the root that spawns it. Not a style choice: the
// chat-completions session gate rejects any request whose model differs from
// the one the session was admitted on, so a cross-model reviewer 403s mid-run.
const definition: SecretAgentDefinition = {
  id: 'code-reviewer-glm-5-3-flash',
  publisher,
  ...createReviewer(DIRECTIONER_GLM_V53_FLASH_MODEL_ID),
}

export default definition
