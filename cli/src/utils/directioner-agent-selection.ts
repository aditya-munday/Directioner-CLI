import {
  getDirectionerBase3RootAgentIdForModel,
  getDirectionerRootAgentIdForModel,
} from '@beyonders/common/constants/free-agents'

import { getSelectedDirectionerModel } from '../state/directioner-model-store'
import {
  AGENT_MODE_TO_ID,
  CLI_HARNESS,
  IS_HOSTED,
  type AgentMode,
} from './constants'

/**
 * Directioner is locked to LITE (chat-store's setAgentMode is a no-op when
 * IS_HOSTED), so this is effectively "which root does the selected model
 * run". Both harnesses have a root per picker model; CLI_HARNESS picks the
 * family. Fable 5.1 is a deliberate base2 exception for its trace campaign.
 * The default is currently base3; keeping both branches live preserves the
 * release-based rollback path for the CLI.
 */
export function getDirectionerCliAgentIdForModel(model: string): string {
  return CLI_HARNESS === 'base3'
    ? getDirectionerBase3RootAgentIdForModel(model)
    : getDirectionerRootAgentIdForModel(model)
}

export function getAgentIdForMode(agentMode: AgentMode): string {
  if (IS_HOSTED && agentMode === 'LITE') {
    return getDirectionerCliAgentIdForModel(getSelectedDirectionerModel())
  }

  return AGENT_MODE_TO_ID[agentMode]
}
