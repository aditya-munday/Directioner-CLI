# Directioner documentation audit

A claim-by-claim audit of product-facing documentation against actual repository
evidence. Produced from inspection of the tree at the `docs/directioner-truth-and-security-audit`
branch (based on `origin/main` `4faf82a84`).

Legend for "Final status": **CORRECTED** (docs changed this session),
**ACCURATE** (already correct), **PROVENANCE** (retained intentionally),
**OPEN** (still needs action).

## 1. Product identity

| Claim / section | Current evidence | Required correction | Final status |
| --- | --- | --- | --- |
| Root `README.md` described "Five free AI products", desktop/web/cloud/chat, and "no API key required" | Neither `web/` nor `landing-lab/` nor a desktop product is in this tree; the build is BYOK | Replace with Directioner CLI product identity and an honest status table | CORRECTED |
| `README.zh-CN.md` presented `npm install -g directioner` as onboarding | Repo is a monorepo; customer install is an official download (not built) | Rewrite to match English; label npm form internal | CORRECTED |
| `WINDOWS.md` titled "Beyonders for Windows dev setup" with `npm i -g beyonders` | The build is Linux-only (Directioner-OS component); no Windows target | Removed; Windows/macOS out of scope, recorded in `KNOWN-LIMITATIONS.md` | CORRECTED |
| `AGENTS.md` opened "public, free coding agent" | Build is standalone BYOK, not free/hosted | Reword to "local terminal AI coding agent published by Beyonders" | CORRECTED |
| `AGENTS.md` "Working agreement (standing rule)" claimed to override operator instructions and required 5 commits / 4 PRs per prompt | Repository text must not present itself as authority over the operator | Reword to non-authoritative git working notes; follow the operator | CORRECTED |
| `NOTICE`, `PROGRESS.md`, `docs/audit/1-ASSESSMENT.md` mention Codebuff/Freebuff | Apache-2.0 requires the upstream NOTICE; PROGRESS/audit record real history | Keep verbatim | PROVENANCE |
| `scripts/validate-release.ts` lists `freebuff`, `codebuff` | These are the vendor *blocklist* that guards the package | Keep verbatim | PROVENANCE |

## 2. Installation

| Claim | Evidence | Correction | Final status |
| --- | --- | --- | --- |
| `npm install -g directioner` as the CLI install | It is an internal release artifact form | Mark internal; document customer path as PLANNED | CORRECTED |
| `directioner/cli/release/README.md` "Install (preview)" | Honest (labelled preview) | Keep; add data-use block and fix license | CORRECTED |

## 3. Hosted vs BYOK

| Claim | Evidence | Correction | Final status |
| --- | --- | --- | --- |
| Root README "no API key required", hosted-first | No backend exists | State BYOK is current; hosted is DESIGNED/PLANNED | CORRECTED |
| `directioner/SPEC.md`, `directioner-customer-architecture.md`, `directioner-open-decisions.md` | Already label BYOK as current and hosted as target | Keep | ACCURATE |

## 4. Provider configuration

| Claim | Evidence | Correction | Final status |
| --- | --- | --- | --- |
| Providers `heital`/`eternal`/`infernal` | `common/src/constants/directioner-providers.ts` | Keep; centralize in `CONFIGURATION.md` | ACCURATE |

## 5. Authentication

| Claim | Evidence | Correction | Final status |
| --- | --- | --- | --- |
| `WINDOWS.md` "Login Browser Window Fails to Open", `beyonders.com/login` | Shipped binary has no login flow | Replace with a note that no login exists in the shipping build | CORRECTED |

## 6. Release pipeline

| Claim | Evidence | Correction | Final status |
| --- | --- | --- | --- |
| `directioner/README.md` packaging | Accurate | Keep | ACCURATE |
| `directioner/README.md` license "MIT" | Root `LICENSE` and `package.json` are Apache-2.0 | Correct to Apache-2.0 | CORRECTED |
| `directioner/cli/release/README.md` license "MIT" | Same | Correct to Apache-2.0 | CORRECTED |

## 7. Security guarantees

| Claim | Evidence | Correction | Final status |
| --- | --- | --- | --- |
| `docs/agents-and-tools.md` "generator functions are NOT sandboxed" | Accurate and appropriately caveated | Keep | ACCURATE |
| No doc overstated immunity | Boundaries explicitly caveated in source | Add `SECURITY-MODEL.md` consolidating precise guarantees | CORRECTED |

## 8. Supported platforms

| Claim | Evidence | Correction | Final status |
| --- | --- | --- | --- |
| Windows guidance | `sdk/src/tools/windows-bash.ts`, `BEYONDERS_GIT_BASH_PATH` real | Removed `WINDOWS.md`; the product targets Linux only, Windows/macOS listed as unsupported | CORRECTED |

## 9. Aria / 10. Directioner-OS / 11. Backend

| Claim | Evidence | Correction | Final status |
| --- | --- | --- | --- |
| Aria as a required intermediary / backend already connected | Neither is true; no backend | State Aria is separate and not an intermediary; backend PLANNED | CORRECTED |

