# Stage 0 — Discrepancies Between the Brief and the Checkout

Items where the brief's description does not match what is actually in
`/workspace/project`. Each is stated plainly with the evidence, because acting on
the brief's version of events would lead to wrong work.

---

## D1. The checkout path was left blank, and no `directioner` directory exists

The brief says `Source checkout: <FILL IN PATH>`. A repo-wide search found no
`directioner` directory anywhere:

```
$ find / -maxdepth 4 -iname "*directioner*"   → (nothing)
```

`/workspace/project` is the only Directioner checkout present. It matches the
brief's description: remote `github.com/BeyondersAI/directioner`, branch
`build/fix-ai-sdk-json-types`, HEAD `4441b48fc` ("Fix AI SDK v7 JSON type
incompatibility so the SDK build succeeds"). **I proceeded on that basis.** If a
different path was intended, say so and I will redo the audit there.

---

## D2. Desktop, Web, Cloud and Chat surfaces are NOT in this checkout

The brief says: "The repo also holds Desktop, Web, Cloud and Chat surfaces. Do
not build or ship them. List them in the audit and propose removal."

**They are not here.** Top-level directories:

```
.agents? no.  Actual top level: agents assets cli common docs evals directioner
              packages scripts sdk  (+ .directioner .github .git)
```

`find . -type d -iname '*desktop*'` → only `packages/llm-providers/src/openai-compatible/chat`.
`find . -maxdepth 2 -iname '*convex*'` → nothing (no web backend here).
No `.gitmodules`, so they are not submodules.

What *does* exist is **comments citing a sibling repo by path**. 61 hits of the
form:

- `cli/src/utils/sponsored-project-identity.ts:15` — "(`directioner-desktop/src/server/repo/project-db.ts`)"
- `cli/src/utils/sponsored-agent.ts:64` — "(`directioner-desktop/src/server/services/sponsored-run.ts`)"
- `cli/src/utils/sponsored-git.ts:49` — "(`directioner-desktop/src/server/services/turn.ts`)" ... "the two"
- `cli/src/utils/steering-buffer.ts:9` — "shape directioner-desktop uses for the same hook."

So the public repo's comments reference a **private** `directioner-desktop` (and the
web app's Convex backend) that are not published. Consequences for the brief:

- The instruction "do not build or ship them" is satisfied trivially — there is
  nothing here to build.
- "Propose removal" becomes **propose removal of the dead cross-repo comments**
  (61 of them), not of directories. Low value; I would leave most, since they
  document why the CLI code is shaped as it is, and stripping them loses
  rationale. Flagging rather than acting.
- There are stray `cli/src/components/directioner-*.tsx` files
  (`directioner-chat-controls/footer/header`, `directioner-chat-store`) — these are
  **CLI** components (the free-mode chat UI), not the Directioner-web surface. Do
  not delete them thinking they are Web code.

**Open question for Aditya:** is `directioner-desktop` a repo we have access to, and
should any of it be in scope? The brief implies surfaces exist in "the repo";
they do not exist in *this* one.

---

## D3. The repo reportedly Apache-2.0, but the shipped packages declare MIT

Verified: root `LICENSE` is the Apache License 2.0; root `NOTICE` credits
Beyonders; root `package.json` is `"license": "Apache-2.0"`. So far the brief is
right.

But the **release manifests that define the shipped npm packages** declare MIT:

| File | name | license |
|---|---|---|
| `cli/release/package.json` | `beyonders` | **MIT** |
| `cli/release-staging/package.json` | `codecane` | **MIT** |
| `directioner/cli/release/package.json` | `directioner` | **MIT** |

and most inner workspace packages (`cli`, `common`, `sdk/@beyonders/sdk` is
Apache-2.0 actually, `packages/agent-runtime`, `agents`, …) declare **no license
field at all**. `sdk/package.json` and `common/src/templates/.../package.json`
are Apache-2.0.

This is the inconsistency the brief anticipated. Two readings:

1. MIT applies to the distributed npm launcher packages (permissive, fine).
2. It is an error — the source is Apache-2.0 and the release manifests should
   say so.

I cannot tell which was intended from the repo alone. **This needs Aditya (and
probably a lawyer): if we rebrand and distribute, what license do we ship under,
and is relicensing from Apache-2.0 permitted for the derivative?** Apache-2.0
requires preserving the license and NOTICE and marking modifications; it does
**not** permit simply relicensing the derivative unless we own the copyright or
have permission. Downstream we may choose a different license for *our* changes
only in the sense of adding them under Apache-2.0 too — do not relicense the
whole work to MIT without advice. See `0e-license-and-branding.md`.

---

## D4. The "~110 agents" and "~37 tools" counts

The brief says "~37" tools and "~110" agents. Confirmed and refined:

- `toolNames` has **37** entries; `publishedTools` has **32** (minus
  `spawn_agent_inline`).
- Agent `.ts` files: **123**. Distinct agent ids: the earlier map reported 110.
  The file count includes per-model reviewer/thinker variants and helpers.
  Both numbers are "right" for different definitions; I used 123 files / 110
  distinct ids.

Not an error — just pinning the numbers.

---

## D5. The upstream build break: confirmed, and fixed only on the branch

Confirmed. `main` still has the mutable `JSONArray = JSONValue[]`
(`git show main:common/src/types/json.ts`), and the fix exists only on
`build/fix-ai-sdk-json-types`. Both `bun run build:sdk` and
`bun run build:directioner` succeed on that branch (output in `ENVIRONMENT.md`).

**This matters for the PR boundary:** the fix is a real upstream bug fix and
belongs in its own PR against `main` (or upstream). Do not bury it inside a
rebrand PR. Boundary 1 of the brief says branch and open a PR, never merge — so
the plan is two PRs: (1) the JSON fix, (2) later, the rebrand.

---

## D6. `--trust-agents` and the trust gate exist as described

No discrepancy. Verified `cli/src/utils/agent-dir-trust.ts` (339 lines), trust
recorded per absolute path at mode 0600, non-interactive runs skip. Preserve
exactly, rename env var and config path only. Detail in `0d-risk-list.md`.

---

## D7. No unexpected files in the checkout

Checked: no stray documents, no `.docx`, no untracked files other than the two
directories this audit created (`docs/audit/`) and a pre-existing `served/` from
an earlier session. `.beyondersignore` contains `!beyonders.json`,
`__mock-projects__`, `test-repos` — nothing unusual.

Note to self and to the next agent: the checkout is clean. Do not describe
artifacts that are not there.
