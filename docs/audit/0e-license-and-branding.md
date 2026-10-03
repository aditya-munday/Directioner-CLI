# Stage 0e — License, NOTICE and Branding Audit

Read-only. **Not legal advice.** Points marked ⚠ need a lawyer.

---

## 1. Root license files

- `LICENSE` (11,344 bytes) — the **Apache License, Version 2.0**, January 2004.
  Verified by reading the header.
- `NOTICE` (101 bytes), verbatim:

  ```
  Beyonders
  Copyright 2025 Beyonders

  This product includes software developed for the Beyonders project.
  ```

- `package.json` → `"license": "Apache-2.0"`, `"name": "beyonders-project"`.

Apache-2.0 and the NOTICE are consistent at the root.

---

## 2. The inconsistency: shipped packages declare MIT

| File | Package name | Declared license |
|---|---|---|
| `cli/release/package.json` | `beyonders` | **MIT** |
| `cli/release-staging/package.json` | `codecane` | **MIT** |
| `directioner/cli/release/package.json` | `directioner` | **MIT** |
| `sdk/package.json` | `@beyonders/sdk` | Apache-2.0 |
| `common/src/templates/initial-agents-dir/package.json` | `beyonders-agents` | Apache-2.0 |
| root `package.json` | `beyonders-project` | Apache-2.0 |

Workspace packages with **no license field**: `cli`, `common`,
`packages/agent-runtime`, `packages/code-map`, `packages/llm-providers`,
`agents`, `evals`, `directioner`, `cli/release-core`, several test packages.

Third-party notice: `packages/code-map/src/tree-sitter-queries/readme.md`
correctly attributes tree-sitter grammars as MIT (those are separate upstream
projects, not ours).

**Assessment:** the root and the SDK say Apache-2.0; the three release manifests
that define the *distributed* npm packages say MIT. Either the release packages
were intended to be MIT (a deliberate per-surface choice) or the field is wrong.
I cannot determine intent from the repo. ⚠ **Ask Aditya which is correct before
we ship anything derived from this.**

There is also a naming inconsistency: `codecane` (`cli/release-staging`) is a
name that appears nowhere in the brief's identity map.

---

## 3. What Apache-2.0 requires of a rebrand (practical reading)

Apache-2.0 permits derivative works, including commercial and differently-
*packaged* ones, and permits adding your own terms for your own contributions.
It requires, in substance:

1. **Keep the license.** A copy of Apache-2.0 must remain with the work.
2. **Keep the NOTICE.** Its attribution text must be preserved (and may be
   appended to, not replaced).
3. **Mark modified files.** Section 4(b): carry prominent notices stating that
   you changed the files.
4. **Do not use their trademarks.** Section 6 grants **no** trademark rights.
   This is the section that governs the branding work, and it is why removing
   Beyonders/Directioner names and logos is not merely courtesy — leaving them could
   imply endorsement.

⚠ The brief says "Treat the code as Apache-2.0 until proven otherwise." The MIT
manifests are "otherwise" evidence, but they are *inconsistent* evidence, not
proof. A lawyer should confirm: (a) the correct license of the distributed
packages, (b) whether we may rebrand and distribute, and (c) whether we may
change the license of our own added code (we can, for our own contributions,
while keeping Apache-2.0 on the inherited parts).

---

## 4. Attribution plan (to execute in Stage 1, not now)

The brief's requirements, mapped to files:

| Requirement | Where it goes |
|---|---|
| Keep `LICENSE` | leave `LICENSE` in place, unchanged |
| Keep `NOTICE` | leave `NOTICE` in place, unchanged; may append our line |
| Attribution file crediting the original project | new file, e.g. `NOTICE`-adjacent `ATTRIBUTION.md`: "Directioner is derived from Beyonders/Directioner (Copyright 2025 Beyonders), Apache-2.0." This is the **only** place the old names remain. |
| Modification notices on changed files | per-file header comment: "Modified by Directioner from the original Beyonders/Directioner source; see ATTRIBUTION.md." |
| Remove names/logos/URLs from product identity | UI text, help banner, package metadata, binary name, config paths, ASCII logo (`cli/src/login/constants.ts` has a `BEYONDERS` block-letter logo and a `DIRECTIONER` one) |

Note the binary name and the ASCII logo are the two spots where branding is
literal art, not a string. `cli/src/login/constants.ts` holds both logos;
`cli/src/utils/directioner-wordmark.ts` holds the Directioner wordmark. Those are
design work, not find-and-replace.

---

## 5. Identity map — audit of what exists, per the brief's section 4

| Brief item | Current identifier | Where | Note |
|---|---|---|---|
| Command/binary `directioner` | `directioner` / `beyonders` | `directioner/cli/build.ts`, `cli/release-core/launcher.js`, package `bin` |  |
| No `dir` alias | — | — | correct call; `dir` is a Windows builtin |
| Config dir | `HOSTED_CONFIG_DIR` | `cli/src/utils/env.ts:88` | keep absolute-path-only check |
| Local project dir | `.directioner/` | repo root `.directioner/project-id` | also `.beyondersignore` → `.directionerignore` |
| Trust env var | `BEYONDERS_TRUST_AGENT_DIRS` | `cli/src/utils/agent-dir-trust.ts` | invoke also supports `--trust-agents` |
| Remove "Freebucks" | `Freebucks`, `freebucks` | `common/src/types/directioner-session.ts`, UI | pervasive; tied to sessions → removed with them |
| Remove Beyonders/Directioner names+URLs | `beyonders.com`, `directioner.com`, `beyonders.json`, `beyonders-message`, … | throughout | see `0a-egress-inventory.md` |
| BYOK key-from-env-names | already the design | `cli/src/commands/byok.ts` | keep; strengthen as primary path |

Also present and needing decisions (not in the brief's map):

- `beyonders.json` — a config file name (`!beyonders.json` is in `.beyondersignore`).
- `codecane` — the staging package name.
- `.beyondersignore` is read by search/context selection, so renaming it is a
  functional change, not cosmetic; update the reader too.
- `x-beyonders-api-key` header (seen in source) — a wire header; if we keep a
  backend later, rename; if BYOK-only, it disappears.

---

## 6. Recommendation

1. Do not relicense anything. Keep Apache-2.0 on inherited code; add
   `ATTRIBUTION.md`; mark modified files.
2. ⚠ Get a lawyer to resolve the MIT-vs-Apache inconsistency and confirm the
   rebrand/distribute right before release.
3. Treat the ASCII logos and wordmark as design tasks, not sed replacements.
4. Make `.beyondersignore` → `.directionerignore` a paired change (rename file
   *and* its reader).
