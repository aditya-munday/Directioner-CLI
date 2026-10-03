# Directioner Open Decisions

Every decision below needs an explicit product or architecture choice before the
work that depends on it can be built. Nothing here is decided; each entry states
the options, the tradeoffs, a recommendation, what it depends on, and whether it
blocks implementation today.

Companion documents: `directioner-customer-architecture.md` (the design) and
`directioner-system-architecture-map.md` (the trust/authority map).

Legend for **Blocks**:

- **yes** — a later phase cannot start correctly without this decision.
- **phase N** — blocks Phase N in `directioner-customer-architecture.md` §32,
  not earlier phases.
- **no** — can be deferred without blocking the near-term roadmap.

---

## D1. Identity protocol

**Decision.** What authenticates a user to the Directioner backend.

**Options.**
1. OIDC against an existing provider the website already trusts.
2. A first-party account system the website owns.
3. A device authorization grant (RFC 8628) layered on whichever account system
   exists.

**Tradeoffs.** OIDC reuses infrastructure and gets SSO nearly for free (§31), but
constrains the account model to the provider's. A first-party system is maximal
control and maximal cost, including security surface we must own. The device
grant is not an alternative to (1)/(2) — it is the *pairing* mechanism on top of
whichever identity provider exists, and is the standard shape for a CLI.

**Recommendation.** Decide the account system first (D2), then use the device
authorization grant for the CLI regardless. Do not invent a bespoke token
protocol (§28 of the brief).

**Depends on.** The real website/account system, which this repository cannot
inspect.

**Blocks.** phase 4.

---

## D2. Account system ownership

**Decision.** Whether Directioner accounts are first-party or delegated.

**Options.** First-party; delegated to an identity provider; hybrid (identity
delegated, profile/entitlement first-party).

**Tradeoffs.** First-party means owning password reset, MFA, breach response.
Delegated means less control over the login UX and a dependency on the
provider's availability. Hybrid is the common industry answer but adds a
reconciliation step between two sources of identity truth.

**Recommendation.** Hybrid, if the website already has an identity provider;
otherwise first-party with the understanding that security work (§28) is
permanent.

**Depends on.** The real website architecture.

**Blocks.** phase 4.

---

## D3. Production model access — RESOLVED

**Status: resolved by product direction.** This decision is no longer open; the
text below records the decision and the reasoning, and supersedes the earlier
"BYOK and hosted: coexist or replace" draft.

**Decision.** Directioner production customers use **Directioner-owned
authenticated backend/model services**. The normal customer path is:

```
Directioner Account
  → authenticated Directioner CLI
  → Directioner-owned backend
  → Directioner model/service gateway
  → server-side model/provider credentials
  → selected provider/model
```

**BYOK is development/testing functionality and is not the primary customer
architecture.** It may remain for local development, engineering tests, and
explicit developer/test configurations, and it must not be removed where it is
genuinely useful. It must not be presented as the public onboarding model.

**Reasoning (the requirements this serves).**

- **No provider credentials exposed to customers by default.** The customer
  holds a Directioner session, not a provider key.
- **Centralized model/provider routing.** One place decides provider, model,
  fallback, and health.
- **Provider abstraction.** The client requests a capability; the backend maps
  it to a model. Provider replacement does not require client reconfiguration.
- **Server-side secrets.** Provider and internal credentials live only on the
  backend, never in the CLI, npm package, git, or the client database.
- **Centralized usage/entitlement control.** Quota, entitlement, and cost are
  enforced where the provider request happens.
- **Consistent CLI / website / future Aria service architecture.** All three
  are clients of the same authenticated service; none of them owns a provider
  credential.
- **Future provider replacement without client reconfiguration.** A customer's
  install does not name a vendor, so swapping the provider behind the gateway
  is a backend change.

**What this means for the two modes, kept explicitly separate:**

