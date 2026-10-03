# Stage 0b — Feature Inventory and Variant Recommendation

Read-only audit. Identifiers are exact, from source, so each can be grepped.

Counts verified in this checkout: **37** entries in `toolNames`, **32** in
`publishedTools`, **123** agent `.ts` files (the brief's "~110" counts distinct
agent ids; the file count includes per-model variants and helpers), and **30**
`id:` entries in `cli/src/data/slash-commands.ts` (pre-filter — Directioner removes
8, leaving 22 + dynamically generated `/skill:*` and `/model` rows).

---

## 1. CLI flags

Directioner argv surface (`cli/src/cli-args.ts`, `isHosted` branch):

| Flag | Purpose | Class |
|---|---|---|
| `-v`, `--version` | Version | **keep** |
| `--continue [conversation-id]` | Resume | **keep** |
| `--cwd <directory>` | Working directory | **keep** |
| `--trust-agents` | Load repo `.agents` + `mcp.json` without prompting (CI) | **keep** (boundary 4 of the brief: keep exactly, rename only) |
| `-h`, `--help` | Help | **keep** |
| `login` (positional, only choice) | Browser/device login to their service | **remove** (replaced by provider config) |

Absent in Directioner but present in Beyonders: `--agent`, `--clear-logs`,
`--initial-prompt`, `--initial-mode`.

**Recommendation for the fork:** re-add `--agent` and `--initial-mode`. They are
free-product-neutral and useful (scripted agent selection, CI). Re-adding
`--initial-prompt` needs care — it is convenient but it is also the easiest way
to feed untrusted text into the agent; keep it but document it.

---

## 2. Slash commands

Full menu (`cli/src/data/slash-commands.ts`), with the Directioner removals applied:

| Command (aliases) | Purpose | Class |
|---|---|---|
| `/help` (h, ?) | Help banner | **keep** |
| `/diagnostics` (diag, processes) | Local CLI resource usage, tool PIDs | **keep** |
| `/interview` | Agent asks questions → writes `-spec.md` | **keep** (good, provider-neutral) |
| `/plan` | Plan on selected model | **keep** |
| `/review` | Review changes; scope presets | **keep** |
| `/queue` (queued) | Edit/reorder/delete queued messages | **keep** |
| `/new` (n, clear, c, reset) | New chat, aborts in-flight run | **keep** |
| `/history` (chats) | Resume past conversations | **keep** |
| `/copy` (copy-chat) | Copy conversation | **keep** |
| `/export` (export-chat) | Export .md/.json | **keep** |
| `/feedback` (bug, report) | Feedback to their backend | **rewire / remove** (`/api/v1/feedback`) |
| `/bash` (!) | Bash mode | **keep** (see risk list 0d) |
| `/theme:toggle` | Light/dark | **keep** |
| `/byok` (provider) | Direct provider inference | **keep → make primary** |
| `/model` | Model picker | **rewire** (catalog is theirs) |
| `/end-session` | End session, back to landing | **rewire** (Freebucks/session concept) |
| `/dashboard` (usage, stats, streak) | Account hub in browser | **remove** |
| `/logout` (signout) | Sign out of their session | **remove** |
| `/exit` (quit, q) | Quit | **keep** |
| `/skill:<name>` | Run an installed skill | **keep** |

Removed-by-Directioner list: `/ads:enable`, `/ads:disable`, `/usage`,
`/subscribe`, `/agent:gpt-5`, `/image` (/img, /attach), `/publish`, `/init`.

Dispatchable but not menu-listed: `/ads:proposal`, `/ads:dismiss-proposal`,
`/ads:accept-proposal`, `/ads:undo`, `/ads:report-proposal`,
`/ads:never-advertiser`, `/ads:proposals-off`. **All remove.**

Mode commands: none in Directioner (`/mode:*` is generated from `AGENT_MODES` and
filtered out when `IS_HOSTED`).

