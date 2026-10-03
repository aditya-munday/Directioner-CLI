import { DIRECTIONER_GEMINI_38_FLASH_MODEL_ID } from '@beyonders/common/constants/directioner-models'

import { createBase3CliRoot } from './base3'

/**
 * Gemini 3.8 Flash on the CLI (and, by the shared root id, the Desktop).
 *
 * No `reasoningOptions`, like every Directioner root: the catalog owns the ladder
 * and the server fills the effort in, so the picker and the wire cannot drift.
 * That is worth more on this row than most — reasoning bills as output at
 * $1.875/M here, so the effort control is a cost lever rather than a latency
 * one (see DIRECTIONER_GEMINI_38_FLASH_MODEL_ID).
 */
const definition = {
  ...createBase3CliRoot({
    model: DIRECTIONER_GEMINI_38_FLASH_MODEL_ID,
    isHosted: true,
  }),
  id: 'base3-free-gemini-3-8-flash',
  displayName: 'Buffy on Gemini 3.8 Flash',
}

export default definition
