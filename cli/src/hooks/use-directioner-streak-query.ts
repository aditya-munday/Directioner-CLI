import { useQuery } from '@tanstack/react-query'

import { getAuthToken } from '../utils/auth'
import { getApiClient, setApiClientAuthToken } from '../utils/beyonders-api'
import { logger as defaultLogger } from '../utils/logger'

import type { DirectionerStreakResponse } from '@beyonders/common/types/directioner-streak'
import type { Logger } from '@beyonders/common/types/contracts/logger'

export const directionerStreakQueryKeys = {
  all: ['directionerStreak'] as const,
  current: () => [...directionerStreakQueryKeys.all, 'current'] as const,
}

export async function fetchDirectionerStreak(params: {
  authToken: string
  logger?: Logger
}): Promise<DirectionerStreakResponse> {
  const { authToken, logger = defaultLogger } = params
  setApiClientAuthToken(authToken)
  const response = await getApiClient().get<DirectionerStreakResponse>(
    '/api/v1/directioner/streak',
    { retry: false },
  )

  if (!response.ok) {
    logger.error(
      { status: response.status, error: response.error },
      'Failed to fetch directioner streak',
    )
    throw new Error(`Failed to fetch directioner streak (HTTP ${response.status})`)
  }

  if (!response.data) {
    throw new Error('Failed to fetch directioner streak: empty response')
  }

  return response.data
}

export function useDirectionerStreakQuery(
  params: {
    enabled?: boolean
    logger?: Logger
  } = {},
) {
  const { enabled = true, logger = defaultLogger } = params
  const authToken = getAuthToken()

  return useQuery({
    queryKey: directionerStreakQueryKeys.current(),
    queryFn: () => fetchDirectionerStreak({ authToken: authToken!, logger }),
    enabled: enabled && !!authToken,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}
