# Stage 0a — Egress Inventory

Read-only audit. No code changed. Every claim below is from the source or the
built binary; the method for each is stated.

Checkout: `/workspace/project`
Branch: `build/fix-ai-sdk-json-types` (HEAD `4441b48fc`)
Binary audited: `cli/bin/directioner`, linux-x64, 135,895,168 bytes,
rebuilt locally at `2026-09-28 15:45` from this checkout.

> Path note: the brief left the checkout path as `<FILL IN PATH>`. There is no
> `directioner` directory anywhere on this machine (`find / -iname
> '*directioner*'` returned nothing). `/workspace/project` is the only Directioner
> checkout present, at the branch and commit the brief describes. I proceeded
> on that basis — see `0-DISCREPANCIES.md`.

---

## Method

1. Enumerated hosts in source: `grep -rhoE "https?://[a-zA-Z0-9._-]+"` over
   `cli sdk common agents packages directioner evals scripts`, excluding
   `node_modules`.
2. Enumerated the build-time client env schema: `common/src/env-schema.ts`.
3. Enumerated runtime API paths: `grep -rhoE "'/api/..."'` over the same trees.
4. Read the constructors, not just the call sites: `getWebsiteUrl()`
   (`sdk/src/constants.ts`), `sessionBaseUrl()`, `beyonders-web-api.ts`,
   `release-core/launcher.js`, `release-core/http.js`.
5. Confirmed presence in the **built binary** with
   `strings -n 5 cli/bin/directioner | grep -c '<host>'`.

The binary check matters because the bundler dead-code-eliminates on
`IS_HOSTED` and on the `NEXT_PUBLIC_*` values. A host can be present in source
and absent from the binary, or vice versa.

---

## A. Hosts found in the BUILT BINARY

Counts are `strings | grep -c`, so they are occurrence counts, not distinct URLs.

| Host | Count | What it is | Class |
|---|---|---|---|
| `directioner.com` | 45 | Web app, `/plans`, `/freebucks`, sponsored-proposal REST front, sign-in | **remove / repoint** |
| `beyonders.com` | 26 | Backend base URL — model gateway, session API, all `NEXT_PUBLIC_BEYONDERS_APP_URL` fallbacks | **remove / repoint** |
| `openrouter.ai` | 7 | BYOK provider default base URL | **keep** (user-configured) |
| `us.i.posthog.com` | 2 | Analytics ingestion | **remove** |
| `posthog.com` | 2 | Analytics (library/docs strings) | **remove** |
| `stripe.com` | 1 | Payment | **remove** |
| `api.openai.com` | 1 | BYOK provider | **keep** (user-configured) |
| `api.deepseek.com` | 1 | BYOK provider | **keep** (user-configured) |
| `zeroclick.dev` | 1 | Ad impression beacon (`cli/src/hooks/use-gravity-ad.ts:40`) | **remove** |
| `sentry.io` | 1 | **False positive** — matched inside a bundled dependency string, not reachable from this repo's source (`grep -rn sentry` over `cli/src sdk/src common/src package.json` = 0 hits). Verify or drop. | **investigate** |
| `api.anthropic.com` | **0** | Not present. No native Anthropic adapter exists (see 0b). | — |
| `generativelanguage.googleapis.com` | **0** | Not present. Gemini not wired. | — |
| `serper.dev` / `context7.com` / `composio.dev` | **0** | Not called directly — all proxied (section C). | — |
| `graph.facebook.com`, `business-api.tiktok.com`, `ads-api.x.com` | **0** in binary, **present in source** | Conversion-tracking engines, `common/src/meta-capi.ts`, `common/src/paid-social-capi.ts`. Tree-shaken out of the Directioner CLI build but live in the repo. | **remove** |

**Verified build-time dead-code elimination:** the ad/tracking CAPI hosts are in
`common/src` but absent from the binary, which confirms the `IS_HOSTED`
elimination works as the SPEC claims. That is good news for stripping — but it
means a source-level grep is not sufficient evidence of egress, and a
binary-level grep is not sufficient to find dead source. Both were run.

