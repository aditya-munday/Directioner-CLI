# Directioner Customer Architecture

Status: **design only.** Nothing in this document is implemented unless a
section explicitly says so and names the file. The current shipped product is
the BYOK CLI described in `directioner/SPEC.md`; that is the *implementation*
today, and it is a **development/testing mode**, not the production customer
target. The production customer path is the hosted architecture in §1. This
document describes the platform the CLI is the first client of, and the path
from the current implementation to it.

Authoritative constraints at time of writing:

- Aria has no implementation and no Aria↔CLI contract exists.
- Directioner-CLI has no Directioner-OS integration.
- The CLI is a separate trust domain from Directioner-OS.
- Directioner-OS privileged actions stay behind PolicyEngine → Reviewer →
  `ai-capabilityd`. The CLI never becomes the privileged authority.
- The current binary is BYOK-first: no mandatory login, no mandatory
  Directioner endpoint, requests go from the user's machine to the configured
  provider. **This is the current implementation, not the production customer
  target.** The production customer path is the hosted architecture in §1: an
  authenticated CLI using Directioner-owned backend/model services, with no
  provider credential on the client. See D3 in
  `directioner-open-decisions.md`. BYOK remains available as a
  development/testing mode and must not be presented as public onboarding.

This document does not invent an Aria protocol, does not define an OS control
API, and does not assume a backend exists. Where a decision depends on the real
website/account system, it is listed in `directioner-open-decisions.md` rather
than guessed.

---

## 1. Product vision

Directioner is a platform for delegating work to an agent that operates on the
user's real machine. The terminal is the first and primary way to reach it, but
it is not the only one, and it is not a wrapper around a future voice product.

The vision in one sentence: **one task/runtime architecture, many clients,
one authority boundary.**

A user at a terminal types:

> "My Wi-Fi is broken. Diagnose it and fix it."

and the CLI runs that as a task. Later, the same user may say the same sentence
to a website, a desktop GUI, or a future Aria client, and each of those must
drive **the same task machinery** — same task identity, same event stream, same
approvals, same authorization — not a parallel agent pipeline.

The failure mode this architecture exists to prevent is the common one: a CLI
grows an API, a second client is built against it, and the two slowly diverge
until "fix my build" means something different in each. That divergence is
avoided by making the task/session/event model the product's spine and treating
every UI as a thin controller over it.

What is *not* the vision:

- Aria is not the entry point and not the authority. It is a client.
- The website is not a second execution path. It is a control and history
  surface that invokes the same task machinery.
- The CLI is not a thin terminal skin over a cloud agent. It is the core local
  execution experience and stays useful with no network at all.

---

## 2. Core architectural layers

```
┌───────────────────────────────────────────┐
│ USER INTERFACES                            │
│ Directioner Terminal (exists)              │
│ Future Aria · Future GUI/Desktop           │
│ Directioner Website (account/history)      │
└───────────────────┬───────────────────────┘
                    │  typed task/session API (one contract)
                    ▼
┌───────────────────────────────────────────┐
│ CUSTOMER / SESSION CONTROL                 │
│ Account · Device · Session · Task          │
│ Permissions · Entitlements                 │
└───────────────────┬───────────────────────┘
                    ▼
┌───────────────────────────────────────────┐
│ DIRECTIONER AGENT RUNTIME                  │
│ Planning · Context · Repo intelligence     │
│ Tool selection · Execution · Verification  │
│ Recovery · Event stream                    │
└──────┬────────────────────────────┬────────┘
       │                            │
       ▼                            ▼
┌────────────────────┐   ┌─────────────────────┐
│ DIRECTIONER BACKEND│   │ LOCAL MACHINE        │
│ auth · model gw    │   │ filesystem · terminal│
│ usage · quota      │   │ processes · repo     │
│ billing · history  │   │ local DB · OS        │
│ sync               │   │ integration          │
└─────────┬──────────┘   └──────────┬──────────┘
          ▼                          ▼
     AI providers            Directioner-OS
                             authority layer
```

The load-bearing line in that diagram is the arrow from the interfaces into
session control. Every interface crosses that line through the same contract;
none of them reaches the runtime, the backend, or the OS directly.

Today only the top-left box (Terminal) and the local-machine box exist. The
backend column is design. The website and Aria boxes are design. The
Directioner-OS box is a boundary this document respects, not a thing this
document specifies.

---

## 3. Direct CLI user flow

This flow exists today and must keep working unchanged.

```
user types a request
  → CLI resolves the configured provider (config.json → env var name → key)
  → agent runtime plans, reads the repo, calls tools
  → tools run against the local machine under the path boundary
  → result streamed to the terminal
```

Properties that must survive the platform work:

