# Stage 1 — Assessment: Directioner CLI as an independent agent

Read-only assessment of the real checkout at `rebrand/beyonders-full`
(`58971dd6d`), measured against the pre-rebrand baseline `7d4c4df00`. Every
claim below was reproduced in this session; the command or file that proves it
is named inline. Nothing here changes behaviour.

Method: a detached worktree at `7d4c4df00` was used as the control, so each
failure is classified as *pre-existing* or *introduced by the rebrand* rather
than guessed.

---

## 1. Headline: the shipped binary is a hosted build, not a BYOK build

`directioner/cli/build.ts` builds the binary with `HOSTED_MODE: 'true'` and does
**not** set `DIRECTIONER_MODE`. In `cli/src/utils/constants.ts`,
`IS_DIRECTIONER` is `DIRECTIONER_MODE === 'true'`, so the shipped artifact is
`IS_HOSTED`, never `IS_DIRECTIONER`.

Consequence, verified by running the binary in a clean `$HOME`: it prints the
login screen and stops at `Press ENTER to login...`. It never reaches the BYOK
path in `cli/src/index.tsx` (`if (IS_DIRECTIONER) { … loadDirectionerConfig() … }`),
so a user with no backend configured cannot use it. This is not a bug in the
code path — it is a build-variant choice.

It is also a direct contradiction in the record:

- The rebrand commit `eb407bb53` says it *restored* `HOSTED_MODE=true`,
  describing the `DIRECTIONER_MODE=true` variant as an intermediate mistake.
- `DIRECTIONER_MASTER_CONTEXT.txt` §2.2 agrees: the intended variant is the
  free/hosted-login build, and the mode flag drives **compile-time dead-code
  elimination** (paid-only code physically absent), not a runtime toggle.

So "BYOK build" and "hosted build" are two different products, and the repo
currently ships the second while the surrounding task text calls for the first.
**This needs one explicit decision from Aditya before any code changes** (§5).

Separately, the checked-in binary `cli/bin/directioner` (116 MB) is **stale**:
built `2026-09-29 14:50`, before the latest commits. Any fix requires a rebuild,
and the rebuild path needs `bun` (see §3.7).

---

## 2. Security findings

### 2.1 HIGH — `HOSTED_MODE` escaped the direnv steering guard (rebrand regression)