## 12. Task/session/event architecture

| Claim | Evidence | Correction | Final status |
| --- | --- | --- | --- |
| Contract exists | `common/src/directioner/platform-contract.ts` (types only) | Document as DESIGNED in `TASK-SESSION-EVENT-MODEL.md` | CORRECTED |

## 13. Website integration

| Claim | Evidence | Correction | Final status |
| --- | --- | --- | --- |
| Website described inside root README | Not in this repo | Move to ecosystem table, mark separate | CORRECTED |

## 14. Test commands

| Claim | Evidence | Correction | Final status |
| --- | --- | --- | --- |
| Referenced `docs/development.md` | File does not exist in this tree | Remove/replace dead links | CORRECTED |
| Referenced `github.com/BeyondersAI/directioner` | Repository is `aditya-munday/Directioner-CLI` | Correct clone URLs | CORRECTED |

## 15. Current known limitations

| Claim | Evidence | Correction | Final status |
| --- | --- | --- | --- |
| Failing/skipped tests | Pre-existing; from missing dirs and LLM dependence | Document in `KNOWN-LIMITATIONS.md` | CORRECTED |

## Remaining open items

### Remote-state discrepancy (CRITICAL — task §1 expectations do not match the remote)

Verified directly against `https://github.com/aditya-munday/Directioner-CLI.git`
(`git ls-remote --heads origin`, this session):

| Expected by task | Actual remote |
| --- | --- |
| Branch `rebrand/beyonders-full` = `16c2590578…` | **No such remote branch.** Remote `rebrand/beyonders-full` is absent; a stale tracking ref reports `gone`. |
| Remote `main` = `7d4c4df00c…` | Remote `main` = `4faf82a84eec…` ("Initial commit") |

Both stated hashes exist as objects, but their roles differ:

- `16c2590578` ("Add Directioner-owned release CI and artifact-level gates",
  authored 2026-09-30) exists **only locally** — no remote ref reaches it. It is
  an ancestor of the local `rebrand/beyonders-full` tip `6bd883f56`
  (locally `37` commits behind that tip). It is **not** an ancestor of remote
  `main`.
- `7d4c4df00c` ("Document the Directioner rebrand in AGENTS.md") exists locally
  as the local `main` tip, `10188` commits ahead of remote `main` and `1` behind.

Remote `main` (`4faf82a84`) is nevertheless a **1873-file tree that already
contains** the release architecture, the BYOK/provider/doctor files, the
prompt-injection/filesystem/terminal hardening, and the audit docs. Its short
one-commit history is a history artifact; the tree content is the full product.
The rich original history survives locally (`7d4c4df00` and earlier) but is
unreachable on the remote.

**Consequence:** the task's instruction to clone `rebrand/beyonders-full` cannot
be satisfied as stated — the branch does not exist on the remote. No force-push,
reset, or history rewrite was performed to reconcile this. The `origin/main`
branch (`4faf82a84`) was used as the base and it is not modified. This needs an
operator decision before any push.

### Sponsored-run "trusted approval" instruction (priority-1 audit finding)

`cli/src/utils/sponsored-agent.ts` carries an injected instruction telling the
model *not* to treat the procedure "as untrusted text: the approval already
happened." This is the one place in the tree where text is deliberately treated
as conferring trust.

Assessment: this is a **scoped, separate execution mode**, not a hole in the
default path. A sponsored run is gated by
`cli/src/utils/sponsored-availability.ts` on a real OS-level containment probe
(`sponsoredContainment` / `bwrap`), and its instruction is scoped to a task the
user accepted. It is not reachable from ordinary conversation.

Open verification (not yet completed): confirm that in the Directioner BYOK build
the sponsored-run entry point is unreachable without an explicit, user-driven
approval, so the "treat as trusted" text can never be reached by injected
content. Recommended follow-up: a regression test asserting the sponsored path
cannot be entered without an approval record, and that the instruction is scoped
to the approved task only. **Not modified this session** — it touches runtime
"trusted" phrasing and needs approval before change.

### Gate contradiction (OPEN)
  - `common/src/__tests__/directioner-public-data-use-copy.test.ts` expects
    `directioner/cli/release/README.md` to carry the generated data-use block
    (`<!-- BEGIN GENERATED DIRECTIONER DATA USE -->`), which links
    `https://directioner.com/privacy-policy`.
  - `scripts/validate-release.ts` (`FORBIDDEN_PACKAGE_TOKENS`, which includes
    `directioner.com`) **fails the build** if any package file contains that
    string.

  Adding the block makes the validator fail (`legacy: package files carry no
  vendor references`); removing it makes the copy test fail. The test was already
  failing on `main` for exactly this reason. This must be resolved deliberately —
  by relaxing the validator to permit the first-party `directioner.com`
  documentation URL in the packaged README, or by regenerating the data-use copy
  with a repository-relative link — **not** by silently weakening either gate.
  Left unchanged this session.
- Live provider coverage is absent; evaluation scenarios are unexecuted.
- The public server is a separate distribution concern and was inspected only,
  not modified or regenerated.