- No login is required to start.
- No Directioner endpoint is contacted. Egress is the configured provider only
  (`directioner/SPEC.md` §5, verified with an `LD_PRELOAD` interceptor).
- The API key is never stored; the config holds the *name* of the env var.
- `--doctor` answers "will this work?" without opening the TUI.

In platform terms this flow becomes "a task created locally, executed locally,
with a local event journal." The near-term work (Phase 1–2 below) is to make the
CLI *record* that it is doing this, without changing what it does. The local
task/event model is introduced behind the existing behaviour, not in place of
it.

---

## 4. Future Aria flow

Aria does not exist. This section defines only what the CLI must expose so that
Aria *can* exist later without a rewrite. It deliberately does not define an
Aria wire protocol.

The requirement on the task model:

```
Aria
 ↓
Directioner task/session interface   (same contract the terminal uses)
 ↓
Directioner agent runtime            (same runtime)
 ↓
backend + tools                      (same path)
 ↓
Directioner-OS authority             (same boundary)
```

What Aria would need from the task API, expressed as data, not as a protocol:

- create a task from a natural-language request
- subscribe to a task's events
- receive clarification requests and permission requests
- approve or deny a pending approval
- cancel a task
- read a result summary and machine-readable errors

Every one of those is already needed by the terminal client. Aria is therefore
"another authorized client of the task system," and the design obligation is to
keep the task API client-neutral: no field in it may assume a terminal, a
keyboard, or a single foreground session.

The anti-requirement: Aria must never be able to assert authority the user did
not grant. A request that arrives from Aria is attributed to Aria, carries the
same identity/authorization/provenance fields as any other client, and cannot
claim "the user approved this" on its own. See §24.

---

## 5. Website flow

The website is an **account, control, and history surface**, not an execution
path. It is expected to eventually let a signed-in user:

- see their devices and revoke one
- see their tasks and a task's status, progress, and history
- pause, cancel, or inspect a running task
- inspect usage and manage subscription
- view an action history
- start a task (which is *submitted into the same task machinery*, not executed
  by the website)

The website is a client like any other. A website action that controls a task
must invoke the same task/authorization machinery the CLI uses. The website must
not be able to execute a privileged operation by "being the website." Its trust
level is identical to Aria's: it can *request*; the authorization state decides.

Because the website and account system are the one piece this repository cannot
inspect, everything that depends on their real shape is an open decision
(identity protocol, pairing flow, token lifetimes). This document states the
contract the CLI needs and leaves the mechanism open.

---

## 6. Account architecture

```
Account
 ├── users            (people who may act)
 ├── devices          (registered local installations)
 ├── sessions         (a device+user's active authenticated context)
 ├── entitlements     (what the account is allowed to do)
 └── security events  (auth, revocation, suspicious activity)
```

An account is the billing and ownership unit. A user is an actor within it. A
device is a specific installation. A session is a bounded, revocable
authenticated context on a device. Entitlements are separate from identity
(§31). Security events are append-only records of anything that changes trust.

Identifiers, and what each one is *for*:

| ID              | Identifies                         | Scope              | Notes |
| --------------- | ---------------------------------- | ------------------ | ----- |
| `account_id`    | the billing/ownership unit         | tenant boundary    | every backend authorization is tenant-scoped against this |
| `user_id`       | an actor                           | within an account  | a future team account has many |
| `device_id`     | a registered installation          | within an account  | revocable |
| `session_id`    | an authenticated context           | within a device    | short-lived, rotatable |
| `task_id`       | one unit of work                   | within a session   | stable across clients and restarts |
| `correlation_id`| one end-to-end request chain       | within a task      | ties client request → backend → provider |

The rule that follows from the table: **an ID from one scope must never be
accepted as authority in another.** A `device_id` presented where a `session_id`
is expected, or a `task_id` from another account, is a rejection, not a lookup.
This is the mechanism behind §29's cross-tenant requirement.

---

## 7. Device architecture

A device is a registered installation with its own credential, distinct from the
user's. Reasons it must be a first-class object rather than "the user's token on
a laptop":

- a lost laptop is revoked by revoking its device, without logging the user out
  everywhere
- usage and abuse limits attach to a device (§38)
- the local database, journal, and session cache belong to a device
- the backend can distinguish "same user, new machine" from "same device,
  new user"

Device lifecycle: `unregistered → pending_pairing → active → (suspended |
revoked)`. A revoked device cannot refresh; its local session cache must be
treated as invalid and its outstanding refresh tokens refused server-side.

The device is the unit that owns the *local* security material (§42): the
refresh credential in OS secure storage, the local database, the event journal.
A device is not a trust domain boundary by itself — a compromised device is
assumed hostile (§29) — but it is the right granularity for revocation.

---

## 8. Authentication

Four credentials exist and must never be confused:

| Credential         | Authenticates            | Held by            | Lifetime            |
| ------------------ | ------------------------ | ------------------ | ------------------- |
| Customer credential| the account/user         | website + device   | long (refreshable)  |
| Device credential  | a registered installation| local secure store | rotated             |
| Backend credential | internal service↔service | backend only       | short               |
| Provider credential| the backend to providers | backend only       | secret, backend-only|

The last row is the correction that matters most for this product. **Provider
credentials are a backend concern.** In the current BYOK product the *user*
holds their own provider key and it never leaves their machine
(`directioner/SPEC.md` §3). In the future hosted product the *backend* holds
provider credentials and the client holds only a Directioner session. Both are
valid; they are different products sharing one runtime, and the client must
never be handed a backend provider secret in either.

The identity protocol (OIDC? device authorization grant? something the real
website already uses?) is an open decision. This document fixes only the
*properties*: short-lived access tokens, rotating refresh tokens, device-bound
sessions, revocable, tenant-scoped.

---

## 9. Session architecture

A session is the authenticated context in which tasks run. It is bounded and
revocable, and it is the object an attacker most wants (§29).

Session properties:

- **Short-lived access token** (minutes) plus a **rotating refresh token**.
- **Device-bound**: a session belongs to one `device_id`.
- **Revocable** independently of the account and of the device's other sessions.
- **Entitlement-carrying but not entitlement-authoritative**: the session
  records the user's entitlements as a cache; the backend re-checks them on
  every decision. A tampered local cache must not grant anything.
- **Not a task**: a session can host many tasks and outlive them.

Refresh-token rotation with reuse detection: presenting an already-rotated
refresh token is treated as compromise — the session is revoked and a security
event is written. This is the standard mechanism; we do not invent cryptography
(§28).

---

## 10. Task architecture

A task is the durable unit of work. This is the spine (§1).

```
Task
 ├── task_id
 ├── user request
 ├── account_id · device_id · session_id
 ├── workspace (repository · branch · worktree · path)   §25
 ├── model / capability request                          §6
 ├── state
 ├── events[]                                             §9
 ├── approvals[]                                          §21
 ├── tool activity
 ├── results
 └── timestamps
```

State machine:

```
created → queued → running → { waiting_for_user | waiting_for_provider |
                               paused | cancelling | recovering }
        → { cancelled | failed | completed }
```

Design rules:

- A task outlives any single client. Closing the terminal does not cancel it;
  it moves to a resumable state (§14).
- A task outlives the process. The CLI crashing mid-task leaves a durable record
  that the next start can reconcile (§14, §32).
- A task records *which workspace it was planned against* so a resume against a
  changed repository is detected, not silently continued (§14, §26).
- `waiting_for_user` and `waiting_for_provider` are distinct states, because the
  recovery action differs: one waits for an approval, the other for capacity.
- Task identity is stable across clients: the terminal, the website, and a
  future Aria all refer to the same `task_id`.

The CLI already performs work that maps onto this model. Phase 1 (below) makes
the mapping explicit without changing the execution path.

---

## 11. Event model

Everything meaningful a task does emits a structured event. This is the
foundational decision (§9 of the brief) and the enabler for history, recovery,
sync, support, audit, and every future UI.

Event names (initial set):

```
task.created          task.started          task.paused
task.resumed          task.cancelled        task.failed
task.recovered        task.completed

model.requested       model.stream_started  model.stream_ended
tool.requested        tool.started          tool.completed
file.changed          command.started       command.completed
approval.requested    approval.granted      approval.denied

device.registered     session.started       session.revoked
security.event
```

Each event carries: `event_id`, `task_id`, `correlation_id`, `type`,
`timestamp`, and a type-specific payload. Payloads are typed and small; they are
not a dumping ground for conversation JSON (§11 cloud DB rule).

Two properties matter more than the list:

1. **The journal is append-only and durable locally** (§10 local DB). A task's
   history is reconstructable from its events, including after a crash.
2. **Events are the sync unit** (§13). The backend ingests events, not raw
   conversation. This is what keeps "analytics" from becoming "collect source
   code" (§40).

Events are also the reason a future GUI, a future Aria, and the website can all
render the same task without a shared UI library: they subscribe to the event
stream.

---

## 12. Local database

SQLite, migrated from the first commit. The client already has local state; it
should stop being implicit.

Proposed tables:

```
migrations          schema_version, applied_at
account             cached account identity (no secrets)
device              this device's identity + registration state
session             cached session metadata + expiry (token in OS store, §42)
task                task_id, state, workspace, model, timestamps
task_event          append-only journal (§11)
workspace           repository · branch · worktree · path (§25)
approval            approval objects (§21)
tool_execution      per-tool activity + result classification
provider_state      cached health/capability metadata (not credentials)
sync_cursor         last acknowledged backend cursor (§13)
local_action_log    privileged-action intent/result, for audit (§22)
```

