#!/usr/bin/env node

/**
 * Directioner npm entrypoint.
 *
 * Directioner is BYOK-first and standalone. This wrapper does nothing but hand
 * the packaged launcher the arguments it needs; the launcher owns every
 * decision (platform check, cache install, exec). There is no network access,
 * no update check, and no telemetry anywhere in this path.
 */

const { createLauncher } = require('./launcher')

const launcher = createLauncher({
  packageDir: __dirname,
  packageName: 'directioner',
  displayName: 'Directioner',
})

module.exports = launcher

if (require.main === module) {
  launcher.main().catch((error) => {
    console.error(`Directioner launcher error: ${error.message}`)
    process.exit(1)
  })
}