---

## B. Build-time client env (`common/src/env-schema.ts`)

These are inlined at build and validated at startup. The schema requires
`NEXT_PUBLIC_CB_ENVIRONMENT`, `NEXT_PUBLIC_BEYONDERS_APP_URL`,
`NEXT_PUBLIC_SUPPORT_EMAIL`, `NEXT_PUBLIC_POSTHOG_API_KEY`,
`NEXT_PUBLIC_POSTHOG_HOST_URL`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`,
`NEXT_PUBLIC_STRIPE_CUSTOMER_PORTAL`, `NEXT_PUBLIC_WEB_PORT`.

| Var | Purpose | Outward? | Class |
|---|---|---|---|
| `NEXT_PUBLIC_CB_ENVIRONMENT` | dev/test/prod selector | no | **remove** |
| `NEXT_PUBLIC_BEYONDERS_APP_URL` | **The backend base URL.** Model gateway, sessions, agent runs, feedback, tokens, project-profile | **yes — the big one** | **remove / repoint** |
| `NEXT_PUBLIC_DIRECTIONER_APP_URL` | directioner.com web app (login, proposals) | yes | **remove** |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | support address in UI | no (display) | **remove/rename** |
| `NEXT_PUBLIC_POSTHOG_API_KEY` | analytics key | yes | **remove** |
| `NEXT_PUBLIC_POSTHOG_HOST_URL` | analytics host (`us.i.posthog.com`) | yes | **remove** |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | payments | yes | **remove** |
| `NEXT_PUBLIC_STRIPE_CUSTOMER_PORTAL` | payments | yes | **remove** |
| `NEXT_PUBLIC_WEB_PORT` | local web port | no | **remove** |
| `NEXT_PUBLIC_GRAVITY_PIXEL_ID` | ad pixel (optional) | yes | **remove** |
| `NEXT_PUBLIC_META_PIXEL_ID`, `NEXT_PUBLIC_META_DIRECTIONER_ADS_PIXEL_ID` | Meta ads | yes | **remove** |
| `NEXT_PUBLIC_X_PIXEL_ID`, `NEXT_PUBLIC_TIKTOK_PIXEL_ID` | X/TikTok ads | yes | **remove** |
| `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION_ID` | search console | yes | **remove** |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_RECAPTCHA_V2/V3_SITE_KEY`, `NEXT_PUBLIC_RECAPTCHA_V2_SIZE`, `NEXT_PUBLIC_HUMANBEHAVIOR_API_KEY` | bot-detection (web-era leftovers) | yes | **remove** |

Note `NEXT_PUBLIC_GRAVITY_PIXEL_ID` is typed as a UUID and is optional. The
`GRAVITY` name collides with the "Gravity Index" tool, but they are unrelated —
the pixel is advertising, the tool is a docs lookup.

---

## C. Runtime endpoints, by subsystem

Everything below is reached on `getWebsiteUrl()`
(`env.NEXT_PUBLIC_BEYONDERS_APP_URL`, default `https://beyonders.com`) unless noted.
`getWebsiteUrl` resolves at call time so that a remotely-bundled SDK does not
use a build-machine localhost URL — worth preserving that property when
repointing.

### C1. Model inference — **the core coupling**

`sdk/src/impl/model-provider.ts:364`:

```ts
url: ({ path: endpoint }) =>
  new URL(path.join('/api/v1', endpoint), getWebsiteUrl()).toString(),
```

The client does **not** talk to model providers directly in default mode. It
POSTs to `beyonders.com/api/v1/chat/completions` (an OpenAI-compatible shape) and
Beyonders's server routes to the real provider. **All prompts and code pass
through Beyonders's servers.** This is the single most important egress fact.

Class: **remove / repoint** — must become a user-configured provider endpoint.

### C2. Session / Freebucks lifecycle

