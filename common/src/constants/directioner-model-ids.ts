/**
 * Stable Directioner model identifiers that are safe to import from browser code.
 *
 * Keep this module dependency-free: the full Directioner model catalog pulls in
 * server-side model configuration that is not part of the desktop renderer's
 * type environment.
 */
export const DIRECTIONER_DEEPSEEK_V4_FLASH_MODEL_ID =
  'deepseek/deepseek-v4-flash'
export const DIRECTIONER_DEEPSEEK_V4_PRO_MODEL_ID = 'deepseek/deepseek-v4-pro'
export const DIRECTIONER_MINIMAX_M3_MODEL_ID = 'minimax/minimax-m3'
