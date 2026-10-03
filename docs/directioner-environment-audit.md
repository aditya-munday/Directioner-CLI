# Directioner Environment-Variable Audit

Scope: every environment variable the Directioner CLI reads or writes, split
into the three classes that matter for the hosted customer architecture (D3 in
`directioner-open-decisions.md`):

1. **Customer runtime configuration** — things a customer may reasonably set
   locally (preferences, cache location, debug/dev options).
2. **Provider / backend secrets** — credentials that must never be normal
   customer configuration.
3. **Development / test only** — variables that exist because the current build
   is the BYOK developer preview, not the customer path.

This is a read-only audit plus the documentation consequence. No filtering was
weakened; the existing terminal-env controls are described in §4.

---

## 1. Provider API-key variables (class 2/3 — must not be customer config)

These are read by the BYOK developer-preview path only. In the production hosted
architecture the customer never sets any of them; the provider credential lives
on the backend.

| Variable | Where | Class |
| --- | --- | --- |
| `HEITAL_API_KEY` | `common/src/constants/directioner-providers.ts` (`defaultApiKeyEnvVar`) | dev/test |
| `ETERNAL_API_KEY` | same | dev/test |
| `INFERNAL_API_KEY` | same | dev/test |
| arbitrary name set by the user's `apiKeyEnvVar` | `common/src/constants/directioner-config.ts` | dev/test |

Notes:

- The config file records only the **name** of the variable, never the value
  (`apiKeyEnvVar` is validated against `^[A-Za-z_][A-Za-z0-9_]*$`), so a pasted
  key cannot land on disk. This is a security control and must be preserved.
- `--doctor` prints whether the variable is set, never its value.
- These names appear in `directioner/README.md`, `directioner/SPEC.md`,
  `directioner/cli/release/README.md`, and `scripts/directioner-inference-smoke.ts`.
  The READMEs now label them as the developer preview.

## 2. Legacy vendor / backend variables (class 2 — not customer config)

Present because the CLI shares code with the hosted product. None should be set
by a Directioner customer.

| Variable | Notes |
| --- | --- |
| `BEYONDERS_API_KEY` | SDK client auth for the hosted product; the BYOK path never sends it |
| `BEYONDERS_GITHUB_TOKEN` | release tooling only (`cli/scripts/release.ts`, unused by Directioner) |
| `HOSTED_MODE` / `DIRECTIONER_MODE` | compile-time build flags, not runtime customer config |
| `HOSTED_CONFIG_DIR` | config-location fallback |
| `NEXT_PUBLIC_POSTHOG_*` | analytics host constants; no client is constructed in `DIRECTIONER_MODE` |

The client-side hosted contract (`common/src/directioner/platform-contract.ts`)
has **no field that can carry a provider or backend secret**, so a hosted turn
cannot receive one by construction (D4).

## 3. Customer runtime configuration (class 1)

| Variable | Purpose |
| --- | --- |
| `DIRECTIONER_CONFIG_DIR` | where `config.json` is read from (must be absolute) |
| `DIRECTIONER_CONFIG_FILE` | config file name override |
| `NO_COLOR` / terminal vars | display |
| `DIRECTIONER_*` debug/preference flags | development options |

## 4. Terminal environment filtering (unchanged, and must stay intact)

Two controls protect the shell a model asks for, and both are intact:

- `common/src/util/credential-env.ts` — `looksLikeCredentialEnvVar()` matches
  credential *shapes* (`*_TOKEN`, `*_SECRET`, `*_API_KEY`, `AWS_*`, `GH_*`,
  `OPENAI_*`, `ANTHROPIC_*`, `GEMINI_*`, …).
- `sdk/src/tools/terminal-env-policy.ts` — the default policy is an
  **allowlist** (`TERMINAL_ENV_ALLOWLIST`); anything not allowlisted is dropped,
  and a name that is both allowlisted and credential-shaped is dropped too.
  `assertTerminalEnvHasNoCredentials()` fails loudly if a credential-shaped name
  ever gets through.

Observation (not a defect): the credential *shapes* list does not include
`HEITAL_`/`ETERNAL_`/`INFERNAL_`/`GROQ_`. This does not open a path today because
the default policy is allowlist-based — an unlisted name is dropped regardless of
shape. It is recorded here so that if the policy is ever changed to a denylist,
these names are added first.

## 5. Conclusion

- No provider credential is *required* customer configuration in the production
  design; the variables above are the developer preview.
- No new secret-bearing variable was introduced by this work.
- The existing terminal-env credential filtering was neither weakened nor
  widened.