**Note on `/init`:** it is removed, so this build cannot scaffold `knowledge.md`.
If the fork wants that, `--initial-mode`-style re-adding is needed. Not urgent.

---

## 3. Tools (37 in `toolNames`, 32 in `publishedTools`)

| Tool | Function | Class |
|---|---|---|
| `read_files` | Read files/ranges | **keep** |
| `read_subtree` | Structural map of a directory | **keep** |
| `list_directory` | List entries | **keep** |
| `find_files` | Most relevant files for a request | **keep** |
| `glob` | Filename pattern match | **keep** |
| `code_search` | Ripgrep content search | **keep** (check vendored ripgrep survives) |
| `write_file` | Write file | **keep** |
| `str_replace` | Exact string replace | **keep** |
| `apply_patch` | Structured multi-hunk patch | **keep** |
| `propose_write_file` | Approval-gated write | **keep** |
| `propose_str_replace` | Approval-gated replace | **keep** |
| `run_file_change_hooks` | Client file-change hooks | **keep** |
| `run_terminal_command` | Shell execution | **keep** — highest risk; see 0d |
| `web_search` | Web search | **rewire** (backend-proxied, `/api/v1/web-search`) |
| `read_url` | Fetch and extract a page | **keep** (direct fetch) — but it is how a prompt-injection payload enters; see 0d |
| `read_docs` | Library docs | **rewire** (backend-proxied Context7) |
| `gravity_index` | Third-party integration discovery | **rewire** (backend-proxied) |
| `spawn_agents` | Subagent fan-out | **keep** (orchestration primitive) |
| `spawn_agent_inline` | Inline subagent | **keep** (internal-only; not in `publishedTools`) |
| `lookup_agent_info` | Agent definition lookup | **keep** |
| `add_message` | Append transcript message | **keep** |
| `set_messages` | Set history | **keep** |
| `set_output` | Final output (collapsed by default) | **keep** |
| `end_turn` | End turn | **keep** |
| `task_completed` | Task done | **keep** |
| `ask_user` | Ask the user | **keep** |
| `skill` | Load a skill | **keep** |
| `create_plan` | Produce a plan | **keep** |
| `add_subgoal` / `update_subgoal` | Subgoal list | **keep** |
| `write_todos` | Todo list | **keep** |
| `think_deeply` | Pure reasoning step | **keep** |
| `suggest_followups` | Next-step suggestions | **keep** |
| `render_ui` | Render UI components | **keep** |
| `report_project_profile` | Report project profile | **keep** (check whether the report leaves the machine) |
| `browser_logs` | Browser console logs | **keep** |
| `cloud_plan_ready` | Cloud surface signal | **remove** (Cloud-only) |
| `composio_search_tools`, `composio_get_tool_schemas`, `composio_manage_connections`, `composio_multi_execute_tool` | Composio integrations | **remove** (proxied via `/api/v1/composio/execute`, third-party broker) |

Published-vs-internal: `publishedTools` = `toolNames` minus `spawn_agent_inline`.

---

## 4. Agents (123 `.ts` files; ~110 distinct ids)

Families and class:

| Family | Examples | Class |
|---|---|---|
| Harness roots | `base3`, `base3-lite`, `base2`, `base2-free`, `base2-max`, `base2-plan`, `base-chat`, `base2-fast` | **rewire** — harness names are fine; the `-free` roots are coupled to their model catalog |
| File finding | `file-picker`, `file-picker-max`, `file-lister`, `code-searcher`, `directory-lister`, `glob-matcher` | **keep** |
| Review | `code-reviewer` + ~20 per-model variants | **rewire** — collapse per-model variants to one that takes the configured model |
| Editing | `editor*`, `editor-implementor*` | **keep** |
| Thinking | `thinker*`, `thinker-selector*`, `best-of-n-selector2` | **keep** (collapse variants) |
| Research | `researcher-web`, `researcher-docs`, `librarian` | **rewire** — depend on proxied search/docs |
| Utility | `basher`, `browser-use`, `context-pruner`, `tmux-cli*`, `general-agent` | **keep** (`context-pruner` is hidden from UI — keep) |
| Model-pinned free roots | `base2-free-*`, `base3-free-*` (one per catalog model) | **remove** — this is the rate-limit-queue coupling (see 0c) |
| Paid shortcuts | `gpt-5-agent`, `opus-agent`, `editor-gpt-5`, `code-reviewer-gpt/opus` | **keep or remove** — they are model presets, not backend coupling; deprioritize |

