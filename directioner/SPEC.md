# Directioner Spec

Directioner is the terminal coding agent published by Beyonders. It ships as
the `directioner` binary and the `directioner` npm package, and it reuses the
`cli/` package under a compile-time build flag.

It is **BYOK-first in its current implementation**: it is usable with no
Directioner backend at all. There is no mandatory login and no mandatory
Directioner-controlled endpoint. The user names a model provider and an API key;
every request goes straight from the user's machine to that provider.

> **This is the current build, not the production customer target.** The
> production Directioner customer path is hosted: an authenticated CLI using
> Directioner-owned backend/model services, with no provider credential on the
> client (D3 in `docs/directioner-open-decisions.md`). That backend is still
> being built. BYOK remains as the **developer/test mode** and must not be
> presented as public onboarding. The client-side contract for the hosted path
> is `common/src/directioner/platform-contract.ts`.

> **Superseded design.** An earlier revision of this file specified a
> hosted-login, free-only variant: mandatory `Press ENTER to login`, always-on
> ads, server-side model routing, and `HOSTED_MODE=true` as the Directioner
> build flag. That is a *different product*. The shipped Directioner binary is
> the BYOK variant described here, built with `DIRECTIONER_MODE=true`. Sections
> below record what the current build actually does.

---

## 1. Build-Time Flags

Two independent flags, both injected via `--define` in
`cli/scripts/build-binary.ts` and read as module-level constants in
`cli/src/utils/constants.ts`, so the bundler dead-code-eliminates the variant
that is not being built.

| Flag                    | Constant         | Product                                                          |
| ----------------------- | ---------------- | ---------------------------------------------------------------- |
| `DIRECTIONER_MODE=true` | `IS_DIRECTIONER` | **The shipped Directioner binary.** Standalone BYOK, no login.    |
| `HOSTED_MODE=true`      | `IS_HOSTED`      | The hosted/free client. Requires login and a Directioner session. |

They are different products, not a runtime toggle:

- `IS_DIRECTIONER` — auth is skipped (`cli/src/app.tsx`), ads are off, and a
  turn resolves the configured provider directly
  (`cli/src/hooks/use-send-message.ts`).
- `IS_HOSTED` — keeps the login gate, the Directioner session, and the
  hosted routing path.

`directioner/cli/build.ts` sets `DIRECTIONER_MODE=true` and sets
`HOSTED_MODE=false` **explicitly**, rather than leaving it to the ambient
environment: an exported `HOSTED_MODE` in the builder's shell would otherwise
flip the shipped binary back to the hosted variant.

```bash
bun directioner/cli/build.ts <version>
```

---

## 2. Providers (BYOK)

The provider registry lives in
`common/src/constants/directioner-providers.ts`. It is self-contained and
imports nothing from the product surface. Three providers are built in; the
product name is what the user sees, and each entry records the upstream company
so the user can still tell where their requests go.

| Id         | Product name | Upstream         | Protocol            | Default endpoint                                           | API key env var   |
| ---------- | ------------ | ---------------- | ------------------- | ---------------------------------------------------------- | ----------------- |
| `heital`   | Heital       | Google Gemini    | `openai-compatible` | `https://generativelanguage.googleapis.com/v1beta/openai`  | `HEITAL_API_KEY`  |
| `eternal`  | Eternal      | Anthropic Claude | `anthropic`         | `https://api.anthropic.com/v1`                             | `ETERNAL_API_KEY` |
| `infernal` | Infernal     | Groq             | `openai-compatible` | `https://api.groq.com/openai/v1`                           | `INFERNAL_API_KEY`|

`eternal` uses a native adapter because Claude does not expose an
OpenAI-compatible `/chat/completions` endpoint (it 404s). The protocol is
carried on the resolved connection and selects the Anthropic provider in
`sdk/src/impl/model-provider.ts`.

Each definition also carries an `exampleModel` — an example, not a constraint.
The provider's model list is not enumerated, because a hardcoded list goes stale
and would reject valid models.

---

## 3. Configuration

A single JSON file names the configured provider(s). It is read from:

