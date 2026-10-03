import { validateAgents } from '@beyonders/sdk'
import { useCallback, useState } from 'react'

import { getAuthToken } from '../utils/auth'
import { loadAgentDefinitions } from '../utils/local-agent-registry'
import { hasSelectedByokConnection } from '../utils/byok'
import { IS_DIRECTIONER, IS_HOSTED } from '../utils/constants'
import { logger } from '../utils/logger'
import { filterNetworkErrors } from '../utils/validation-error-helpers'

import type { AgentDefinition } from '@beyonders/sdk'

export type ValidationError = {
  id: string
  message: string
}

export type ValidationCheckResult = {
  success: boolean
  errors: ValidationError[]
}

/**
 * BYOK runs validate local agent definitions without sending them to Directioner.
 *
 * The Directioner BYOK build has no backend to validate against, so the remote
 * check is not merely unnecessary there — the request cannot succeed, and a
 * failure would block every send. It is therefore keyed off the build itself,
 * not off a BYOK *selection*: Directioner resolves its provider from
 * `config.json` and never populates the hosted selection store, so
 * `hasSelectedByokConnection()` is always false on that build.
 */
export const shouldValidateAgentsRemotely = (
  isHosted = IS_HOSTED,
  isDirectioner = IS_DIRECTIONER,
): boolean => !isDirectioner && (!isHosted || !hasSelectedByokConnection())

/**
 * Invoke SDK validation using the inference source selected when a send starts.
 * The auth token rides along so a logged-in CLI behind a shared NAT is
 * admitted on its own per-user budget once the endpoint's per-IP budget is
 * spent; the endpoint itself stays anonymous.
 */
export const validateSelectedAgentDefinitions = (
  agentDefinitions: AgentDefinition[],
  options?: { isHosted?: boolean; isDirectioner?: boolean },
) =>
  validateAgents(agentDefinitions, {
    remote: shouldValidateAgentsRemotely(
      options?.isHosted,
      options?.isDirectioner,
    ),
    apiKey: getAuthToken(),
  })

type UseAgentValidationResult = {
  validationErrors: ValidationError[]
  isValidating: boolean
  validate: () => Promise<ValidationCheckResult>
}

/**
 * Hook that provides agent validation functionality.
 * Call validate() manually to trigger validation (e.g., on message send).
 */
export const useAgentValidation = (): UseAgentValidationResult => {
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>(
    [],
  )
  const [isValidating, setIsValidating] = useState(false)

  // Validate agents and update state
  // Returns validation result with success status and any errors
  const validate = useCallback(async (): Promise<ValidationCheckResult> => {
    setIsValidating(true)

    try {
      const agentDefinitions = loadAgentDefinitions()

      // Read selection at send time so changing provider never leaves a stale
      // render using the hosted validation endpoint.
      const validationResult = await validateSelectedAgentDefinitions(
        agentDefinitions,
      )

      if (validationResult.success) {
        setValidationErrors([])
        return { success: true, errors: [] }
      } else {
        const filteredValidationErrors = filterNetworkErrors(
          validationResult.validationErrors,
        )
        setValidationErrors(filteredValidationErrors)
        return { success: false, errors: filteredValidationErrors }
      }
    } catch (error) {
      logger.error({ error }, 'Agent validation failed with exception')
      // Don't update validation errors on exception - keep previous state
      // Return failure to block message sending on validation errors
      return { success: false, errors: [] }
    } finally {
      setIsValidating(false)
    }
  }, [])

  return {
    validationErrors,
    isValidating,
    validate,
  }
}