- `/api/v1/directioner/session` — `cli/src/utils/directioner-session-api.ts`
- `/api/v1/directioner/session/admission` — `DIRECTIONER_SESSION_ADMISSION_PATH`
- `/api/v1/directioner/session/reuse`
- `/api/v1/directioner/streak`

Sends: account identity, model intent, Freebucks balance/price checks. The
admission endpoint is what enforces the "not enough Freebucks" wall.

Class: **remove.**

### C3. Account, auth, login

- `/api/v1/me`, `/api/thread/`, `/api/user/preferences`, `/api/user/subscription`
- `/api/auth/cli/code`, `/api/auth/cli/status`, `/api/auth/cli/logout`
- `/api/auth/callback/{github,google,apple}`

Device-code browser login: `LOGIN_WEBSITE_URL` = directioner.com (send) or
beyonders.com (paid). `cli/src/login/plain-login.ts`.

Class: **remove.** Replaced by BYOK env vars. Stage 1 proposes a local device
login only if a backend exists (Stage 3).

### C4. Telemetry and logging — **must not survive**

- **PostHog**: `cli/src/utils/analytics.ts` (client), events on boot, login,
  turns, errors.
- **Axiom log shipping**: `cli/src/utils/log-shipper.ts:69` POSTs to
  `/api/logs`. "Mirrors CLI logs/events into the server's Axiom logs sink." This
  is a broader leak than PostHog: it ships **logs**, and logs can contain file
  paths, command output, and error text.
- **Windows terminal-health telemetry**: `cli/src/utils/windows-terminal-health.ts`
  and `helper-process-telemetry.ts` — a third path to the same sinks.

Class: **remove all three.** Flag: the log shipper is easy to miss because it is
named "shipper", not "analytics".

### C5. Ads and sponsored proposals

- `/api/v1/ads`, `/api/ads`, `/api/v1/ads/prefs`, `/api/v1/ads/click`
- `/api/v1/ads/proposal`, `/api/ads/agentic/postback`
- `/api/ads/first-party/impression/opaque-token`
- `https://zeroclick.dev/api/v2/impressions` (`cli/src/hooks/use-gravity-ad.ts:40`)
- Conversion pixels: `graph.facebook.com`, `business-api.tiktok.com`,
  `ads-api.x.com` (`common/src/meta-capi.ts`, `common/src/paid-social-capi.ts`)

Plus `FREEBUCKS_PLANS_URL = 'https://directioner.com/plans'` and
`https://directioner.com/freebucks` in `directioner-landing-screen.tsx`.

Class: **remove.** `common/src/ads/` is ~50 files — a large surface to excise.

### C6. Tools that proxy through the backend — **easy to miss**

`packages/agent-runtime/src/llm-api/beyonders-web-api.ts`:

```ts
| '/api/v1/web-search'
| '/api/v1/docs-search'
| '/api/v1/gravity-index'
```

So three agent tools are **not** direct integrations:

- `web_search` → `beyonders.com/api/v1/web-search` (server-side Serper; **no
  `serper.dev` string exists in this repo**)
- `read_docs` → `/api/v1/docs-search` (server-side Context7; `context7.com` not in repo)
- `gravity_index` → `/api/v1/gravity-index` (server-side)

Class: **remove / rewire.** In a private client these must either be dropped or
reimplemented against a provider the user configures. Note: `read-docs.ts`
imports `fetchContext7LibraryDocumentation` — check whether the SDK package
(`@beyonders/sdk`) contains a direct Context7 client that could be used instead
of the proxy. **Open item.**

### C7. BYOK — the one path that already leaves the backend

`sdk/src/byok.ts:94`: `https://openrouter.ai/api/v1`.
`sdk/src/impl/byok-request.ts` recognizes `api.openai.com`, `openrouter.ai`,
`api.deepseek.com`, and generic `https://openrouter.ai/` / `https://api.deepseek.com`
prefixes. This is the mechanism to build on.

Class: **keep, generalize.**

### C8. Other

