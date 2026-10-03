# Directioner — Stage 0 Audit

Read-only audit of the Beyonders/Directioner checkout that Directioner will be built
from. **No code was changed.** Every claim cites a file or a command; where
something is unknown it says so.

Checkout: `/workspace/project` — `github.com/BeyondersAI/directioner`, branch
`build/fix-ai-sdk-json-types`, HEAD `4441b48fc`.
Date: 2026-09-28.

## Documents

| File | Covers |
|---|---|
| [`ENVIRONMENT.md`](./ENVIRONMENT.md) | Tool inventory, Bun install, build verification with real output, `gh` auth blocker |
| [`0-DISCREPANCIES.md`](./0-DISCREPANCIES.md) | **Read this first.** Seven places the brief and the checkout disagree |
| [`0a-egress-inventory.md`](./0a-egress-inventory.md) | Every host, URL, API path and outbound env var, in source and in the built binary, classified remove / repoint / keep |
| [`0b-feature-inventory.md`](./0b-feature-inventory.md) | All flags, slash commands, 37 tools, ~110 agents, model roots — keep / remove / rewire, plus the variant recommendation |
| [`0c-coupling-map.md`](./0c-coupling-map.md) | What depends on the hosted backend, what breaks, and the decoupling order |
| [`0d-risk-list.md`](./0d-risk-list.md) | Shell execution, file edits, repo `.agents`/MCP, `read_url`; which gates exist and survive |
| [`0e-license-and-branding.md`](./0e-license-and-branding.md) | LICENSE/NOTICE, the MIT-vs-Apache inconsistency, Apache-2.0 obligations, identity map |

## The four findings that most affect the plan

1. **Desktop/Web/Cloud/Chat are not in this checkout** (D2). The brief assumed
   they were. Only comments referencing a private `directioner-desktop` remain.
   "Propose removal" becomes a much smaller job than described.

2. **Every prompt and every byte of source currently goes to beyonders.com**
   (0a §C1): the client POSTs to `beyonders.com/api/v1/chat/completions` and the
   server holds the provider keys. Making inference direct-to-provider is the
   precondition for any privacy claim, and it is the first decoupling step.

3. **Three agent tools are quietly backend-proxied** (0a §C6): `web_search`,
   `read_docs`, `gravity_index`. Removing the backend leaves them broken unless
   their fate is decided explicitly.

4. **The `.agents`/`mcp.json` trust gate is the one gate worth protecting**
   (0d §3): it defends code execution that happens at startup, before any
   prompt. Keep it exactly; rename only.

## Recommended variant

Base on the **full Beyonders variant, stripped** rather than the Directioner variant
— with a spike to confirm. The Directioner flag's dead-code elimination works
(verified), but it also removes provider-neutral capabilities we want back
(`--agent`, modes, `--initial-prompt`). Full memo in `0b-feature-inventory.md`
§6.

## Stage 0 gate

Stopped here per the brief. No rebranding, stripping, or code changes have been
made. Stage 1 begins only on Aditya's approval.

## Open questions for Aditya

1. Is `/workspace/project` the intended checkout, and do we have access to
   `directioner-desktop`?
2. Which license is correct — Apache-2.0 (root, SDK) or MIT (the three release
   manifests)? Needs a lawyer before shipping.
3. The variant choice (0b §6) — approve the spike, or pick a base directly?
4. Should the fork add an approval gate for `run_terminal_command` and file-path
   confinement, or keep current behavior and document the risk?
5. `gh` is unauthenticated — provide a token so Stage 1 can open PRs.
