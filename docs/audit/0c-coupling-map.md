# Stage 0c — Coupling Map: What Depends on Beyonders's Hosted Backend

Read-only. Each item names the file and the mechanism, and states what breaks if
the backend is removed without a replacement.

---

## 1. Inference — the load-bearing coupling

`sdk/src/impl/model-provider.ts:364` builds every chat completion URL against
`getWebsiteUrl()`:

```ts
new URL(path.join('/api/v1', endpoint), getWebsiteUrl()).toString()
```

When `IS_HOSTED` (or paid default mode) the client does not hold provider API
keys. It POSTs to `beyonders.com/api/v1/chat/completions` and the server holds the
provider keys and routes onward. The `Authorization: Bearer <apiKey>` header
carries a **Beyonders** credential, not an OpenAI/Anthropic key.

**What depends on it:** every agent turn. Nothing works without either the
backend or a replacement.

**Replacement exists:** BYOK (`sdk/src/byok.ts`, `sdk/src/impl/byok-request.ts`)
already constructs a direct OpenAI-compatible client and recognizes
`api.openai.com`, `openrouter.ai`, `api.deepseek.com`. The dependency is
therefore *liftable* — the direct path is written, it is just not the default and
not the only configured path.

---

## 2. Model-catalog + rate-limit-queue pinning

`common/src/constants/free-agents.ts:825`:

> "the rate-limit queue accounts by model, so a root that could also run
> something else would let a turn escape the queue's bookkeeping."

Each free model has one pinned agent root (`base2-free-<model>` /
`base3-free-<model>`). The root↔model mapping is **one-to-one** precisely so the
server-side queue can attribute a turn to a model. This is not a UI convention;
it is a backend accounting invariant encoded in agent definitions.

**Coupling:** agent roots → catalog entries → server queue → admission.
**Breaking it:** in a BYOK-only client there is no shared queue and no per-model
entitlement, so the one-to-one pinning is meaningless. Collapse the
`base*-free-*` roots into a single root parameterized by the user's model, and
delete the pinning comment's premise.

---

## 3. Session / Freebucks lifecycle

`cli/src/hooks/use-directioner-session.ts`, `cli/src/utils/directioner-session-api.ts`,
`common/src/types/directioner-session.ts`:

- Session admission (`/api/v1/directioner/session/admission`) gates whether a turn
  may start, against a daily Freebucks pool.
- `DirectionerFreebucksWindow`, `DirectionerFreebucksWallet` model the balance.
- `/api/v1/directioner/session/reuse`, `/api/v1/directioner/streak` add reuse and
  streak accounting.

**Coupling:** the chat admission hook (`use-directioner-chat-admission.ts`) is on
the send path. Removing the backend without removing this hook leaves sends
blocked waiting on an admission that never arrives.
**Replacement:** admit locally — a send is always allowed; the only gate becomes
"is a provider configured?".

---

## 4. Tool proxying

`packages/agent-runtime/src/llm-api/beyonders-web-api.ts` proxies:

- `web_search` → `/api/v1/web-search`
- `read_docs` → `/api/v1/docs-search`
- `gravity_index` → `/api/v1/gravity-index`

and `composio_*` → `/api/v1/composio/execute`.

**Coupling:** the tools' *implementations* live server-side; the client only
sends a request and formats the answer. The provider strings (Serper, Context7)
do not appear in this repo.
**Breaking it:** these tools stop working. Options, in preference order:
(a) remove the tools; (b) reimplement against a user-configured search/docs
provider; (c) for `read_docs`, check whether `@beyonders/sdk` ships a direct
Context7 client the CLI could call instead of the proxy.

---

## 5. Agent store and publishing

`/api/v1/agent-runs`, `/api/v1/agents/:publisher/:agent/:version`,
`/api/agents/publish`, `/api/agents/validate` (`sdk/src/impl/database.ts`).

**Coupling:** agent definitions can be fetched from and published to their
registry; `/publish` is already removed in Directioner.
**Replacement:** local `.agents/` directories only. The registry is optional for
a private client; drop it.

---

## 6. Account and login

`/api/v1/me`, `/api/thread/`, `/api/auth/cli/*`, `/api/user/preferences`,
`/api/user/subscription`. Device-code login on directioner.com / beyonders.com.

**Coupling:** identity is used for entitlement and for attributing runs. The SDK
threads a `userId` into tool handlers (`web-search.ts` takes `userId`, and
`DIRECTIONER_ACTING_USER_HEADER` is set on model requests).
**Replacement:** local config only; no userId, or a random local id for logs
that never leave the machine.

---

## 7. Telemetry, logging, feedback

- PostHog: `cli/src/utils/analytics.ts` (boot/login/turn/error events;
  `anonymous-id.ts` handles identity merging).
- Axiom logs: `cli/src/utils/log-shipper.ts` → `/api/logs`.
- Windows terminal health: `windows-terminal-health.ts`, `helper-process-telemetry.ts`.
- Feedback: `/api/v1/feedback`.

**Coupling:** mostly fire-and-forget (the source notes PostHog errors are
swallowed when offline), so removal is low-risk. **But** analytics wiring is
touched at boot and on the send path, so removal must be surgical, and the
**log shipper must be removed explicitly** — it is a separate channel from
PostHog.
**Replacement:** none needed; local logging to the config dir only.

---

## 8. `/dashboard`, usage, streak, referrals

`/dashboard` (usage/stats/streak) opens a browser page; referrals and bounties
are referenced in `use-directioner-session.ts`, `use-usage-query.ts`, and offer
invariant tests.

**Coupling:** purely presentational + account state.
**Replacement:** remove outright. Replace with a local "configured provider"
screen.

---

## 9. Ads and sponsored proposals

`cli/src/ads/`, `common/src/ads/` (~50 files), plus `/api/v1/ads*`,
zeroclick beacon, Meta/TikTok/X CAPI.

**Coupling:** the sponsored-proposal channel is *how the free tier is funded*,
so in their product it is not optional — it is revenue. In ours it is pure
liability: it makes network calls and it renders third-party content into the
user's terminal.
**Replacement:** none. Remove entirely; BYOK removes the need for the ad rail.

---

## 10. Launcher, updater, distribution

`cli/release-core/launcher.js` downloads a platform binary from beyonders.com,
following a 302 to a GitHub release asset, verifying SHA-256. The deferred-update
mechanism (tests in `cli/src/__tests__/release/deferred-update.test.ts`;
`cli/src/utils/launcher-update-restart.ts`) stages a new binary.

**Coupling:** the entire distribution path is theirs.
**Replacement (Stage 1):** local build output only; no auto-update until there is
an owned distribution. This is a boundary the brief already sets.

---

## Dependency summary — order of decoupling

1. **Inference** (§1) — must be first; nothing else matters until turns can run
   without their gateway. BYOK already provides the path.
2. **Admission gating** (§3) — must be lifted before any turn succeeds even with
   a provider configured; it sits on the send path.
3. **Tool proxies** (§4) — decide keep/rewire/remove; three tools break silently
   otherwise.
4. **Telemetry** (§7) — remove, especially the log shipper.
5. **Catalog + queue pinning** (§2) — collapse the model-pinned roots once the
   catalog is gone.
6. **Agent store, account, login, dashboard, referrals, references** (§5, §6, §8) —
   remove; low risk.
7. **Ads** (§9) — remove wholesale.
8. **Launcher/updater** (§10) — replace with local artifacts.

This is also the order I would attack Stage 1, because each step unblocks the
next and each is independently testable.
