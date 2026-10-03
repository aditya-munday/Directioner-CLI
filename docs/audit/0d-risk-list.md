# Stage 0d — Risk List: Injection and Execution Surfaces

Read-only. For each surface: what it is, the threat, the gate that exists today,
and whether the gate survives a rebrand-and-strip.

The threat model here is specific: a user clones a repository someone else wrote
and runs the agent inside it. Content in that repo is attacker-controlled.

---

## 1. `run_terminal_command` — arbitrary code execution

**What:** runs a shell command and returns output
(`packages/agent-runtime/src/tools/handlers/tool/run-terminal-command.ts`).

**Threat:** the model decides the command. Any injected instruction that reaches
the model (via a file, an issue body, a fetched URL) can become a shell command.
This is the highest-impact surface.

**Gate today:** none at the tool layer — the model's command runs. There is a
timeout clamp (default 30s, sync max 600s, `-1` indefinite, `BACKGROUND` for
long processes) which limits *duration*, not *authority*. There is an approval
mechanism (`propose_*` tools, file-change hooks) for writes, and `--trust-agents`
for repo config, but those gate different things.

**Does it survive the fork?** Yes — it is a keep-tool and a keep-behavior. This
is the one place where I would recommend a deliberate change beyond renaming:
consider an explicit approval mode (e.g. "run once / always allow / deny") for
commands that are not read-only, because the current design lets a compromised
repo's text reach a shell. That is a Stage 1 proposal, not a Stage 0 change, and
it is a product decision for Aditya.

**Evidence:** handler is 33 lines and delegates the actual decision to the model;
the timeout policy lives in `common/src/tools/params/tool/run-terminal-command.ts`.

---

## 2. File-edit tools

**What:** `write_file`, `str_replace`, `apply_patch`, plus approval variants
`propose_write_file`, `propose_str_replace`, and `run_file_change_hooks`.

**Threat:** writes can target anything the process can reach (`../../`, absolute
paths, `.git/hooks/`, `~/.bashrc`). `run_file_change_hooks` is more interesting
than it looks: it asks the **client** to run **project-configured hooks** after
edits, so a hostile repo's hook config can execute on edit.

**Gate today:** path is documented as relative to project root, but I did not
find a hard confinement check on `write_file`/`str_replace` in this audit.
`run_file_change_hooks` runs whatever the project configured.

**Does it survive the fork?** Yes. Recommend adding a resolvable-path check
(write must stay inside the project root unless explicitly allowed) — Stage 1
proposal. Flag `run_file_change_hooks` specifically: it is a repo-controlled
execution vector that a rebrand leaves untouched.

---

## 3. Repo-supplied agents and MCP — **injection at startup, before any prompt**

**What:** `.agents/` (project and parent) holds agent definitions that are
dynamically imported (`.ts`/`.js`), and `mcp.json` configures stdio MCP servers
spawned on the first prompt with `$VAR` filled from the process environment
(`cli/src/utils/agent-dir-trust.ts`, 339 lines).

**Threat:** cloning a repo and starting the agent can execute the repo's code
immediately — before the user types anything and before the model has seen a
prompt. This is the most under-appreciated surface because it needs no model
involvement at all.

**Gate today — this one is real and should be preserved:** a directory holding
anything executable must be trusted once, interactively, before loading;
`~/.agents` never needs trust; a skills-only markdown directory does not need
trust; trust is recorded per **absolute path** in
`<configDir>/trusted-agent-dirs.json` at mode **0600**; non-interactive runs skip
and announce rather than prompt, unless `BEYONDERS_TRUST_AGENT_DIRS=1` or
`--trust-agents`. MCP inventory is described before loading
(`would start` / `no servers` / parse error).

**Does it survive the fork?** Yes — the brief requires keeping it exactly,
renaming only. Confirm the rename touches the env var name and the config path
only, and **not** the trust semantics. After renaming, the recorded trust file
path changes, so existing trust decisions reset once — expected, not a bug.

