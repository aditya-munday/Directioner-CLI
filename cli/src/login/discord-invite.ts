import {
  DIRECTIONER_DISCORD_INVITE_URL,
  DIRECTIONER_DISCORD_MEMBERS_LABEL,
} from '@beyonders/common/constants/directioner-community'

/**
 * The line a fresh Directioner sign-in ends on, in the TUI's top banner and in
 * `directioner login --plain`: the moment someone has just joined is the one
 * most worth inviting them to talk to us. Directioner only — Beyonders's
 * community is a different server.
 */
export const DISCORD_AFTER_LOGIN_TEXT = `Talk directly with our team and ${DIRECTIONER_DISCORD_MEMBERS_LABEL} community members on Discord:`

export { DIRECTIONER_DISCORD_INVITE_URL }
