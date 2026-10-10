# Directioner-CLI filesystem / terminal boundary audit

The invariant: **a model-chosen path or flag may not read, write, execute, or
reach anything outside the repository root.** Terminal commands are the trusted
escape hatch (they run with whatever approval the user granted); every other
tool must refuse to cross the boundary even when asked with an absolute path, a
symlink, a `..` segment, or a flag.

Measured on `directioner/security-fs-terminal-hardening` (based on remote `main`
`4faf82a84`).

## What was re-verified (preserved controls)

| Control | Location | Proof |
| --- | --- | --- |
| Path resolution refuses `..`/absolute escapes | `sdk/src/tools/path-utils.ts` `resolveReadPath` | `path-utils.test.ts`, `filesystem-boundary.test.ts` |
| Directory listing stays inside the boundary | `sdk/src/tools/list-directory.ts` | `filesystem-boundary.test.ts` |
| Reads pin the resolved file, not the path | `sdk/src/tools/read-files.ts` | `read-files.test.ts` |
| Writes close the TOCTOU and hardlink escape | `rooted-write.ts` | `filesystem-boundary.test.ts` ("pinned write closes the TOCTOU and hardlink escapes") |
| Terminal env scrubbing (secret env vars removed) | `terminal-env-policy.ts` | `terminal-boundary.test.ts` |
| SSRF refused (loopback / link-local / metadata) | `ssrf.ts` | SSRF suite |
| Sponsored Windows containment (links, worktree) | `sponsored-sandbox.ts` | `sponsored-rooted-filesystem.test.ts` |
| `code_search` cwd containment | `code-search.ts` `resolveReadPath` on cwd | `sponsored-code-search.test.ts` |

Re-run result (this checkout): `filesystem-boundary`, `path-utils`,
`read-files`, `terminal-boundary`, `sponsored-rooted-filesystem` —
**161 pass / 2 skip / 0 fail / 382 expect**.

## Finding this prompt closed

### F2 — `code_search` ripgrep flags permitted execution and symlink escape

**Attack surface.** `code_search`'s `flags` parameter
(`common/src/tools/params/tool/code-search.ts`) is documented as "optional
ripgrep flags" and was passed to ripgrep verbatim, after `--no-config -n --json`
and before `--`. No validation existed.

**Why it is a boundary crossing.** Ripgrep is not a pure reader:

- `--pre <cmd>` **executes `<cmd>`** on every candidate file.
- `-L` / `--follow` descends **through symlinks**, so a link planted inside the
  repo is searched at its target outside the repo.
- `--config <file>` and `--ignore-file <file>` load an arbitrary file.

**Independent reproduction (before the fix).** Against this tree's bundled
binary (`sdk/vendor/ripgrep/x64-linux/rg`), with a project symlink
`sneaky.txt -> ../outside.txt`:

- Direct shell, no `--follow`: `1` match. With `--follow`: `2` matches,
  including the outside file's contents.
- `--pre /tmp/rgpre.sh` with the exact argument order `code_search` builds
  (`--no-config -n --json --pre … -- …`): the preprocessor script executed
  (`uid=10001(openhands) …` was written to a file).

So `code_search` could read files outside the project that `read_files` refuses,
and could execute a program, while being described only as a search. This is the
same escape `resolveReadPath` blocks for the other file tools — the boundary had
a sibling-tool bypass.

**Fix.** `sdk/src/tools/code-search-flags.ts` defines an allowlist of
formatting / match-selection options (a superset of the sponsored Windows search
allowlist — the Linux CLI may ask for `-v`, `-c`, `-l`, `-o`, …). Anything not
named is refused by name **before any process is created**, so `--pre`,
`--follow`, `--config`, `--ignore-file`, and any flag added to ripgrep later are
unreachable. `--` as a caller flag is refused (it would let the caller inject
positional paths). Value-taking flags are validated (numeric context counts,
`[A-Za-z0-9_+.-]` type names). The shared flag parser moved to
`code-search-args.ts` so the surface and the allowlist share one splitter with
no import cycle.

Additionally, the `INCLUDED_HIDDEN_DIRS` search paths are admitted only when
`lstat` says they are a **real directory, not a symlink** — ripgrep follows a
search path named on its command line even without `--follow`, so
`.github -> /outside` would otherwise be searched through the link.

**Regression tests.**
- `sdk/src/__tests__/code-search-flags.test.ts` — 37 cases (execution/escape
  flags refused by name, ordinary flags allowed, malformed flags refused).
- `sdk/src/__tests__/code-search-flag-boundary.test.ts` — 4 end-to-end cases
  through the **real bundled ripgrep** and a **real planted symlink**: `-L` and
  `--pre` refused with the outside marker never returned; a default search never
  follows the link; an ordinary search still finds an in-project file.

## Flag/escape matrix

| Vector | Result | Proof |
| --- | --- | --- |
| `--pre <cmd>` | Refused before spawn | flags suite + E2E |
| `--pre-glob` | Refused | flags suite |
| `-L` / `--follow` | Refused; E2E confirms no leak | flags suite + E2E |
| `--config` / `--config=` | Refused | flags suite |
| `--ignore-file` / `=` | Refused | flags suite |
| caller `--` | Refused | flags suite |
| unknown long/short flag | Refused | flags suite |
| `-g`/`-t`/`-T` with bad value | Refused | flags suite |
| `-A`/`-B`/`-C`/`-m` non-numeric | Refused | flags suite |
| symlinked `INCLUDED_HIDDEN_DIRS` entry | Excluded (lstat) | code unit |
| absolute/`..` path in `cwd` | Refused by `resolveReadPath` | sponsored-code-search |
| ordinary `-i -t ts -g *.ts -A 3` search | Works | flags suite + E2E |

## Known limitations

- This bounds `code_search`'s argv. It is not a filesystem sandbox for the
  spawned binary; on Linux the OS-level confinement of a search is the same as
  any process started by the CLI, which is why the allowlist must fail closed on
  flags rather than rely on "ripgrep won't do that".
- A filename ripgrep prints is still returned to the model; that content flows
  through the tool-result provenance wrapper
  (`docs/directioner-prompt-injection-audit.md`), which is the relevant boundary
  for what the model may do with it.
- Terminal commands remain the user-approved escape hatch by design; this pass
  did not narrow what an approved terminal command may do.