`HIDDEN_AGENT_IDS = ['context-pruner']`; `MAIN_AGENT_ID = 'main-agent'`.

---

## 5. Model roots and the catalog

`common/src/constants/directioner-models.ts` is the catalog:
`GLM 5.3 Flash` (default, unmetered), `DeepSeek V4.1 Flash`, `GPT-6 Luna`,
`MiMo 2.6 Flash`, `MiMo 2.6 Pro`, `Solar Mini 4`, `Solar Pro 4`,
`Space Bunny Alpha`, `Gemini 3.8 Flash`, `Muse Spark 1.2`. Limited tier
(`LIMITED_HOSTED_MODEL_IDS`): GLM 5.3 Flash, DeepSeek V4.1 Flash,
MiMo 2.6 Flash, Solar Mini 4, Solar Pro 4.

Withdrawn: `Ox Alpha` (allowlist entry kept so live sessions drain).
Retired: `DeepSeek V4 Pro`.

Class: **remove the hosted catalog.** Replace with the user's configured
provider(s). The model-picker UI can stay; its data source changes.

---

## 6. Memo — which build variant to base on

Two candidate bases.

**Option A — the Directioner variant** (`HOSTED_MODE=true`).
Pros: smallest argv surface; the compile-time flag already
dead-code-eliminates paid features, billing, credits display and mode
switching (verified: ad/CAPI hosts are in source but absent from the built
binary). Its trust surface is smallest today.
Cons: it *bakes in free-tier assumptions* that are exactly what we must remove —
Freebucks, session admission, "plans" walls, the ad rail, the hosted catalog and
its per-model queue pinning. It removes `/mode:*`, `--agent`,
`--initial-prompt`, `--clear-logs`. Those removals are hostile to a
bring-your-own-key tool.

**Option B — the full variant** (default `IS_HOSTED=false`), then strip
account, billing, ads and usage.
Pros: keeps `--agent`, `--initial-mode`, `--initial-prompt`, `--clear-logs` and
mode switching, which a BYOK tool wants. The paid features to strip are
concentrated in known places (`cli/src/ads/`, `common/src/ads/`,
`common/src/constants/directioner-*`, session API, Stripe/pixel env).
Cons: bigger starting surface; assumes login and a hosted account, so more must
be removed up front.

**Recommendation: Option B — the full Beyonders variant, stripped — with one
caveat.** Reason: the Directioner variant's value is that it already removed
billing/ads *by construction*, but its removals include the provider-neutral
capabilities we need back (agent selection, modes, initial prompt). Building on
it means re-adding them, i.e. working against the flag rather than with it. The
full variant lets us delete the account/billing/ads layer as one deliberate
patch and keep the general-purpose CLI intact.

Caveat and honest uncertainty: I have **not** measured how much of the full
variant's account/billing code is entangled with the agent runtime. If, on
inspection, the account layer turns out to be load-bearing for the runtime
(e.g. `userId` threaded through tool handlers for metrics), Option A may be
cheaper after all. I recommend a spike: attempt to build the CLI with
`IS_HOSTED=false` and login disabled, and count the type errors. That spike is
a Stage 1 task and needs approval.

Evidence pointers: `directioner/SPEC.md` (the flag's intent),
`cli/src/utils/constants.ts` (`IS_HOSTED`), `cli/src/cli-args.ts` (the two
argv branches), `common/src/constants/directioner-models.ts` (catalog),
`common/src/constants/free-agents.ts:825` (queue pinning comment).
