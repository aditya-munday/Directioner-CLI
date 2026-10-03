import { DIRECTIONER_FABLE_5_1_MODEL_ID } from '@beyonders/common/constants/directioner-models'

import { FABLE_PROVIDER_OPTIONS } from './constants'
import tmuxCli from './tmux-cli'

/** The default tmux helper runs another session model, which would be rejected
 *  inside a Fable-bound session. Preserve its tools and use the campaign model. */
export default {
  ...tmuxCli,
  id: 'tmux-cli-fable',
  model: DIRECTIONER_FABLE_5_1_MODEL_ID,
  providerOptions: FABLE_PROVIDER_OPTIONS,
}
