import { randomUUID } from 'node:crypto'

import { DIRECTIONER_CLI_CLAIM_PREFIX } from '@beyonders/common/constants/directioner-desktop-sessions'

// A new identity for each CLI purchase, never shared through settings or cwd.
// The prefix also lets delayed DELETE/refund requests retain their protocol
// after the picker has switched models (limited offers use the legacy path),
// and tells the server this claim may resume a legacy CLI hour.
const CLI_MULTI_SESSION_PREFIX = DIRECTIONER_CLI_CLAIM_PREFIX

export function newDirectionerCliInstanceId(): string {
  return `${CLI_MULTI_SESSION_PREFIX}${randomUUID()}`
}

export function directionerCliAttemptId(instanceId?: string): string | undefined {
  return instanceId?.startsWith(CLI_MULTI_SESSION_PREFIX)
    ? instanceId.slice(CLI_MULTI_SESSION_PREFIX.length)
    : undefined
}

export function directionerSessionMetadata(instanceId: string) {
  return {
    directioner_instance_id: instanceId,
    // Use the existing wire protocol so released servers can serve this CLI.
    // The surface distinguishes native clients now that both use this store.
    ...(directionerCliAttemptId(instanceId)
      ? { directioner_multi_session: '1', surface: 'cli' }
      : {}),
  }
}
