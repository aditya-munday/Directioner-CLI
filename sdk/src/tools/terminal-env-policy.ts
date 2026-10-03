/**
 * What a model-requested shell command inherits from the host.
 *
 * The file tools refuse a path that leaves the project. A shell command is the
 * other way out, and it was handed the whole process environment: a probe run
 * against this tree read `SESSION_API_KEY`, `OH_LLM_API_KEY_REFRESH_URL` and a
 * telemetry key straight out of `env`, and could print a provider key whenever
 * one was present. Prose in the tool description ("treat anything outside the
 * project as read-only") is not a boundary — a cooperating model honours it and
 * an injected instruction does not.
 *
 * This is the SDK-side half of the boundary. It is deliberately an ALLOWLIST:
 * a denylist of "dangerous" names loses to the next name somebody invents, and
 * the environment is host-owned data the model never needs wholesale.
 *
 * ## What it can and cannot do
 *
 * CAN: stop environment-borne secrets (provider keys, `GITHUB_TOKEN`, cloud and
 * registry credentials, session tokens) from reaching a command, including
 * through an interpreter the model writes itself. That is the leak a shell tool
 * has that the file tools do not.
 *
 * CANNOT: stop a command from reading `~/.ssh` or `/etc/passwd` off the
 * filesystem, or from opening a socket. There is no filesystem or network
 * namespace here — those need an OS sandbox (`bwrap`, `sandbox-exec`), which
 * this build only assembles for a sponsored run. {@link scrubTerminalEnv} is
 * the mitigation available everywhere; it is not the whole boundary, and
 * nothing here claims it is.
 */

import { looksLikeCredentialEnvVar } from '@beyonders/common/util/credential-env'

/**
 * Variables a shell command may inherit.
 *
 * Every entry is a machine or toolchain fact, or a path that the USER chose for
 * their own tooling. None names a credential. `HOME` is deliberately kept: with
 * it removed, `git` cannot find `~/.gitconfig`, a package manager cannot find
 * its cache, and the coding workflows requirement 6 protects stop working. The
 * consequence — that `~/.ssh` is still on the filesystem — is a filesystem
 * boundary question and is answered by the OS sandbox, not here.
 */
export const TERMINAL_ENV_ALLOWLIST: readonly string[] = Object.freeze([
  // Shell, locale, terminal
  'PATH',
  'HOME',
  'SHELL',
  'TERM',
  'TERM_PROGRAM',
  'LANG',
  'LANGUAGE',
  'LC_ALL',
  'LC_CTYPE',
  'LC_MESSAGES',
  'TZ',
  'PAGER',
  'PWD',
  'TMPDIR',
  'TEMP',
  'TMP',
  'COLUMNS',
  'LINES',
  'NO_COLOR',
  'FORCE_COLOR',
  'CI',
  // TLS trust, which build tools need and which names no secret
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  // Toolchain roots the user configured
  'CARGO_HOME',
  'RUSTUP_HOME',
  'GOROOT',
  'GOPATH',
  'GOMODCACHE',
  'JAVA_HOME',
  'GRADLE_USER_HOME',
  'VIRTUAL_ENV',
  'PYENV_ROOT',
  'NVM_DIR',
  'NVM_BIN',
  'BUN_INSTALL',
  'DENO_DIR',
  'PNPM_HOME',
  'COREPACK_HOME',
  // Windows: machine roots and command resolution, never a per-user location
  'PATHEXT',
  'SystemRoot',
  'SystemDrive',
  'windir',
  'ComSpec',
  'OS',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_IDENTIFIER',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramW6432',
  'CommonProgramFiles',
  'CommonProgramFiles(x86)',
  'CommonProgramW6432',
  'ALLUSERSPROFILE',
])

const ALLOWLIST_MATCH: ReadonlySet<string> = new Set(
  TERMINAL_ENV_ALLOWLIST.map((name) => (process.platform === 'win32' ? name.toLowerCase() : name)),
)

function isAllowedEnvName(name: string): boolean {
  return ALLOWLIST_MATCH.has(process.platform === 'win32' ? name.toLowerCase() : name)
}

/**
 * The environment a model-requested command runs with.
 *
 * PURE: it reads no disk and creates no directory, so it can be asserted on
 * directly. Pass `home`/`tmp` to move the command's `HOME`/`TMPDIR` into a
 * private directory the run owns, which is the one filesystem-secret mitigation
 * available without an OS sandbox: with `HOME` moved, `~/.ssh`, `~/.aws` and
 * `~/.npmrc` are simply not where the command looks.
 *
 * A name that is both allowlisted and credential-shaped is dropped, and the
 * caller can assert the result is clean with
 * {@link assertTerminalEnvHasNoCredentials}. The two are belt and braces, the
 * same shape the sponsored scrub uses.
 */
export function scrubTerminalEnv(
  source: Record<string, string | undefined>,
  paths?: { home?: string; tmp?: string },
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue
    if (!isAllowedEnvName(name)) continue
    if (looksLikeCredentialEnvVar(name)) continue
    env[name] = value
  }
  if (paths?.home) {
    env.HOME = paths.home
    env.USERPROFILE = paths.home
  }
  if (paths?.tmp) {
    env.TMPDIR = paths.tmp
    env.TEMP = paths.tmp
    env.TMP = paths.tmp
  }
  return env
}

/**
 * Fail loudly if the scrub ever let a credential-shaped name through.
 *
 * The failure this guards is the plausible one: somebody widens
 * {@link TERMINAL_ENV_ALLOWLIST} for a build tool and takes a credential with
 * it. Cheap, and it fails at the boundary rather than in a postmortem.
 */
export function assertTerminalEnvHasNoCredentials(
  env: Record<string, string | undefined>,
): void {
  for (const name of Object.keys(env)) {
    if (looksLikeCredentialEnvVar(name)) {
      throw new Error(
        `Terminal environment would carry \`${name}\`, which is credential-shaped. Narrow TERMINAL_ENV_ALLOWLIST.`,
      )
    }
  }
}

/**
 * Whether the environment is handed to the command unchanged.
 *
 *  - `scrub` (default): allowlist the host environment; drop credentials.
 *  - `inherit`: hand the host environment through unchanged.
 *
 * A host that means to give a command the user's full local authority — the
 * CLI on the user's own machine, where the user typed the task and expects
 * their authenticated `git`/registry — sets `inherit` explicitly. The point of
 * the option is that this is a HOST decision, made once at the seam, and never
 * something a model argument or a repository file can flip.
 */
export type TerminalEnvPolicy = 'scrub' | 'inherit'
