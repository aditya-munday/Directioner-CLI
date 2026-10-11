import { parseCodeSearchFlags } from './code-search-args'

/**
 * The ripgrep flags a model-requested `code_search` may pass.
 *
 * `code_search` hands the caller's `flags` string to ripgrep almost verbatim.
 * Ripgrep is not a pure reader: some of its options load another file, follow a
 * symlink out of the search root, or **execute a program**. Passing that string
 * through unchanged let a flag — not a shell, not a filesystem write — reach
 * execution and escape the search root:
 *
 *  - `--pre <cmd>` / `--pre-glob` runs `<cmd>` on every candidate file. Measured
 *    against this tree's bundled ripgrep: a script writing `id` to a file
 *    executed, giving arbitrary code execution through a tool described only as
 *    "search for string patterns".
 *  - `-L` / `--follow` makes ripgrep descend THROUGH symlinks, so a link planted
 *    in the repo (e.g. `sneaky.txt -> /etc/passwd`) returned the target's
 *    CONTENTS. `read_files`, `list_directory` and the terminal cwd all refuse
 *    that exact escape via `resolveReadPath`; `code_search` did not, so the
 *    containment boundary had a bypass through a sibling tool.
 *  - `--config <file>` loads an arbitrary config, and `--ignore-file <file>`
 *    pulls in opaque additional ignore rules.
 *
 * The fix is the same shape the sponsored Windows search already uses: an
 * **allowlist of formatting and match-selection options**. A denylist of
 * "dangerous" names loses to the next option somebody adds; an allowlist fails
 * closed. Everything not named here is refused by name before any process
 * exists, so `--pre`, `--follow`, `--config` and `--ignore-file` cannot be
 * reached even by an option added to ripgrep tomorrow.
 *
 * This is deliberately a superset of the sponsored allowlist — the Linux CLI
 * user's own search may reasonably ask for `-v`, `-c`, `-l` — but it still
 * excludes every option that reads a file outside the worktree, follows a link,
 * or spawns a process. It is not a filesystem sandbox: it bounds the flags of
 * THIS argv, alongside the symlink-aware cwd check `codeSearch` already makes.
 */

/** Flags that take no value and only shape matching or output. */
const BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  '-i',
  '--ignore-case',
  '-s',
  '--case-sensitive',
  '-S',
  '--smart-case',
  '-F',
  '--fixed-strings',
  '-w',
  '--word-regexp',
  '-x',
  '--line-regexp',
  '-U',
  '--multiline',
  '--multiline-dotall',
  '-v',
  '--invert-match',
  '-c',
  '--count',
  '--count-matches',
  '-l',
  '--files-with-matches',
  '--files-without-match',
  '-o',
  '--only-matching',
  '-N',
  '--no-line-number',
  '--no-unicode',
  '--unicode',
  '--crlf',
  '--null-data',
])

/** Flags whose value is a glob/type name; validated below. */
const TEXT_FLAGS: ReadonlySet<string> = new Set([
  '-g',
  '--glob',
  '-t',
  '--type',
  '-T',
  '--type-not',
])

/** Flags whose value must be a non-negative integer. */
const NUMBER_FLAGS: ReadonlySet<string> = new Set([
  '-A',
  '--after-context',
  '-B',
  '--before-context',
  '-C',
  '--context',
  '-m',
  '--max-count',
])

const TYPE_NAME = /^[A-Za-z0-9_+.-]+$/

function isValidTextValue(
  flag: string,
  value: string,
): boolean {
  if (flag === '-t' || flag === '--type' || flag === '-T' || flag === '--type-not') {
    return TYPE_NAME.test(value)
  }
  // A glob may legitimately start with `!` (negation); everything else it can
  // hold is inert text handed to ripgrep's own matcher.
  return value.length > 0
}

/**
 * Validate the caller's `flags` string against the allowlist.
 *
 * Returns `null` when the flags are acceptable, or a human-readable refusal
 * naming the offending flag. An unterminated quote is refused by the shared
 * parser (`parseCodeSearchFlags` returns `null`).
 */
export function defaultCodeSearchFlagsRefusal(
  flags: string | undefined,
): string | null {
  if (!flags?.trim()) return null
  const tokens = parseCodeSearchFlags(flags)
  if (!tokens) return 'Code search flags contain an unterminated quote.'

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!

    if (token === '--') {
      // Everything after `--` is a positional; the caller cannot supply one.
      return 'Code search flags may not contain a `--` separator.'
    }

    // Long `--name=value` form.
    if (token.startsWith('--') && token.includes('=')) {
      const eq = token.indexOf('=')
      const name = token.slice(0, eq)
      const value = token.slice(eq + 1)
      if (TEXT_FLAGS.has(name) && isValidTextValue(name, value)) continue
      if (NUMBER_FLAGS.has(name) && /^\d+$/.test(value)) continue
      return `Code search flag ${name} is not permitted.`
    }

    if (BOOLEAN_FLAGS.has(token)) continue

    if (TEXT_FLAGS.has(token) || NUMBER_FLAGS.has(token)) {
      const value = tokens[++index]
      if (!value || value.startsWith('-')) {
        return `Code search flag ${token} requires a value.`
      }
      if (TEXT_FLAGS.has(token) && !isValidTextValue(token, value)) {
        return `Code search flag ${token} has an invalid value.`
      }
      if (NUMBER_FLAGS.has(token) && !/^\d+$/.test(value)) {
        return `Code search flag ${token} requires a numeric value.`
      }
      continue
    }

    // Short attached numeric form, e.g. `-A3`, `-m1`.
    const shortNumeric = /^-([ABCm])(\d+)$/.exec(token)
    if (shortNumeric) continue

    return `Code search flag ${token} is not permitted.`
  }

  return null
}