1. `$DIRECTIONER_CONFIG_DIR/config.json` when set (must be absolute)
2. `$HOSTED_CONFIG_DIR/config.json` as a fallback
3. otherwise `~/.config/directioner/config.json`

```json
{
  "version": 1,
  "providers": [
    {
      "id": "heital",
      "model": "gemini-3.8-flash",
      "apiKeyEnvVar": "HEITAL_API_KEY"
    }
  ],
  "active": "heital"
}
```

An optional `baseUrl` per provider points at a self-hosted or gateway endpoint
speaking the same protocol.

### The API key is never stored

The config records only the **name** of an environment variable. The value is
read from the environment at request time. `apiKeyEnvVar` is validated against
`^[A-Za-z_][A-Za-z0-9_]*$` — an identifier, not a value — so a pasted key cannot
land on disk. This is deliberate: a config file is easy to commit, copy or back
up by accident; an environment variable is not.

The schema is `.strict()` at both levels and refuses an `active` id that is not
among the configured providers.

### Failure messages

Resolution errors are `DirectionerConfigError` and are surfaced to the user
verbatim, because each one is actionable: no config file (first run shows setup
instructions), an unknown `--provider` id (lists the configured ids), or an
unset key variable (names the variable to export).

### Pre-flight report (`--doctor`)

`directioner --doctor` resolves the config and prints, without opening the TUI:
the config file and active provider, the provider/model/endpoint the run would
use, whether the key variable is set (the NAME, never the value), and whether
the endpoint is reachable. `--doctor --ping` additionally sends one minimal
request and classifies the result: 2xx accepted, 401/403 credential rejected,
404/422 model rejected, 429 rate-limited (a warning). The command exits non-zero
when any check fails, so it is scriptable. It never returns, logs or renders the
key; the only place the secret appears is the `Authorization` / `x-api-key`
header of the request itself.

---

## 4. Inference Path

Directioner does not build a second inference path. It maps its provider config
onto the SDK's existing BYOK connection shape (`ResolvedByokConnection`), the
same one the hosted client's BYOK selection uses, so streaming, helper calls and
subagents all thread through one code path.

- `cli/src/utils/directioner-byok.ts` — resolves the config into a connection.
  The provider id becomes the connection's `provider` label; the wire protocol
  rides on the runtime-only `protocol` field.
- `sdk/src/impl/model-provider.ts` — builds the model. `openai-compatible`
  providers get an OpenAI-compatible client pointed at
  `byokCompletionUrl(connection)`; `anthropic` gets the native adapter.
- `sdk/src/byok.ts` — `normalizeByokBaseUrl` enforces that provider endpoints
  are HTTPS, with HTTP allowed only on loopback, and rejects embedded
  credentials, query parameters and fragments.

A turn resolves the provider **before** creating the client, and a missing or
invalid key is reported as an actionable chat error rather than an unhandled
throw.

---

## 5. Egress

The only network destination a Directioner turn has is the configured provider
endpoint. There is no Directioner backend to reach and no login to perform.

Verified empirically with an `LD_PRELOAD` `connect`/`getaddrinfo` interceptor
while running the built binary against a local mock provider: the only
connection was to the configured provider port, with zero blocked or other
destinations.

Agent-definition validation must therefore run **locally** on this build. It is
keyed off `IS_DIRECTIONER`, not off a BYOK *selection*: Directioner resolves its
provider from `config.json` and never populates the hosted selection store, so a
"no selection" reading must not be taken as "not BYOK". A remote validation call
here has no backend to reach, and its failure silently blocks every send.

---

## 6. Branding

`PRODUCT_NAME` in `cli/src/utils/constants.ts` is the single source of truth for
anything the user reads. Renaming the product must not mean editing ten files,
and it must never fall back to a vendor name.

| Area                  | Value                                           |
| --------------------- | ----------------------------------------------- |
| npm package name      | `directioner`                                   |
| Binary name           | `directioner`                                   |
| Terminal title prefix | `Directioner: `                                 |
| App header            | "Directioner will run commands on your behalf…" |

---

## 6a. Release & packaging

Directioner owns its release path end to end. There is no vendor endpoint, no
workflow dispatched into another repository, and no download at install or run
time.