- `/api/v1/composio/execute` — Composio integrations proxied server-side.
- `/api/v1/feedback` — feedback form.
- `/api/v1/agent-runs`, `/api/v1/agents/...`, `/api/agents/publish`,
  `/api/agents/validate` — agent store.
- `/api/v1/token-count`, `/api/v1/project-profile` — backend helpers.
- `https://beyonders.com/docs/agents` — a doc link in `publish-container.tsx`.

Class: **remove.** `/api/v1/agent-runs` and `/api/v1/agents/publish` are the
agent-store coupling (see 0c).

---

## D. Launcher and updater — install-time and post-install egress

`cli/release-core/launcher.js` is a Node downloader (the npm package ships
`index.js launcher.js http.js README.md` only).

- `DEFAULT_DOWNLOAD_ORIGIN = 'https://beyonders.com'`
- `NPM_REGISTRY_ORIGIN = 'https://registry.npmjs.org'`
- Downloads a platform binary, verifies SHA-256, execs it.
- Redirect allow-list (`http.js`): `beyonders.com`, `www.beyonders.com`,
  `directioner.com`, `www.directioner.com`, `github.com`, suffix `*.githubusercontent.com`.
  The comment explains: `beyonders.com` 302s to a GitHub release asset.
- It refuses a configured `NEXT_PUBLIC_BEYONDERS_APP_URL` that is not https
  (except localhost). Good instinct; keep that guard when retargeting.

Updater: there is no `cli/src/utils/deferred-update.ts` file, but
`cli/src/__tests__/release/deferred-update.test.ts` and
`cli/src/utils/launcher-update-restart.ts` exist, and the launcher comments
describe staged/deferred replacement of the binary (a download may "wait here
for an hour", download timeout 120s, 3 attempts).

Class: **remove/replace.** Stage 1 replaces the launcher and updater with local
build output; no auto-update until there is a distribution of our own. The
deferred-update tests should be removed with the mechanism, not left passing
against dead code.

---

## E. Summary classification

| Class | Items |
|---|---|
| **remove** | PostHog, Axiom `/api/logs`, Windows health telemetry, Stripe, all ads + sponsored proposals + zeroclick + Meta/TikTok/X pixels, session/Freebucks endpoints, `/api/v1/me` + auth + login, agent store endpoints, feedback, token-count, project-profile, `/dashboard`, referrals, all `NEXT_PUBLIC_*` |
| **remove / repoint** | The **model gateway** `…/api/v1/chat/completions`, `NEXT_PUBLIC_BEYONDERS_APP_URL`, directioner.com |
| **rewire** | `web_search`, `read_docs`, `gravity_index`, `composio` — currently backend-proxied; must be direct, user-configured, or removed |
| **keep (user-configured)** | `openrouter.ai`, `api.openai.com`, `api.deepseek.com`, and whatever OpenAI-compatible base URL the user sets |
| **investigate** | the single `sentry.io` string in the binary (not traceable to this repo's source) |

---

## F. Constraints this imposes on Stage 1 (flagging early)

1. **The model path is the whole product's trust boundary.** Today every prompt
   and every byte of source goes to beyonders.com. Making inference direct-to-
   provider is not a config tweak; it changes the trust story, and it is the
   precondition for saying anything like "private" in a README.
2. **The `web_search`/`read_docs`/`gravity_index` tools quietly depend on the
   backend.** Removing the backend without addressing them leaves three tools
   broken. Decide their fate explicitly.
3. **The log shipper is a second, non-obvious telemetry channel.** Removing
   PostHog alone does not remove client log egress.
4. **A source grep is not enough.** The CAPI hosts are in source but not the
   binary; confirm both directions when writing the Stage 1 CI guard, and point
   it at the **binary** as well as the source (the brief already asks for this).
5. **`strings` scanning needs care.** Early runs matched thousands of minified
   fragments (`A.dev`, `H.com`). The Stage 1 guard must match full hostnames
   bounded by delimiters, or it will be useless noise.