Rules:

- Migrations are versioned and forward-only. No ad-hoc schema edits.
- No secrets in the DB. The refresh credential lives in OS secure storage; the
  DB holds a reference, not the value.
- The DB is **tamper-evident for authorization purposes**: nothing in it can
  authorize an action by itself (§29, §42). It is a cache and a journal, not an
  authority.
- The journal is bounded by an explicit retention rule (§36), not unbounded
  growth.

---

## 13. Cloud database

Relational, tenant-scoped, designed before it is built.

```
accounts          users             devices          sessions
tasks             task_events       action_events    approvals
entitlements      subscriptions     usage            quotas
models            providers         provider_health  sync_state
security_events   support_cases
```

Requirements:

- **Every row that belongs to a customer carries `account_id`**, and every
  authorization check filters on it (§29). There is no "look up by ID and hope."
- Foreign keys are real, retention is explicit per table (§36), and indexes
  exist for the access patterns (task-by-account, events-by-task, usage-by-window).
- The DB is **not** a dumping ground for arbitrary conversation JSON (§11 of the
  brief). Task events are typed rows. Raw prompts/source are a separate,
  classified, retention-bounded store (§12 of the brief, §36 here).
- `provider_health` and `models` are configuration-ish tables the gateway reads
  (§15), not customer data.

---

## 14. Synchronization

```
local event
  → durable local journal
  → sync queue
  → authenticated backend
  → idempotent server ingestion
  → cloud action ledger
```

Handled cases, each with a mechanism rather than a hope:

| Case                  | Mechanism |
| --------------------- | --------- |
| offline               | queue persists locally; sync is opportunistic |
| reconnect             | queue drains in order, from `sync_cursor` |
| retries               | bounded, with backoff; the event is not lost |
| duplicate delivery    | every event has an idempotency key; ingestion is upsert |
| ordering              | monotonic per-task sequence number, not wall clock |
| gaps                  | cursor detects a hole and requests the missing range |
| partial sync          | per-event acknowledgement, not per-batch |
| client restart        | cursor + journal on disk resume the queue |
| backend restart       | ingestion is stateless over the journal; no in-memory state to lose |

The one rule that makes this tractable: **an event is immutable and identified.**
Sync is "which identified events has the backend acknowledged," never "we
probably sent it once."

Conflict handling: the local journal is authoritative for what the *device*
did; the cloud ledger is authoritative for what the *account* did across
devices. When they disagree (§45), the cloud ledger wins for shared state and
the local journal is preserved as evidence, never overwritten.

---

## 15. Model gateway

The backend owns everything about models so the client does not have to.

Backend responsibilities:

```
model catalog · routing · provider credentials · provider selection
fallback · rate limits · quota · cost control · provider health
retry policy · capability metadata · usage accounting
```

The CLI consumes a **Directioner model/session API**, never a provider API with
a backend secret. The client asks for a *capability* and a *policy outcome*; the
gateway decides which provider satisfies it.

This is deliberately the opposite of today's BYOK client, and both are correct
for their product: BYOK keeps the user's key on the user's machine and talks
directly to the provider; the gateway keeps the provider key on the backend and
talks to the provider on the user's behalf. The runtime is the same; only who
holds the provider credential differs.

Design requirement: the gateway is a **decision point**, not a proxy that
blindly forwards. Every request it accepts is checked against entitlement,
quota, and capability before a provider is chosen.

---

## 16. Provider abstraction

Models are not interchangeable. The runtime requests capabilities; the gateway
maps capabilities to a concrete model.

Capability vocabulary (initial):

```
text · tool_calling · structured_output · streaming
vision · large_context · reasoning · code_generation
embeddings (where relevant)
```

Rules:

- A request names the capabilities it needs (e.g. "tool_calling + streaming +
  large_context"), not a vendor or a model string.
- The gateway holds a **capability profile per model** and refuses to route a
  request to a model that lacks a required capability — rather than routing it
  and failing mid-stream.
- The client may express a *preference* (cost, latency, model family) but the
  gateway owns the final choice, because only the gateway knows health, quota,
  and cost.
- Capability metadata is backend-owned and versioned; a client that caches it
  treats the cache as a hint (§12 local DB), never as authority.

The current BYOK registry (`common/src/constants/directioner-providers.ts`)
already separates product name, upstream, protocol, and endpoint. That shape —
identity separate from wire detail — is the right seed for the capability
profile.

---

## 17. Usage and quota

Usage is measured where it is incurred (the gateway), not where it is requested
(the client). Quota is checked before a request is admitted, and reconciled
after it completes.

- Per-request: tokens in/out, model, provider, latency, cost estimate.
- Per-task: aggregate over the task's events (§11).
- Per-device / per-account: the rate-limit surface (§38).

The client may show usage from its local journal (local-first, §26) but the
backend value is authoritative. A tampered local counter changes nothing.

---

## 18. Billing and entitlement

These are four separate things and must never collapse into one check (§31):

```
Authentication  — who is this?            (session)
Authorization   — may this actor do this? (policy + tenant scope)
Entitlement     — is this feature/model in their plan? (plan)
Usage/Billing   — how much, and who pays?  (metering)
```

Concretely: an authenticated user with an active subscription may still be
denied a premium model (not entitled), and an entitled user may still be denied
because quota is exhausted. Each is a distinct, separately testable decision
with its own error (§32).

The client never decides any of the four. It *displays* them and *requests*
them. "Authenticated" in the client means "the session is valid," not "the
action is allowed."

---

## 19. Privacy

Every datum has a classification, and the classification decides where it may
go:

```
LOCAL_ONLY             raw repository state; never leaves the device
SYNC_METADATA          task_id, state, timestamps, usage counters
CLOUD_ALLOWED          what the service genuinely needs to function
EXPLICIT_USER_UPLOAD   a bundle/log/diagnostic the user chose to send
SECRET                 never leaves its boundary
```

Applied:

- Raw source and diffs are `LOCAL_ONLY` unless the user uploads them or the
  service cannot function without them — and when the service needs them, that
  is a `CLOUD_ALLOWED` decision made explicit, not a default.
- Task events are `SYNC_METADATA`: enough to reconstruct *what happened*, not
  the content that flowed through.
- Support bundles are `EXPLICIT_USER_UPLOAD` (§30) and are user-initiated.
- Provider credentials are `SECRET` and live only on the backend (§8, §15).

The rule: **collection is a decision with a purpose, not a side effect.** Any
future analytics must satisfy §40.

---

## 20. Secrets

Non-negotiable:

- Backend provider credentials live only on the backend.
- No production secret in the CLI, the npm package, git, the frontend, the
  client database, `.env`, or logs.
- The BYOK client holds the *user's own* provider key only in the environment,
  never on disk — the current design stores the env var *name*
  (`directioner/SPEC.md` §3) and must keep doing so.
- The hosted client holds a **refresh credential in OS secure storage** (§42),
  not a plaintext file.
- Logs and error messages never include a key, token, or refresh value (§30).

The distinction this document insists on: a *user's own* key on the user's
machine is not a leak; a *backend* key on a client is. The architecture must make
the second impossible, not merely discouraged.

---

## 21. OS authority boundary

Directioner-OS is the privileged authority. The CLI is not, and does not grow a
second sudo.

The eventual path for any privileged action:

```
CLI (or any client)
  → OS operation request (intent + scope + risk)
  → PolicyEngine
  → Reviewer
  → approval tier
  → ai-capabilityd
  → root-level execution
  → verification
```

The CLI's obligations toward that boundary:

- It emits a **request**, never a privileged command.
- It carries the authorization state it has (task, session, approvals) so
  PolicyEngine can judge; it never asserts authority it lacks.
- It accepts the outcome — including "denied" — and reports it; it does not
  retry a denied operation through another path.
- It records the intent and result locally (§12 `local_action_log`) so a
  privileged action that succeeds but is not reported (§45) is still
  reconcilable.

None of this is implemented. It is recorded so the task model has a place to
carry an OS operation request without inventing an OS API now (§48).

---

## 22. Permission model

Permissions are held by the *system of record*, not by the client, and are
checked at the point of execution.

- **Local tool actions**: bounded by the path/network boundary the CLI already
  enforces (see the filesystem-boundary work). The agent's authority is "the
  workspace and what the user approved," nothing ambient.
- **Privileged OS actions**: authorized by PolicyEngine under Directioner-OS,
  never by the CLI.
- **Backend actions**: authorized tenant-scoped, per request.

A permission is bound to a scope and an operation, not to a session. "The user
signed in" is never a permission (§31). "The user approved operation X for
task T until time Z" is (§21 approval objects).

---

## 23. MCP and plugins

MCP servers and plugins are **separate trust domains** (§43). A plugin is code
from a third party running in the user's environment; it is closer to the
"remote agent template" problem already gated in
`sdk/src/agent-publisher-trust.ts` (remote templates are executable code and are
gated by publisher trust) than to a data file.

Design obligations, not implementations:

- **Discovery** is not trust. Finding an MCP server does not authorize it.
- **Trust decision** is explicit and revocable, like a publisher trust entry.
- **Capability declaration**: a plugin declares what it will do; the declared
  set is what it is granted, not "everything the runtime can do."
- **Sandboxing**: a plugin's tool calls cross the same boundaries a built-in
  tool does; it gets no privileged path.
- **Provenance**: every tool call records which plugin made it.
- **Revocation**: trust can be withdrawn and the plugin stops loading.

The hard rule: **a plugin must not become a hidden root path.** A malicious MCP
that fabricates "the user approved this" must fail exactly as a malicious
repository does (§24).

---

## 24. Security threat model

The threats that shape the design, and the invariant that defeats each:

| Threat | Invariant that must hold |
| ------ | ------------------------ |
| Malicious repository content instructs the agent | Repo-supplied text is untrusted input; it cannot create authorization. (Existing: `createMarkdownFileBlock` fence sizing, `sanitizeDisplayedName`, steering-env guard.) |
| Confused deputy: repo → agent → "user approved" → privileged action | Only **authorization state** authorizes. A claim of approval in any text (repo, tool output, MCP, model) is data, never a grant. |
| Malicious MCP fabricates an approval | Same as above; approvals are objects in the system of record (§21), not strings. |
| Stolen customer session token | Short-lived tokens, device binding, rotation with reuse detection, revocation (§9). |
| Compromised device | Assumed hostile: it cannot exceed its entitlement, cannot read another account's data, cannot authorize privileged actions by itself. |
| Malicious client (CLI/Aria/website) | All clients are untrusted controllers; they request, the backend decides (§16, §29). |
| Cross-tenant access by ID change | Every backend check is `account_id`-scoped (§6, §13). |
| Replay | Idempotency keys + monotonic sequences (§14); request signing where useful (§28). |
| Provider returns malicious content | Model output is untrusted, exactly like repo content; it cannot authorize. |
| Model generates a dangerous command | Execution authority is separate from generation; a dangerous command is an operation request that must be authorized (§21). |
| Database compromise | Secrets are not in the customer DB; provider keys are backend-only; classification limits blast radius (§19, §20). |
| Insider access | Tenant scoping + audit events + least privilege (§28, §29). |

The single invariant that unifies the top rows: **text is never authority.**
Repo files, knowledge files, tool output, MCP descriptions, and model output are
all untrusted *data*. Authorization exists only as structured state in the
system of record. Every confused-deputy variant is a special case of violating
this.

---

## 25. Failure and recovery

Failure is explicit and actionable (§32 of the brief). The user is told *which*
component failed and what they can do.

| Failure | Behaviour |
| ------- | --------- |
| Backend unavailable | local-first continues (§26); cloud features degrade with a named reason |
| Provider unavailable | gateway capability-checked fallback (§7) if permitted; otherwise an explicit "provider down" state, never a silent model swap |
| Quota exhausted | explicit, with the reset time and the entitlement that applies |
| Account expired | explicit; local tools still work |
| Network unavailable | local-first; journal queues for sync |
| Local model available | usable without backend |
| Local model unavailable | explicit, not a hang |
| OS control plane unavailable | OS operations refused with a clear reason; the CLI does not fall back to doing it itself |
| Repository corrupted | task revalidates and stops rather than continuing a stale plan (§14) |
| Interrupted task | reconcilable from the journal on next start (§14) |

The anti-pattern this forbids: collapsing any of these into "something went
wrong."

---

## 26. Offline mode

Offline is a first-class state, not an error state.

The user can, with no network:

- inspect the local repository
- inspect local task history and previous actions
- run `--doctor` and diagnose configuration
- use permitted local tools
- use a local model if configured
- continue a task that does not need the backend

What genuinely needs the network (cloud model, sync, website control) degrades
explicitly. Nothing about the *terminal UI* becomes unusable because a cloud
request failed (§26).

---

## 27. Multi-client control

Multiple clients observe and control the same task through the same typed API.

```
Terminal starts task
      ↓
Website sees task            (subscribe to events)
Aria receives progress       (subscribe to events)
User cancels from terminal
      ↓
Aria receives cancellation   (event stream delivers it)
```

Design consequences:

- The task's state lives in one place (local journal + cloud ledger), not in a
  client's memory.
- Control operations (pause/cancel/approve) are events with an actor, so "who
  cancelled this" is answerable.
- Two clients racing to control one task is resolved by the system of record,
  not by last-writer-wins in memory. A control request that arrives after the
  task left the relevant state is rejected with the current state, not applied
  blindly (§45).

---

## 28. Release and update model

The Directioner-owned release architecture stays (§27 of the brief). It already
exists: `scripts/validate-release.ts` is the pre-release gate,
`.github/workflows/directioner-release.yml` is the pipeline, and the launcher
ships a bundled binary + `tree-sitter.wasm` so the installed package contacts no
download origin.

Future requirements on top of it:

- signed artifacts + checksums + version metadata
- rollback
- update verification
- release channels and staged rollout
- no arbitrary executable download; never fall back to legacy vendor
  infrastructure

The existing validator already enforces the version-consistency chain
(source → build → package → binary); signing and channels extend that gate
rather than replacing it.

---

## 29. Support and diagnostics

A user reporting "something broke" needs a diagnostic bundle that is useful and
safe.

The bundle contains:

- Directioner version, OS version
- device/session IDs, task IDs
- sanitized errors
- timing information
- configuration *state* (which provider, which model) without secrets

It does **not** contain: full repositories, source, secrets, or tokens. It is an
`EXPLICIT_USER_UPLOAD` (§19): the user chooses to send it. The existing
`--doctor` report (names the key *variable*, never the value) is the seed of
this bundle.

---

## 30. Cost model

Cost is designed before the backend is built (§37 of the brief), because billing
cannot be designed without understanding inference cost.

Dimensions:

```
cost/user · cost/task · cost/model · cost/provider · cost/tool usage
```

Inputs that change the answer:

- average task length and retries
- failed and long-running tasks
- premium vs fallback models
- free-tier economics and abuse

The gateway (§15) is the only component that can measure this honestly, because
it is where provider requests actually happen. Free-tier design and abuse
control (§38) are downstream of this measurement, not guesses made in the
client.

---

## 31. Future enterprise architecture

Designed for, not built (§41 of the brief):

- team accounts, organization roles, admin policies
- managed devices, audit export
- model restrictions, repository policies
- SSO, compliance controls

The design accommodates these without polluting the base: an account already has
users and devices (§6); roles and policies are additional authorization rules
evaluated by the same tenant-scoped checks (§13); SSO is an authentication
mechanism, not a new identity model (§8). Nothing in the base architecture
assumes a single user per account, so enterprise is an extension, not a
rewrite.

---

## 32. Migration from today's CLI

The path from the current BYOK CLI to this platform, in the order the brief
requires (§47). Each phase leaves a working product.

**Phase 0 — architecture, threat model, open decisions.** This document and its
two companions. No code.

**Phase 1 — CLI internal session/task/event abstractions.** Introduce the task
and event model *inside* the CLI, wrapping the existing execution path. The CLI
starts recording `task.created`, `tool.started`, `file.changed`, etc. Behaviour
is unchanged; the product is not yet cloud-connected. This is where the platform
starts. The task/event model is written against the provider-neutral client
contract (`common/src/directioner/platform-contract.ts`); BYOK is preserved as a
separate development adapter behind it.

**Phase 2 — local durable event/action database.** The SQLite journal (§12),
migrated from the first commit. History and recovery become real.

**Phase 3 — client/backend abstraction.** A typed client interface the CLI talks
to, with a local-only implementation today and a backend implementation later.
No backend required yet.

**Phase 4 — account/device authentication integration.** Only when the real
website/account system exists and its protocol is known (open decision).

**Phase 5 — backend model gateway.** After explicit architecture approval.

**Phase 6 — cloud persistence/synchronization.**

**Phase 7 — usage/entitlement/billing.**

**Phase 8 — deep Directioner-OS integration.**

**Phase 9 — future Aria client integration.**

The rule: do not jump from today's CLI to production backend code. Each phase is
independently shippable and independently reversible.

---

## 33. Architecture review: the ugly cases

The impressive product is the one that still behaves when things fail. Each
question below is answered architecturally, with the mechanism named.

**What happens if the backend dies?**
The CLI keeps working: local tools, local history, and `--doctor` do not touch
the backend. Cloud model calls fail explicitly ("backend unavailable"), tasks
keep their local journal, and sync queues. Nothing about the terminal UI becomes
unusable (§26, §25).

**What happens if the CLI dies?**
The task is not lost: the local journal is durable and append-only, so the next
start reconciles an interrupted task from its events (§11, §14). A task that was
`running` becomes reconcilable rather than silently gone.

**What happens if the user loses Internet?**
Offline is a first-class state (§26). Local work continues; sync pauses at the
cursor and resumes on reconnect (§14). The failure is named, not collapsed into
"something went wrong."

**What happens if Aria disconnects?**
Nothing: Aria is a client, not a participant in execution (§4). The task
continues; Aria re-subscribes to the event stream when it returns. Its absence
cannot corrupt or stall a task.

**What happens if two clients control one task?**
The system of record resolves it (§27). Control operations are events with an
actor; a control request that arrives after the task left the relevant state is
rejected with the current state, not applied blindly. There is no in-memory
last-writer-wins.

**What happens if a task is resumed after the repository changed?**
It is detected, not ignored (§14). The task records the workspace it was planned
against; on resume the files the plan touches are revalidated. If they changed,
the task moves to `waiting_for_user` with the diff and requires confirmation
(D11). A stale plan is never applied to changed code.

**What happens if a provider fails halfway through a stream?**
`model.stream_started` was emitted without `model.stream_ended`, so the partial
turn is identifiable in the journal. The gateway may capability-checked fall back
(§7) if policy permits; otherwise the task enters an explicit provider-failure
state. A half-received response is never treated as complete.

**What happens if an attacker steals a session token?**
It is short-lived and device-bound (§9), so its window is small and its use on a
different device fails. Refresh rotation with reuse detection revokes the session
and writes a security event (§9, §24). Revocation is independent of the account
and of the device's other sessions.

**What happens if a malicious repository claims the user approved something?**
It fails (§5, §24). An approval is an object in the system of record with an
`approval_id`, scope, and expiry; repository text cannot create one. Text is
never authority.

**What happens if an MCP server attempts privilege escalation?**
It fails the same way (§23, §24). A plugin's capability set is what it was
granted, not what it declares or claims; it crosses the same boundaries a
built-in tool does and gets no privileged path. A fabricated approval has no
object to present.

**What happens if a customer tampers with the local database?**
Nothing that matters (§12, §24). The local DB is a cache and a journal, not an
authority. Entitlement, quota, and authorization are re-checked by the backend;
a tampered local counter or approval cache grants nothing.

**What happens if cloud action history disagrees with local history?**
The cloud ledger is authoritative for account-wide state; the local journal is
preserved as device evidence and never overwritten (§14). The disagreement is
reconcilable because both sides are identified, immutable events, not mutable
rows.

**What happens if an OS operation succeeds but the CLI crashes before reporting it?**
The intent was recorded locally before the request (§21 `local_action_log`), so
the operation is reconcilable on next start: the CLI asks the OS control plane
for the operation's real outcome rather than assuming it failed and retrying a
privileged action.

**What happens if an OS operation fails halfway through?**
The OS control plane owns the operation's transactional semantics; the CLI's
obligation is to not assume success. It records the failure, surfaces it
explicitly (§25), and does not retry a partially-applied privileged operation
without a fresh authorization.

**What happens if a reboot occurs while a task is active?**
The task is durable (§10, §11). On restart the CLI reconciles from the journal
and the workspace state, then resumes, re-plans, or asks — per the same resume
validation as any interruption (§14, D11).

**What happens if the same task request is submitted twice?**
Idempotency keys make duplicate submission a no-op at the system of record
(§14). The same request produces one task; a retry delivers the existing task,
not a second execution.

**What happens if a model generates a dangerous command?**
Generation and execution are separate authorities (§21, §24). A dangerous command
is an operation request that must be authorized; the model's output cannot
authorize its own execution. Local tool authority is bounded by the workspace;
privileged actions cross the OS boundary.

**What happens if a provider returns malicious content?**
It is untrusted output, exactly like repository content (§24). It can influence
the model's context but cannot authorize anything; a prompt injection delivered
through a provider response is a §3.2/§3.3 case, not a new threat class.

**What happens if the website and CLI have different versions?**
Capability negotiation over versioned events (D21). The backend rejects unknown
capabilities explicitly rather than silently degrading, and an N-1 window keeps
a lagging client working. Version skew is a normal state, not a failure.

---

## 34. Acceptance test for this design

The design is correct only if all of the following resolve into the **same**
underlying concepts — `Account → Device → Session → Task → Event →
Authorization → Result` — rather than separate implementations:

| Interaction | Must resolve to |
| ----------- | --------------- |
| Terminal: "Fix my build." | a locally-created task; local tool authority |
| Terminal: "Diagnose my Wi-Fi." | a task whose remediation is an OS operation *request* |
| Future Aria: "Fix my Wi-Fi." | the same task type via the same task API |
| Website: "View task #1234." | a subscription to the same event stream |
| Future Aria: "What's Directioner doing?" | a read of the same task state |
| CLI: "I need permission to change X." | an approval object with scope + expiry |
| Future Aria: "Directioner needs your approval for X." | the same approval object, surfaced by another client |
| User: "No." | the approval is denied; the task stops safely |
| User: "Yes." | the approval is granted; the OS authority still evaluates and executes under its own policy |

The design fails this test if any row introduces a second pipeline, a second
approval representation, or a second execution path.

---

## 35. Open decisions

Every decision that needs an explicit product/architecture choice is listed in
`directioner-open-decisions.md`, with options, tradeoffs, a recommendation, its
dependency, and whether it blocks implementation. The ones that gate the most
work:

- identity protocol and device pairing mechanism (depends on the real website)
- D3 is resolved: production is the hosted path; BYOK is development/test only.
- where the local/cloud split falls for task content (§19)
- when Phase 3 begins relative to Phase 4
