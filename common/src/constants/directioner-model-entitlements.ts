export type DirectionerAccessTier = 'full' | 'limited'

export type DirectionerDesktopConcurrency = 'slot-bound' | 'multi-tab'

export const DIRECTIONER_SOLAR_PRO_4_ENTITLEMENT = {
  modelId: 'upstage/solar-pro4',
  fullAccess: {
    premium: false,
  },
  limitedAccess: true,
} as const

export const DIRECTIONER_SOLAR_PRO_4_MODEL_ID =
  DIRECTIONER_SOLAR_PRO_4_ENTITLEMENT.modelId

/** Solar Mini 4 (Upstage) replaced Solar Pro 4 in every picker on 2026-09-23,
 *  on the same Upstage lane and with the same entitlement shape: unmetered by
 *  the premium pool at full access, and offered at limited access. */
export const DIRECTIONER_SOLAR_MINI_4_ENTITLEMENT = {
  modelId: 'upstage/solar-mini4',
  fullAccess: {
    premium: false,
  },
  limitedAccess: true,
} as const

export const DIRECTIONER_SOLAR_MINI_4_MODEL_ID =
  DIRECTIONER_SOLAR_MINI_4_ENTITLEMENT.modelId
