/**
 * The shell boundary: what a model-requested terminal command may start with.
 *
 * The file tools refuse a path outside the project. A shell command is the
 * other way out, and the default path had neither half of this:
 *
 *  - the environment was the host's whole `process.env`, so `env` — or an
 *    interpreter the model writes — could print a provider key, a session token
 *    or a telemetry key. Measured, not assumed: a probe against this tree read
 *    `SESSION_API_KEY` and `OH_LLM_API_KEY_REFRESH_URL` out of a command.
 *  - the cwd was `path.resolve(projectRoot, modelArg)` with no containment, so
 *    `cwd: ".."` or `cwd: "/"` started a command wherever it liked.
 *
 * Both are fixed HERE rather than inline at the dispatch, so the boundary is
 * one unit that a test can drive with a real process.
 *
 * ## What this is not
 *
 * It is not a filesystem or network sandbox. A shell that starts in the project
 * can still `cat /etc/passwd`, `rm` an absolute path, or open a socket: there is
 * no mount/network namespace in this build outside a sponsored run's broker.
 * This closes the two things the SDK can close everywhere — the environment it
 * hands over, and the directory it starts in — and says so, rather than
 * claiming a boundary it does not have.
 */

import path from 'path'

import { resolveReadPath } from './path-utils'
import { scrubTerminalEnv } from './terminal-env-policy'

import type { PathBoundary, PathBoundaryDecision } from './path-utils'
import type { TerminalEnvPolicy } from './terminal-env-policy'

/**
 * The directory a model-requested command starts in, or a refusal.
 *
 * `requestedCwd` is resolved against the project root and then checked against
 * the same boundary the file tools use, so `cwd: '..'`, `cwd: '/etc'` and a
 * `cwd` that is a symlink out of the project are all refused before a process
 * exists. A host that granted an extra root through {@link PathBoundary} grants
 * it here too, because the two are the same decision.
 */
export function resolveTerminalCommandCwd(
  projectRoot: string,
  requestedCwd: string | undefined,
  boundary?: PathBoundary,
): PathBoundaryDecision {
  const resolved = path.resolve(projectRoot, requestedCwd ?? '.')
  return resolveReadPath(projectRoot, resolved, boundary ?? {})
}

/**
 * The environment a model-requested command runs with.
 *
 * `'inherit'` hands the host environment through unchanged — the CLI's explicit
 * choice on the user's own machine. Anything else (the default, `'scrub'`)
 * allowlists machine/toolchain variables and drops every credential-shaped
 * name, so a command cannot print a provider key or a session token. `home` and
 * `tmp`, when given, move the command's `HOME`/`TMPDIR` into a private
 * directory so `~/.ssh` and `~/.aws` are not where it looks.
 */
export function buildTerminalCommandEnv({
  policy,
  env,
  home,
  tmp,
}: {
  policy: TerminalEnvPolicy | undefined
  env: Record<string, string | undefined>
  home?: string
  tmp?: string
}): Record<string, string | undefined> {
  if (policy === 'inherit') return env
  return scrubTerminalEnv(env, home || tmp ? { home, tmp } : undefined)
}