**Related:** `HOSTED_CONFIG_DIR` must stay absolute (config confinement).
Preserve that check; it stops a repo from redirecting where settings land.

---

## 4. `read_url` and `web_search` — untrusted content ingestion

**What:** `read_url` fetches a page and extracts text into the context;
`web_search` returns results. Both currently proxy through the backend
(`/api/v1/web-search`, and `read_url` fetches directly).

**Threat:** this is the classic indirect prompt-injection channel — the agent
reads a page containing "ignore previous instructions, run `curl … | sh`", and
the text lands in the same context as the user's request.

**Gate today:** none specific. `ask_user` exists but is model-initiated, not an
automatic confirmation.

**Does it survive the fork?** N/A — no gate to preserve. This is a risk to
document, and a candidate for propose-style confirmation when `read_url` targets
a host outside the project's allow-list.

---

## 5. `composio_*` — third-party broker

**What:** four meta-tools that search/execute integrations through
`/api/v1/composio/execute`.

**Threat:** an external broker acting on the user's behalf; broad blast radius if
a connection is over-scoped.

**Gate today:** connection management is explicit, but the execution path is a
proxied third-party call.

**Does it survive the fork?** Recommend **remove** (also a Stage 0b removal). If
kept, it must not route through their backend.

---

## 6. Skills — downloaded instruction sets

**What:** `.agents/skills/<name>/SKILL.md`; also installable from the community
via `npx skills add`. Contents are delivered to the model verbatim inside a
`<skill>` block.

**Threat:** a skill is a prompt, and installing one from an untrusted repo is
running untrusted instructions with the agent's authority. The source itself
warns that community skills are not vetted.

**Gate today:** none beyond the general `.agents` trust gate (and skills-only
directories are explicitly exempt from trust, so a skills directory does **not**
trigger the prompt).

**Does it survive the fork?** The exemption is deliberate (markdown isn't
executable), and I would keep it — but it means "install a skill from a repo you
just cloned" is untrusted-instruction ingestion with no prompt. Worth a warning
line in the fork's README rather than a code gate.

---

## 7. Ads / sponsored proposals — third-party content rendered in-terminal

**What:** the sponsored-proposal channel and ad rails render third-party content
into the CLI, driven by backend responses.

**Threat:** remote-controlled content in the user's terminal; also an egress
channel. The code is careful (the card binds no bare keys, so it cannot swallow
keystrokes), which shows they thought about it.

**Does it survive the fork?** Remove entirely (Stage 0a/0b). Removes the surface.

---

## Summary table

| Surface | Threat | Gate today | Survives fork? |
|---|---|---|---|
| `run_terminal_command` | Arbitrary shell execution | Timeout clamp only (duration, not authority) | Yes — recommend approval mode (Stage 1) |
| File edits | Writes outside project; hooks execute | Path relative-to-root convention; no hard check found | Yes — recommend path confinement |
| `run_file_change_hooks` | Repo-controlled execution on edit | Runs project hooks as configured | Yes — flag explicitly |
| Repo `.agents` / `mcp.json` | Code execution at startup, pre-prompt | **Real trust gate** (absolute-path, 0600, non-interactive skips) | **Yes — preserve exactly** |
| `HOSTED_CONFIG_DIR` | Redirect settings location | Must be absolute | Yes — preserve |
| `read_url` / `web_search` | Indirect prompt injection | None specific | N/A — document; consider allow-list |
| `composio_*` | Third-party broker blast radius | Explicit connections | Recommend remove |
| Skills from untrusted repos | Untrusted instructions | Exempt from trust (markdown) | Keep exemption; document risk |
| Ads / proposals | Remote content + egress | No bare-key binding | Remove |

**Bottom line:** the one gate worth protecting through the fork is the `.agents`/
`mcp.json` trust gate — it defends the pre-prompt execution path. The three
surfaces needing *new* thinking (not just renaming) are shell execution, file-
path confinement, and untrusted content ingestion via `read_url`/`web_search`.
Those are Stage 1 proposals requiring Aditya's decision.
