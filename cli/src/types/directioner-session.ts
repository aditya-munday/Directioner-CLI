export type { DirectionerSessionServerResponse } from '@beyonders/common/types/directioner-session'

import type { DirectionerSessionServerResponse } from '@beyonders/common/types/directioner-session'

/**
 * CLI session shape. Most states are wire-level `/api/v1/directioner/session`
 * responses; `takeover_prompt` asks before displacing a server-named holder
 * at capacity (or taking over the legacy single-session trial).
 */
export type DirectionerSessionResponse =
  | DirectionerSessionServerResponse
  | {
      status: 'takeover_prompt'
      model: string
      /** Only this server-named holder may be displaced on confirmation. */
      currentInstanceId?: string
      message?: string
    }

export type DirectionerSessionStatus = DirectionerSessionResponse['status']