`cli/src/init/init-direnv.ts` drops "steering" variables imported from a repo's
`.envrc`, so `direnv allow` (consent to a repo's env) cannot reconfigure the
agent that is about to run in it.

The pattern list changed like this across the rebrand:

```
-  /^CODEBUFF_/,
-  /^FREEBUFF_/,
+  /^DIRECTIONER_/,
```

Pre-rebrand, the mode flag `FREEBUFF_MODE` matched `/^FREEBUFF_/` and was
protected. The rebrand renamed the flag to `HOSTED_MODE`, which matches none of
the remaining patterns. Empirically:

```
GAP  HOSTED_MODE        (isSteeringEnvVar('HOSTED_MODE') === false)
```

`cli/src/init/__tests__/init-direnv.test.ts` catches this (2 failing tests); the
test is correct and the implementation is wrong.

Impact: a hostile repo can ship `.envrc` containing `export HOSTED_MODE=true`
(or `DIRECTIONER_MODE`, which is covered) plus, more importantly, set the
*other* mode flag to flip build behaviour. Today `HOSTED_MODE` is exactly the
flag the shipped build keys off, so this is the highest-value variable to
protect and the one left open.

Fix: add `/^HOSTED_MODE$/` to `STEERING_ENV_VAR_PATTERNS`. Trivial, no
behaviour change beyond closing the gap.

### 2.2 Verified good — SSRF defense is real, not a vulnerability

The prior notes flagged `169.254.169.254` as an SSRF risk. It appears in exactly
one place outside tests: `sdk/src/__tests__/read-url.test.ts`, as a **negative
assertion** — the tool is required to *refuse* the metadata IP and never call
`fetch`:

```
expect(fetched).toBe(false)
errorMessage: 'Refusing to fetch private or reserved address: 169.254.169.254'
```

`sdk/src/tools/read-url.ts` classifies and blocks loopback, RFC1918, CGNAT
(`100.64.0.0/10`), link-local, `0.0.0.0`, and IPv6 ULA, and handles
IP-literals without a DNS lookup. This is a defensive control with test
coverage. **No action.**

### 2.3 Verified good — no real secrets in tracked files, CI, or the published zip

The published `served/directioner-cli.zip` was scanned for
`gho_/ghp_/sk-` keys, private-key blocks, and inlined `NEXT_PUBLIC_POSTHOG_*`
values. Two files match, and both are fake test values:

- `docs/audit/ENVIRONMENT.md:132` → `NEXT_PUBLIC_POSTHOG_API_KEY=phc_buildtest`
- `directioner/e2e/README.md:90` → `NEXT_PUBLIC_POSTHOG_API_KEY=test …`

The earlier `gho_` history hit is the known false positive inside a PNG blob.
No credentials are present. **No action.**

### 2.4 Verified good — ads are unreachable at runtime

`cli/src/commands/ads.ts` `getAdsEnabled()` returns `false` unconditionally when
`IS_DIRECTIONER || IS_HOSTED`, and that single gate is consulted by the ad
auction, sponsored proposals, and the ad banner. The shipped build is
`IS_HOSTED`, so the whole subsystem is off. The ad-rendering components remain
compiled in, but no path enables them. (If the hosted build is kept, note that
`HOSTED_MODE=true` is itself the flag a repo could try to set — see §2.1.)

---

## 3. Test / typecheck / build matrix

Run with `bun 1.4.2` (installed this session; repo pins `1.3.14` in
`.bun-version`). Baseline column = same command at `7d4c4df00`.

### 3.1 common — 2253 tests

| | pass | fail |
| --- | --- | --- |
| current | 2234 | 19 |
| baseline | 2239 | 14 |

Five failures are **new**. Diffing the failure sets isolates them exactly:

- `house ad width budget > chat_assistant_sr variation {0,1,2} survives every preview width uncut`
- `house ad width budget > waiting_room variation 2 survives every preview width uncut`
- `house ad width budget > the declared budgets match what the renderer actually gives`

**Root cause:** the brand string is longer. `HOUSE_AD_TITLE_BUDGET` is 12;
`'Freebuff Pro'` was 12, `'Directioner Pro'` is 15. The same length growth
pushes `waiting_room` variation 2's description past the 48-column budget.
Standalone: 33 pass / 0 fail at baseline → 28 pass / 5 fail now.

The remaining 14 are pre-existing and **renames of each other**, not new work:
they reference directories absent from this checkout (`web/`,
`landing-lab/`, `directioner-desktop/`). Confirmed absent:
`ls -d web landing-lab directioner-desktop` → all missing. The `data-use copy`
failures are the same three paths as baseline, under the new `Directioner`
suite name.

### 3.2 cli — 3349 tests

| | pass | fail | errors |
| --- | --- | --- | --- |
| current | 3308 | 28 | 21 |
| baseline | — | 5 (distinct) | — |

New distinct failures:

- `fingerprint utilities > … should return fingerprint of expected length` —
  the rebrand changed the prefix `codebuff-cli-` (13) → `beyonders-cli-` (14),
  so the total became 22 while the test still asserts 21. The test is stale.
- `init-direnv > …` ×2 — the §2.1 security gap.
- `beyonders/directioner release wrapper > contains only product configuration`
  — `Cannot find module 'tar'` (see §3.4). Pre-existing cause.
- `checked-in frames > every state at 20, 48 and 60 columns` — 14-line snapshot
  drift in `sponsored-proposal-block.test.tsx`; needs a look, likely copy width.
- `terminal command broker > kills the broker process group after a timeout`
  and `sdk > escalates when a grandchild ignores SIGTERM` — both 3.0s+ timing
  tests; environment-sensitive, not rebrand-specific.

### 3.3 sdk — 795 tests

759 pass, 1 fail (`escalates when a grandchild ignores SIGTERM`, 3.1s timing).
Typecheck: **0 errors**.

### 3.4 Typecheck

| package | errors | cause |
| --- | --- | --- |
| common | 1 | JSON-schema `_JSONSchema` assignability in a test; pre-existing |
| cli | 12 | `Cannot find module 'tar'` ×3, `react-dom/server` implicit-any ×9 |
| sdk | 0 | — |

None are caused by the rebrand: `tar` and `@types/react-dom` are **not declared**
in `package.json` and **not installed**, yet `tar` is `require`d at runtime by
`cli/release-core/launcher.js` and the release tests. This is a pre-existing
packaging bug (`tar` was required pre-rebrand too, and is absent from
`bun.lock`), but it means the release/launcher path cannot be exercised here.

### 3.5 Provider abstraction — assessed, and it is the strongest part of the repo

`common/src/constants/directioner-providers.ts`,
`sdk/src/directioner/provider-model.ts`, and
`common/src/constants/directioner-config.ts` form a clean, genuinely
independent BYOK layer:

- Aliases only: Heital/Eternal/Infernal, each recording its upstream company
  (Google Gemini / Anthropic Claude / Groq) so the user can still tell where
  their data goes — transparency without vendor branding.
- No vendor endpoint is contacted; `getDirectionerModel` builds the model from
  the user's `baseUrl`.
- API keys are stored **by environment-variable name**, never by value; the
  config schema rejects anything that looks like a pasted key.
- `redirect: 'error'` on the provider fetch, so a 302 cannot hand the bearer
  token to another host.
- `redactProviderStream` strips the credential from provider error bodies
  before they reach logs.
- Two wire protocols: `openai-compatible` for Heital/Infernal, and a native
  Anthropic adapter for Eternal, correctly noting that
  `api.anthropic.com/v1/chat/completions` 404s.

This is production-grade. It is also **inert in the shipped binary** (§1).

### 3.6 Analytics

`initAnalytics()` short-circuits to a no-op when `IS_DIRECTIONER`. The shipped
binary is `IS_HOSTED`, so it takes the PostHog branch, which `throw`s
`NEXT_PUBLIC_POSTHOG_API_KEY … is not set` when those values were not inlined
at build time (the master context calls this out as a known trap). That throw is
caught in `cli/src/init/init-app.ts` and only `console.debug`-logged, so startup
continues — confirmed empirically: the binary reached the login screen with no
PostHog env set. The binary contains no `phc_` key
(`strings | grep -c 'phc_[A-Za-z0-9]{20,}'` → 0), so nothing real is inlined
and analytics is effectively off in this artifact. This is benign but untested,
and it interacts with §1: a BYOK build skips this branch entirely. Resolve it
alongside the build-variant decision.

### 3.7 Build tooling

- `bun` is **not installed** in the environment; the documented build path
  (`bash install.sh --build`) cannot run as-is. Installed here to
  `~/.npm-global/bin/bun` (1.4.2) from the official npm registry.
- Version drift: `.bun-version` pins `1.3.14`, installed is `1.4.2`.
- `node_modules` exists but is incomplete (`tar`, `@types/react-dom` missing).
- `install.sh` is otherwise sound: idempotent, checks for the binary and the
  sibling `tree-sitter.wasm`, and falls back gracefully when `/usr/local/bin`
  is not writable.

---

## 4. Operability

### 4.1 Stale published artifacts

`served/directioner-cli.zip` was built at 9 PROGRESS tasks; the repo is at 11.
It predates the latest commits and must be regenerated before it can be called a
deliverable. The hosted page and both ports respond 200 and are supervised by
`served/run.sh` (re-execs `serve.py` on exit), so the 502/bad-gateway problem is
currently mitigated — but the supervisor does not survive a full environment
reset, which is why it has had to be restarted each reset.

### 4.2 Terminal branding

The shipped binary's startup screen renders a large block-ASCII logo followed by
`Press ENTER to login...`. It does not present a plain `Directioner by Beyonders`
wordmark, and the login-first flow is itself the hosted product. The
terminal-title work from the rebrand exists; the primary on-screen brand at
startup should be re-checked once the build variant is decided.

---

## 5. Prioritized backlog

Ordered by (impact × certainty) ÷ effort. Nothing below is started.

**P0 — needs a decision before code**

1. **Decide the build variant** (§1): hosted-login (matches master context) or
   BYOK-standalone (matches the surrounding task text). This gates 2, 6, 7.

**P1 — small, certain, security or correctness**

2. **Add `/^HOSTED_MODE$/` to `STEERING_ENV_VAR_PATTERNS`** (§2.1). One line;
   unblocks 2 failing tests and closes a real injection path.
3. **Fix the ad-copy width regression** (§3.1): either shorten the
   `chat_assistant_sr` title (e.g. drop to `'Pro'`/`'Directioner+'`) or raise
   `HOUSE_AD_TITLE_BUDGET` with a comment on why the brand grew. Five tests.
4. **Fix the stale fingerprint assertion** (§3.2): update the expected length to
   match `beyonders-cli-` (22), or assert the suffix length instead of the total.
5. **Declare `tar` and `@types/react-dom`** (§3.4) so the release path typechecks
   and the launcher can run.

**P2 — operability**

6. **Regenerate the published zip** after any code change, and re-verify the
   hosted URLs (§4.1).
7. **Resolve analytics for the shipped variant** (§3.6): make the hosted build
   either fail soft or inline real values deliberately.

**P3 — quality**

8. Triage the `checked-in frames` snapshot drift (§3.2).
9. Separate the 3s timing tests from the fast suite, or mark them integration,
   so a normal run is deterministic.
10. Reconcile the stale `docs/audit/0-*` Stage 0 docs (written at `4441b48fc`,
    pre-rebrand) against the current checkout, or mark them historical.

---

## 6. Recommended first slice

The smallest change that is unambiguously correct, security-positive, and
independent of the §1 decision:

1. Add `/^HOSTED_MODE$/` to `STEERING_ENV_VAR_PATTERNS` (P1-2).
2. Fix the two stale assertions the rebrand invalidated — ad-copy budget
   (P1-3) and fingerprint length (P1-4).
3. Rebuild the binary and regenerate the zip.

That turns 8 failing tests green, closes one real security gap, and leaves every
product decision for Aditya. It does **not** touch `main`, publish anything, or
change behaviour a user can see. The build-variant question (§1) is deliberately
excluded and should be answered before anything that depends on it.
