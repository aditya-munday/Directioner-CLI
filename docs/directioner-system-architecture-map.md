# Directioner System Architecture Map

A single map of every major component and, more importantly, the **trust and
authority boundaries between them**. Companion to
`directioner-customer-architecture.md` (design) and
`directioner-open-decisions.md` (choices still open).

Two different relationships are drawn separately because conflating them is the
most common architecture mistake:

- **Trust** — may this component's *input* be believed? (data flow)
- **Authority** — may this component *cause* an action? (control flow)

A component can be trusted for data and hold no authority (the backend's model
catalog), or hold authority and be untrusted as data (a model's output). The
map marks both.

---

## 1. Component inventory

| Component | Exists today? | Trust domain | Authority |
| --------- | ------------- | ------------ | --------- |
| Directioner Terminal (CLI) | **yes** | its own | local tools within the workspace boundary; requests only |
| Directioner Website | no | its own | observe/control/request only |
| Aria (future) | no | its own | request only |
| Directioner Backend | no | its own | authorize, route, meter |
| Model Gateway | no | part of backend | select provider, enforce quota |
| AI Providers | external | **untrusted output** | none |
| Local DB / journal | **yes** (implicit) | its own | none (cache + record) |
| Cloud DB | no | part of backend | none (store) |
| Task/Event system | **partial** (execution exists) | spine | none by itself |
| Directioner-OS | separate product | its own | **privileged execution** |
| PolicyEngine | Directioner-OS | OS trust | decide policy |
| Reviewer | Directioner-OS | OS trust | review request |
| `ai-capabilityd` | Directioner-OS | OS trust | perform root-level execution |
| MCP servers | external | **separate trust domain** | declared capabilities only |
| Plugins | future | **separate trust domain** | declared capabilities only |
| Repository | user-controlled | **untrusted input** | none |

The repository is listed as a component on purpose: it is the most common source
of indirect instruction injection, and it has no authority.

---

## 2. The map

```
                          ┌──────────────┐
                          │     USER     │
                          └──────┬───────┘
              ┌──────────────────┼───────────────────┐
              ▼                  ▼                   ▼
      ┌──────────────┐   ┌──────────────┐   ┌────────────────┐
      │  TERMINAL    │   │   WEBSITE    │   │  ARIA (future) │
      │  (CLI)       │   │              │   │                │
      │  TRUST: own  │   │  TRUST: own  │   │  TRUST: own    │
      │  AUTH: local │   │  AUTH: none  │   │  AUTH: none    │
      │        tools │   │  (requests)  │   │  (requests)    │
      └──────┬───────┘   └──────┬───────┘   └───────┬────────┘
             │                  │                   │
             │        typed task/session API (one contract)
             └──────────────────┼───────────────────┘
                                ▼
                  ┌─────────────────────────────┐
                  │  CUSTOMER / SESSION CONTROL │
                  │  Account·Device·Session·Task│
                  │  TRUST: system of record    │
                  │  AUTH: the decider          │
                  └──────────────┬──────────────┘
                                 ▼
                  ┌─────────────────────────────┐
                  │  DIRECTIONER AGENT RUNTIME  │
                  │  plan·context·tools·verify  │
                  │  TRUST: executes            │
                  │  AUTH: bounded by policy    │
                  └──────┬───────────────┬──────┘
                         │               │
                         ▼               ▼
        ┌────────────────────────┐  ┌──────────────────────────┐
        │  DIRECTIONER BACKEND   │  │  LOCAL MACHINE           │
        │  ┌──────────────────┐  │  │  fs · terminal · process │
        │  │  MODEL GATEWAY   │  │  │  repository (UNTRUSTED)  │
        │  │  TRUST: backend  │  │  │  LOCAL DB / JOURNAL      │
        │  │  AUTH: route/    │  │  │  TRUST: cache+record     │
        │  │        meter     │  │  │  AUTH: none              │
        │  └────────┬─────────┘  │  └────────────┬─────────────┘
        │           │            │               │
        │      ┌────▼─────┐      │               │  OS operation
        │      │ CLOUD DB │      │               │  request (intent,
        │      │ TRUST:   │      │               │  scope, risk)
        │      │ backend  │      │               │
        │      └──────────┘      │               ▼
        └───────────┬────────────┘   ┌──────────────────────────┐
                    ▼                │  DIRECTIONER-OS          │
             ┌─────────────┐         │  ┌────────────────────┐  │
             │AI PROVIDERS │         │  │ PolicyEngine       │  │
             │UNTRUSTED    │         │  ├────────────────────┤  │
             │OUTPUT       │         │  │ Reviewer           │  │
             │AUTH: none   │         │  ├────────────────────┤  │
             └─────────────┘         │  │ ai-capabilityd     │  │
                                     │  │ ROOT EXECUTION     │  │
   ┌──────────────┐  ┌─────────────┐ │  └────────────────────┘  │
   │ MCP SERVERS  │  │  PLUGINS    │ └──────────────────────────┘
   │ SEPARATE     │  │  SEPARATE   │
   │ TRUST DOMAIN │  │  TRUST      │      ╔══════════════════════╗
   │ AUTH:        │  │  DOMAIN     │      ║  AUTHORITY BOUNDARY  ║
   │ declared     │  │  AUTH:      │      ║  no client crosses   ║
   │ caps only    │  │  declared   │      ║  this to execute     ║
   └──────────────┘  └─────────────┘      ╚══════════════════════╝
```

---

## 3. Trust boundaries (data flow)

Each boundary below is a place where a component's input must be treated as
**data, never as authority**.

### 3.1 Repository → agent runtime — UNTRUSTED

The repository is user-controlled and frequently not written by the user
(a clone, a dependency, a PR branch). Everything it contains — `AGENTS.md`,
`knowledge.md`, source comments, config files, `.envrc` — is untrusted input.

Existing mitigations in this repo:

- `createMarkdownFileBlock` sizes its fence above the longest backtick run in
  the content and collapses the label to one escaped line, so an instruction
  file cannot close its own block (`common/src/util/file.ts`).
- `sanitizeDisplayedName` / `escapeXmlText` neutralise `<`, `>`, newlines, and
  control bytes in file names and tree output.
- The steering-env guard drops `DIRECTIONER_*`, `BEYONDERS_*`, `HOSTED_MODE`,
  `NODE_OPTIONS`, etc. from a repo's `.envrc`
  (`cli/src/init/init-direnv.ts`), so `direnv allow` cannot reconfigure the
  agent about to run in that repo.

Invariant: repository content can *inform* the agent; it can never *authorize*
an action.

### 3.2 Tool output → agent runtime — UNTRUSTED

Command output, file contents, search results, and MCP responses are all
attacker-influenced. A file the agent reads can contain a line that looks like a
system instruction. The same invariant applies: tool output is data.

### 3.3 Model output → agent runtime — UNTRUSTED

The model can be manipulated (by repository content, by tool output) and can
also simply be wrong. Model output that says "the user approved this" is a
string, not a grant. It is the classic confused-deputy input.

### 3.4 MCP / plugin → agent runtime — SEPARATE TRUST DOMAIN

A plugin is third-party executable behavior. Its *descriptions* are data like any
other tool output, and its *capabilities* are what it was granted, not what it
claims. This is the same threat class as a remote agent template, which this
repo already gates by publisher trust (`sdk/src/agent-publisher-trust.ts`).

### 3.5 Provider → backend — UNTRUSTED OUTPUT

The backend treats provider responses as untrusted content that flows back to
the client. A provider returning malicious text is a 3.3 case, not a backend
trust failure.

### 3.6 Client → backend — UNTRUSTED CONTROLLER

Every client (CLI, website, Aria) is an untrusted controller. It *requests*;
the backend decides. A compromised client must not be able to exceed its
entitlement or reach another tenant (§29 of the architecture doc).

---

## 4. Authority boundaries (control flow)

Authority is held in exactly three places. Nothing else executes.

### 4.1 Local tool authority — the CLI

The agent runtime, running in the CLI, may operate on the local machine **within
the workspace boundary the user granted**. This is the authority that exists
today, and it is enforced by the path/network boundary in the SDK (the
filesystem hardening: `resolveReadPath` / `resolveWritePath`, the kernel-pinned
write primitive, the SSRF guard). A local tool action does not need backend
permission, but it also cannot exceed the workspace.

### 4.2 Cloud action authority — the backend

The backend authorizes cloud actions: which model, how much quota, which
entitlement. It does not execute anything on the user's machine.

### 4.3 Privileged machine authority — Directioner-OS

Root-level execution is Directioner-OS's alone, behind:

```
OS operation request → PolicyEngine → Reviewer → approval tier
  → ai-capabilityd → root execution → verification
```

The CLI **emits a request**; it never executes privileged operations and never
grows a second sudo. Even a valid user approval in the CLI is an *input* to
PolicyEngine, not a bypass of it.

### 4.4 The authority boundary (the thick line in the map)

No user interface — terminal, website, Aria, or a future GUI — crosses from
"request" to "execute a privileged action." A client may only:
create a task, subscribe to events, request/deny an approval, cancel, and read
results. The authority to *do* lives behind the OS boundary.

---

## 5. The confused-deputy model, explicitly

The brief requires this attack be modelled and made to fail:

```
malicious repository
  → Directioner agent
  → "Aria/user approved this"
  → privileged action            ← MUST FAIL
```

and:

```
malicious MCP
  → fake approval
  → OS mutation                  ← MUST FAIL
```

Both fail for the same reason, and it is a property of the *authority* design,
not of any prompt wording:

1. **Approvals are objects, not strings.** An approval has an
   `approval_id`, `task_id`, `operation_id`, `risk_tier`, `scope`, `expires_at`,
   `decision`, and `decision_source` (§21 of the architecture doc). It is
   created by the authorization system, not by text.
2. **Only the system of record can create one.** A repository, a tool result, a
   model, or an MCP server can *say* "approved"; none of them can *write* an
   approval object.
3. **The OS re-checks.** Even a genuine CLI-side approval is only an input to
   PolicyEngine. A fabricated one has no object to present, and a presented one
   is validated against scope, task, and expiry.
4. **Attribution is recorded.** `decision_source` names who decided, so
   "the user approved" is auditable and cannot be asserted anonymously.

The unifying invariant: **text is never authority.** Every confused-deputy
variant is a violation of that one rule.

---

## 6. Identifier flow (observability without content)

The same IDs thread every layer so an operation is traceable without storing
customer content (§35 of the brief):

```
account_id ─┐
user_id ────┤
device_id ──┼──► session_id ──► task_id ──► correlation_id
            │                                   │
            │                                   ├──► event_id
            │                                   ├──► approval_id
            │                                   ├──► operation_id
            │                                   └──► provider_request_id
```

Every log line, event, and backend row can be joined on these IDs. Support can
answer "what happened to task 1234" from IDs alone; analytics can count without
reading content (§40 of the brief).

---

## 7. Failure isolation map

Which component failing takes down what. This is the map that decides whether
the product degrades or breaks (§25 of the architecture doc).

| Fails | CLI usable? | Local tools? | Cloud model? | Task resumable? |
| ----- | ----------- | ------------ | ------------ | --------------- |
| Backend | yes | yes | no (explicit) | yes (local journal) |
| A provider | yes | yes | fallback or explicit error | yes |
| Network | yes | yes | no (explicit) | yes (queued sync) |
| Aria | yes | yes | unaffected | yes |
| Website | yes | yes | unaffected | yes |
| Directioner-OS | yes | yes (non-privileged) | unaffected | OS ops refused, explicitly |
| MCP server | yes | yes | unaffected | yes |
| CLI process | n/a | stops | stops | yes (journal + reconcile) |
| Machine reboot | on restart | after restart | after restart | yes (reconcile on start) |

The pattern: **the CLI and local tools never depend on a cloud component.**
That is what makes offline mode (§26) a first-class state rather than an error
state.

---

## 8. What is real vs designed

Honesty about state, so this map is not mistaken for an implementation report:

- **Real today:** the CLI, the local agent runtime, local tool authority, the
  workspace/network boundary, the repository-injection mitigations, the
  BYOK provider path, the Directioner-owned release pipeline.
- **Partial:** the "task/event system" — execution exists, but tasks and events
  are not yet first-class durable objects (Phase 1–2).
- **Designed, not built:** the backend, model gateway, cloud DB, sync, website,
  Aria, account/device/session control.
- **Respected boundary, not built:** Directioner-OS, PolicyEngine, Reviewer,
  `ai-capabilityd`. This repository does not define their interfaces.

No client is built against an imaginary Aria or OS API. The map exists so that
when those interfaces are real, the task model already has a place for them.
