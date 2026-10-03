#!/usr/bin/env bun

/**
 * Directioner CLI build script.
 *
 * Directioner is a BYOK-first standalone client: it has no Directioner
 * backend, no hosted login, and no server-side model routing. The user
 * configures their own provider, endpoint and credential, and the existing
 * provider abstraction (Heital / Eternal / Infernal, plus openai-compatible
 * and openrouter) is the inference path.
 *
 * That product is the `DIRECTIONER_MODE=true` build variant, NOT
 * `HOSTED_MODE=true`. Both flags are injected by `--define` in
 * `cli/scripts/build-binary.ts`, and `cli/src/utils/constants.ts` reads them as
 * module-level constants, so the bundler dead-code-eliminates the other
 * variant. The two are different products, not a runtime toggle:
 *
 *   DIRECTIONER_MODE=true  IS_DIRECTIONER -- standalone BYOK. Auth is skipped
 *                          (app.tsx), ads are off, and a turn resolves the
 *                          configured provider directly (use-send-message.ts).
 *   HOSTED_MODE=true       IS_HOSTED -- the hosted/free client. Requires a
 *                          login and a Directioner session, and keeps the ad
 *                          and analytics machinery live.
 *
 * HOSTED_MODE is set to `false` explicitly rather than left to the ambient
 * environment: an exported HOSTED_MODE in the builder's shell would otherwise
 * flip the shipped binary back to the hosted variant.
 *
 * Usage:
 *   bun directioner/cli/build.ts <version>
 */

import { spawnSync } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..')

const version = process.argv[2]
if (!version) {
  console.error('Usage: bun directioner/cli/build.ts <version>')
  process.exit(1)
}

console.log(`Building Directioner v${version} (BYOK standalone)...`)

const result = spawnSync(
  'bun',
  ['cli/scripts/build-binary.ts', 'directioner', version],
  {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      DIRECTIONER_MODE: 'true',
      HOSTED_MODE: 'false',
    },
  },
)

if (result.status !== 0) {
  console.error('Directioner build failed')
  process.exit(result.status ?? 1)
}

console.log(`✅ Directioner v${version} built successfully`)