| | Production hosted mode | Developer/test BYOK mode |
| --- | --- | --- |
| Who authenticates | the customer, to Directioner | nobody (or a developer's own account) |
| Who holds the provider key | the backend | the developer, in their environment |
| Onboarding | account → install → device register → use | write a config file, export a key |
| Support surface | the production product | engineering only |
| Status | **designed, not built** | **built and verified today** |

**Implementation state — stated accurately.** The backend does not exist because
the interface is designed. Concretely:

- The **hosted production path is not implemented.** There is no Directioner
  backend, no model gateway, no auth service, no cloud sync. The client-side
  contract for it lives in `common/src/directioner/platform-contract.ts` and is
  types and pure helpers only.
- The **BYOK path is implemented and verified** today
  (`cli/src/utils/directioner-byok.ts`, `common/src/constants/directioner-config.ts`,
  `directioner/SPEC.md`). It is real; it is just not the production customer
  story.

**Consequence for documentation.** Customer-facing docs must lead with the
hosted story and label BYOK as development/test-only. This is tracked as its own
task, not assumed to follow from the decision.

**Depends on.** Nothing further — decided.

**Blocks.** phase 1 (the CLI's task/event model is written against the
provider-neutral contract, and BYOK is preserved as a separate development
adapter behind it).

---

## D4. Provider credential custody

**Decision.** Who holds the provider API key in each product.

**Options.** User machine (BYOK, developer/test only); backend (hosted, the
production customer path); both, selected by product.

**Tradeoffs.** Backend custody enables model routing, quota, and cost control
(§15) but makes the backend a high-value target (§24, database compromise). User
custody keeps the secret off our infrastructure but gives up routing and usage
accounting — which is why it is now the *development* path, not the customer
path.

**Recommendation.** Production custody is backend. A BYOK turn must never send a
key to the backend; a hosted turn must never receive a provider key. The second
half is the new invariant implied by D3: the client contract
(`common/src/directioner/platform-contract.ts`) has no field that can carry a
provider credential, so a hosted turn *cannot* receive one by construction.

**Depends on.** D3 (resolved).

**Blocks.** phase 5.

---

## D5. Model gateway: proxy or decision point

**Decision.** Is the gateway a transparent proxy to providers, or an
authorization/selection layer?

**Options.** Transparent proxy; decision point (capability check + entitlement +
quota before routing).

**Tradeoffs.** A proxy is trivial and useless for cost/abuse control. A decision
point is where quota, entitlement, capability, and cost are actually enforced
(§15) — and is the only place that can implement §7 fallback safely.

**Recommendation.** Decision point. A proxy would push every policy decision
into the client, which §16 forbids.

**Depends on.** D3, D4.

**Blocks.** phase 5.

---

## D6. Capability vocabulary

**Decision.** The exact capability set the runtime requests and models declare.

**Options.** A fixed initial set (text, tool_calling, structured_output,
streaming, vision, large_context, reasoning, code_generation, embeddings); an
open/extensible set; per-provider metadata passthrough.

**Tradeoffs.** Fixed is testable and prevents "model X is special" leakage into
the runtime. Open is flexible but unenforceable. Passthrough reintroduces vendor
coupling into the agent runtime, which §16 exists to prevent.

**Recommendation.** Fixed initial set, versioned, backend-owned. Add
capabilities deliberately, not by passthrough.

**Depends on.** D5.

**Blocks.** phase 5.

---

## D7. Task content classification boundary

**Decision.** Which task content is `LOCAL_ONLY` vs `CLOUD_ALLOWED` (§19).

**Options.**
1. Metadata only: events and counters sync; no content ever.
2. Content on demand: content syncs only when the user opts in per task.
3. Content by default: prompts/diffs sync for service features.

**Tradeoffs.** Metadata-only is the strongest privacy posture and still supports
history, recovery, and the website's task view. Content-by-default enables
server-side features and analytics but makes the backend a repository of
customer source, which §19 and §40 treat as a decision, not a default. On-demand
is the middle path and matches `EXPLICIT_USER_UPLOAD`.

**Recommendation.** Metadata-only by default; content only as
`EXPLICIT_USER_UPLOAD`. Revisit only if a concrete feature requires otherwise,
and record the retention rule at that time (§36 of the brief).

**Depends on.** Product/privacy direction.

**Blocks.** phase 2 (the local journal's shape must know what is syncable).

---

## D8. Local database engine and migrations

**Decision.** Confirm SQLite and choose migration tooling.

**Options.** SQLite (embedded, single-file) with a hand-rolled versioned
migration runner; SQLite with an existing migration library; an embedded
alternative (e.g. a log-structured store).

**Tradeoffs.** SQLite is the obvious fit for a local client and is already
implicit in the product's needs. A migration library adds a dependency but
removes a class of bugs. The journal's append-only property (§11) argues for
tables over a bespoke log format.

**Recommendation.** SQLite with a minimal versioned migration runner. Keep
migrations forward-only and checked in.

**Depends on.** Nothing external.

**Blocks.** phase 2.

---

## D9. Event schema versioning

**Decision.** How task events evolve without breaking the journal, sync, and
future clients.

**Options.** Versioned event types with a schema registry; a single schema with
optional fields; per-event versioning with upcasters.

**Tradeoffs.** A single evolving schema is simple until an old client meets a
new event. Per-event versioning is more machinery but is the only approach that
lets a Phase 2 journal be read by a Phase 6 backend and a Phase 9 Aria without
guessing.

**Recommendation.** Event type + version, with upcasters on read. Events are
immutable; readers adapt.

**Depends on.** D8.

**Blocks.** phase 1 (the first event written fixes the shape).

---

## D10. Sync transport

**Decision.** How the local journal reaches the backend.

**Options.** Batch HTTPS POST with cursor + idempotency keys; long-poll;
WebSocket; server-sent events.

**Tradeoffs.** Batch POST is simplest, works through proxies, and matches the
cursor model (§14). Push transports reduce latency for *control* (cancel from
the website) but add connection state that must survive restarts. The two needs
— durable ingest and low-latency control — are different and may use different
transports.

**Recommendation.** Batch POST for event ingest; a separate push channel for
control once multi-client control (§27) is real. Do not force one transport to
do both.

**Depends on.** D7.

**Blocks.** phase 6.

---

## D11. Task resume validation policy

**Decision.** What must be revalidated before a task resumes, and what happens
when the repository changed (§14).

**Options.** Resume only if the workspace is unchanged; resume with
re-validation and a new plan segment; resume and warn; refuse to resume.

**Tradeoffs.** Blind resume risks applying a stale plan to changed code. Refusal
is safe but frustrating after a laptop sleep. A middle policy — revalidate the
files the plan touches and continue if they are unchanged, otherwise require
confirmation — matches the brief's "never blindly resume a stale plan."

**Recommendation.** Revalidate; if the plan's inputs changed, surface a
`waiting_for_user` state with the diff and require confirmation.

**Depends on.** D8, workspace identity (§25 of the architecture doc).

**Blocks.** phase 2.

---

## D12. Approval object model

**Decision.** The exact shape and lifecycle of an approval (§21).

**Options.** Scope-bound, expiring approvals (recommended); session-bound
approvals; per-operation one-shot approvals.

**Tradeoffs.** Session-bound ("user said yes once") is exactly the anti-pattern
the brief names. One-shot is safest but produces approval fatigue on repetitive
safe operations. Scope-bound with expiry and a risk tier is the balance.

**Recommendation.** Scope-bound + expiring + risk-tiered, with `decision` and
`decision_source` recorded so "who approved what" is auditable. Approvals are
objects in the system of record, never strings in a prompt (§24).

**Depends on.** D5 (OS operations are the main consumer).

**Blocks.** phase 8 (and any local privileged-action work).

---

## D13. OS operation request shape

**Decision.** The data the CLI sends toward Directioner-OS for a privileged
action.

**Options.** A structured intent object (operation, scope, risk, task, approval
refs); a shell command string; a typed RPC.

**Tradeoffs.** This is Directioner-OS's interface to define, not the CLI's. A
command string would make the CLI a privilege path (§21), which the boundary
forbids. The CLI can only define what it *emits* and must match whatever
PolicyEngine/`ai-capabilityd` actually accept.

**Recommendation.** Design the CLI-side intent object now (it is just data), but
do not fix a wire format until Directioner-OS publishes one. Record it as an
explicit dependency, not a guess.

**Depends on.** Directioner-OS team.

**Blocks.** phase 8.

---

## D14. MCP / plugin trust model

**Decision.** How a plugin or MCP server earns trust, and how it is revoked.

**Options.** Reuse the publisher-trust pattern
(`sdk/src/agent-publisher-trust.ts`); a per-server explicit allowlist; a
capability-declaration + sandbox model; signed plugins.

**Tradeoffs.** The existing publisher-trust gate already treats remote
*executable* templates as untrusted, which is the same threat class. Extending
it is cheap. Signed plugins add a supply-chain story but need a signing
infrastructure that does not exist.

**Recommendation.** Extend the existing trust pattern (explicit, revocable,
default-deny for executable behavior), with capability declarations; defer
signing to the release-signing work (D15).

**Depends on.** Nothing external.

**Blocks.** no (MCP works today; this hardens it).

---

## D15. Release signing and channels

**Decision.** How release artifacts are signed, verified, and rolled out.

**Options.** Sigstore/cosign; GPG; a first-party signing service; checksums only
(today).

**Tradeoffs.** Checksums alone (the current validator's model) protect against
corruption, not a compromised origin. Sigstore gives keyless provenance but adds
infrastructure and a trust root. A first-party signer is control at the cost of
owning key management.

**Recommendation.** Keep checksums as the floor; add Sigstore-style signing when
a channel/staged-rollout story exists (§28). Never add an arbitrary executable
download path in the meantime.

**Depends on.** Release infrastructure direction.

**Blocks.** no.

---

## D16. Support bundle contents

**Decision.** Exactly what a diagnostic bundle may include.

**Options.** IDs + versions + sanitized errors + timing + non-secret config
(recommended); the above plus recent logs; the above plus a repo manifest.

**Tradeoffs.** More data is more useful and more dangerous. The brief explicitly
forbids auto-uploading repositories or secrets. Logs are useful and are the
likeliest place a secret leaks, so they must be scrubbed.

**Recommendation.** IDs/versions/errors/timing/non-secret config, log excerpts
only if scrubbed and only as `EXPLICIT_USER_UPLOAD` (§19, §30).

**Depends on.** Nothing external.

**Blocks.** no.

---

## D17. Retention classes

**Decision.** A retention rule for each data class (§36 of the brief).

**Options.** Per-class TTLs (security metadata, billing, task metadata, task
events, prompt content, source, diffs, logs); a single global TTL; indefinite
storage.

**Tradeoffs.** Indefinite storage is the default if undecided, and is the
expensive, risky, non-compliant answer. Per-class TTLs require deciding what
each class is for, which is the point.

**Recommendation.** Per-class TTLs, recorded in the cloud DB design (§13), with
`LOCAL_ONLY` content having no cloud retention at all.

**Depends on.** D7.

**Blocks.** phase 6.

---

## D18. Multi-tenant data layout

**Decision.** Shared schema with `account_id`, schema-per-tenant, or
database-per-tenant.

**Options.** Shared schema + row-level scoping (recommended); schema-per-tenant;
database-per-tenant.

**Tradeoffs.** Shared schema is simplest and scales; it makes a missing
`account_id` filter a cross-tenant bug (§29), so it demands discipline and
tests. Schema/database-per-tenant reduces that risk class but multiplies
migrations and operational cost.

**Recommendation.** Shared schema with mandatory `account_id` and tests that
assert cross-tenant reads fail. Revisit only for a compliance requirement.

**Depends on.** Nothing external.

**Blocks.** phase 6.

---

## D19. Rate-limit dimensions

**Decision.** What is rate-limited, and at what granularity.

**Options.** Account, device, request, concurrent task, model-specific,
provider-spend cap; combinations.

**Tradeoffs.** Too coarse punishes a legitimate user on many devices; too fine
is unenforceable and abusable. The brief requires that one compromised account
cannot consume unlimited provider resources (§38), which points at
account-level spend caps plus per-device request limits.

**Recommendation.** Account spend cap + concurrent-task limit + per-device
request limit + model-specific limits where a model is shared or scarce.

**Depends on.** D5 (the gateway is where limits are enforced).

**Blocks.** phase 7.

---

## D20. Website task control scope

**Decision.** Whether the website may only *observe/control* tasks or may also
*create* them.

**Options.** Observe/control only; observe/control + create (submitted into the
same task machinery).

**Tradeoffs.** Creation from the website is a natural product feature and is
safe *if* it enters the same task/authorization path (§5). It is dangerous only
if it becomes a second execution path, which §16 forbids. Creating a task is not
the same as executing a privileged action; the latter still needs approval.

**Recommendation.** Allow creation, but only through the same task API, with the
same attribution and the same approval requirements. No website-only execution
path.

**Depends on.** D5, D12.

**Blocks.** no.

---

## D21. Client version compatibility

**Decision.** What a Phase-9 Aria (or an old CLI) may do against a newer
backend.

**Options.** Strict version match; N-1 compatibility window; capability
negotiation; unbounded compatibility.

**Tradeoffs.** Strict match breaks users who do not update. Unbounded
compatibility makes the API unchangeable. A window with capability negotiation
is the standard answer and is supported by versioned events (D9).

**Recommendation.** N-1 window with capability negotiation; the backend rejects
unknown capabilities explicitly rather than silently degrading.

**Depends on.** D9.

**Blocks.** phase 6.

---

## D22. Analytics scope

**Decision.** What product analytics may collect, separate from operational
telemetry and customer content (§40 of the brief).

**Options.** Operational telemetry only; operational + aggregate product
analytics; operational + product analytics + content-derived signals.

**Tradeoffs.** Content-derived signals are the spyware failure mode the brief
names. Operational telemetry is required for the service to function. Aggregate
product analytics (counts, latencies, feature usage) is defensible if it is
purpose-bound, minimal, retained, and disclosed.

**Recommendation.** Operational telemetry always; aggregate product analytics
only with explicit purpose, minimal fields, retention, configuration, and a
privacy policy. Never derive analytics from customer content.

**Depends on.** D7, D17.

**Blocks.** no.

---

## D23. Client↔backend topology

**Decision.** Does the CLI talk to the backend directly, or through a local
daemon?

**Options.** Direct HTTP from the CLI process; a local daemon/agent that owns
the session, DB, and sync; a hybrid where the CLI owns state and a helper only
handles sync.

**Tradeoffs.** A daemon centralizes the local DB and session (good for
multi-client control, §27) but adds a process to manage, start, and secure. A
direct CLI is simpler but means multiple CLI processes race the local DB, and a
background task cannot outlive the terminal without one.

**Recommendation.** Design the local state ownership as if a daemon will exist
(one writer to the DB), but ship direct-in-process first; introduce the daemon
when background/resumable tasks (§14) require a process that outlives the
terminal.

**Depends on.** D8.

**Blocks.** phase 3 (the client abstraction must not assume single-process).

---

## Summary: what blocks the near-term phases

| Phase | Blocked by |
| ----- | ---------- |
| 0 (this design) | nothing — this is it |
| 1 (CLI task/event abstractions) | D9 (event schema); D3 is now resolved (write against the provider-neutral contract, keep BYOK as a development adapter) |
| 2 (local DB) | D7, D8, D9, D11, D23 |
| 3 (client/backend abstraction) | D23 |
| 4 (auth integration) | D1, D2 |
| 5 (model gateway) | D4, D5, D6, D19 |
| 6 (cloud persistence/sync) | D7, D10, D17, D18, D21 |
| 7 (usage/entitlement/billing) | D19 |
| 8 (OS integration) | D12, D13 |
| 9 (Aria) | D1, D2, D21 (and the task API must be client-neutral) |

Nothing in this list requires implementing Aria, the backend, or OS
integration, and none of it violates the current boundary (no Aria, no OS
integration, no npm publish, no production infrastructure, no merge to main).
