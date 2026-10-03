import os from 'os'
import path from 'path'

import { env } from '@beyonders/common/env'

import { getCliEnv } from './env'

/**
 * Resolve the on-disk config directory for the CLI.
 *
 * Lives in its own module (depending only on `env`) so that low-level helpers
 * — e.g. the persistent analytics id — can read the config dir without pulling
 * in `auth.ts`, which transitively imports the logger and analytics and would
 * otherwise create an import cycle.
 */
export const getConfigDir = (): string => {
  const cliEnv = getCliEnv()
  // DIRECTIONER_CONFIG_DIR wins. HOSTED_CONFIG_DIR is still honoured when the
  // former is absent, so an existing setup keeps working across the rename.
  const configuredDir =
    cliEnv.DIRECTIONER_CONFIG_DIR ?? cliEnv.HOSTED_CONFIG_DIR
  if (configuredDir) {
    const varName = cliEnv.DIRECTIONER_CONFIG_DIR
      ? 'DIRECTIONER_CONFIG_DIR'
      : 'HOSTED_CONFIG_DIR'
    // Confinement check: an absolute path only. A relative one would let a
    // repository's own working directory capture the CLI's settings, including
    // any trust decisions recorded there.
    if (!path.isAbsolute(configuredDir)) {
      throw new Error(
        `${varName} must be an absolute path so CLI settings cannot be written relative to the current project.`,
      )
    }
    return configuredDir
  }

  return path.join(
    os.homedir(),
    '.config',
    'directioner' +
      // on a development stack?
      (env.NEXT_PUBLIC_CB_ENVIRONMENT !== 'prod'
        ? `-${env.NEXT_PUBLIC_CB_ENVIRONMENT}`
        : ''),
  )
}