| Concern              | Where it lives                                    |
| -------------------- | ------------------------------------------------- |
| Build the binary     | `directioner/cli/build.ts` (BYOK variant)         |
| Assemble the package | `directioner/cli/package-release.ts`              |
| Validate the package | `scripts/validate-release.ts`                     |
| Run the whole thing  | `directioner/cli/release.ts <version> [--smoke]`  |
| npm launcher         | `directioner/cli/release/launcher.js`             |
| Package entrypoint   | `directioner/cli/release/index.js`                |

The npm package **ships the compiled binary** (`directioner` /
`directioner.exe`) and its `tree-sitter.wasm` sibling inside the tarball. The
launcher copies them into a per-user cache (`~/.cache/directioner`, or
`$DIRECTIONER_CACHE_DIR`) and execs the binary. It opens no socket: there is no
download, no update check, and no telemetry. Updates are `npm install -g
directioner`, and `directioner --check-update` says so.

The legacy shared launcher in `cli/release-core/` — which downloaded from
`https://beyonders.com/api/releases/...` and self-updated from the npm registry
— is no longer used by Directioner and remains only for the other products.

`scripts/validate-release.ts` is the release gate. It checks identity
(name/bin/version/repository), absence of vendor references in the package
files, absence of credentials, archive integrity (required files, the binary,
`tree-sitter.wasm`, no nested tarball, no internal files), that the binary is a
real native executable of an expected architecture, and that the README
describes BYOK rather than hosted login. Legacy strings still embedded in the
compiled binary are reported as tracked-debt warnings, not blockers.

---

## 7. Ads

Ads are **off** for both Directioner builds. `getAdsEnabled()`
(`cli/src/commands/ads.ts`) returns `false` when `IS_DIRECTIONER || IS_HOSTED`,
and the whole `ads:` command family is absent from `COMMAND_REGISTRY`.

This differs from the superseded design, which specified always-on,
non-disableable ads for the hosted/free variant.

---

## 8. Slash Commands

The registry is filtered at build time; commands with no meaning on this build
are removed rather than left to fail at runtime.

Removed: `/subscribe` and its aliases, `/usage` (`/credits`), `/ads:*`,
`/connect:claude`, `/refer-friends`, `/mode:*`, `/agent:gpt-5`, `/publish`,
`/image` (`/img`, `/attach`).

Kept: `/help`, `/new` (`/clear`, `/reset`, `/n`, `/c`), `/history` (`/chats`),
`/feedback`, `/bash` (`/!`), `/theme:toggle`, `/exit` (`/quit`, `/q`), skill
commands (`/skill:*`).

`/login` is not part of this build: there is no account to sign in to.

---

## 9. Directory Structure

```
directioner/
├── SPEC.md          # This file (product-level spec)
├── README.md        # Product-level documentation
├── cli/
│   ├── build.ts            # Builds the BYOK standalone binary
│   ├── package-release.ts  # Assembles the npm package (binary + launcher)
│   ├── release.ts          # Build → package → validate (never publishes)
│   ├── smoke-test.test.ts
│   └── release/            # npm package: committed launcher + metadata
└── e2e/             # tmux-driven end-to-end tests against the built binary
```

The `e2e/` suite drives the real binary in a tmux session — startup, version,
help, slash commands, code edit, knowledge file, terminal command, ads behavior,
and a live turn.

---

## 10. Testing Strategy

- **Unit** — provider registry and config schema (`.strict()`, key-name
  validation, `active` must be configured); BYOK resolution and its error
  messages; `shouldValidateAgentsRemotely` returning `false` on the Directioner
  build.
- **Build** — `directioner/cli/smoke-test.test.ts` asserts the built binary
  starts with no login prompt.
- **E2E (tmux)** — the `directioner/e2e/` suite against the built binary.
- **Runtime** — run the binary with an empty `HOME` and a mock provider to
  confirm first-run setup guidance, that `--version` works, that the config
  directory is `directioner`, and that the only egress is the provider.

---

## 11. Non-Goals

- No hosted account, login or session on this build.
- No credits, subscription or usage UI.
- No Directioner-controlled inference endpoint.
- No image attachments (the built-in providers that would be used are not
  universally multimodal).
