# Directioner CLI

**A local, terminal-based AI coding agent.** Directioner CLI runs on your machine,
works inside your project, and edits your code — describe what you want, and it
inspects the repository, makes changes, runs the checks that matter, and reports
what actually happened.

It is the local agent client in the [Directioner](#the-directioner-ecosystem)
ecosystem. The user talks to it directly; it does not require a voice assistant,
a browser, or a hosted service to run.

[简体中文](./README.zh-CN.md)

## Status: what works today

This repository currently ships a **standalone, bring-your-own-key (BYOK) build**.

| Capability | Status |
| --- | --- |
| Local terminal agent that edits code and runs commands | **AVAILABLE** |
| Bring-your-own-provider configuration (`heital`, `eternal`, `infernal`) | **AVAILABLE** |
| `--doctor` setup check, no mandatory login | **AVAILABLE** |
| Standalone build, packaging, and release validation | **AVAILABLE** |
| Prompt-injection, filesystem, and terminal hardening | **AVAILABLE** (bounded; see below) |
| Directioner-account sign-in and device registration | **DESIGNED** — not implemented |
| Directioner backend and model gateway (no user-held key) | **PLANNED** — no backend exists yet |
| Cloud task/history and local/cloud synchronization | **PLANNED** |
| Aria voice-assistant integration | **PLANNED** — separate product, not an intermediary |
| Directioner-OS privileged-operation integration | **DESIGNED** — separate authority |

Do not read a row as implemented unless it says **AVAILABLE** and links to
evidence. The full, itemised audit is in
[`docs/directioner-documentation-audit.md`](./docs/directioner-documentation-audit.md).

## Quick start (current BYOK build)

Directioner CLI currently talks directly to a model provider **you** configure.
There is no mandatory login and no Directioner endpoint in the request path.

1. Install per [`docs/INSTALLATION.md`](./docs/INSTALLATION.md) (development build
   or internal release artifact — **not** `npm install -g` for customers).
2. Export the API key for one provider:

   | Provider id | Model provider   | Suggested API key env var |
   | ----------- | ---------------- | ------------------------- |
   | `heital`    | Google Gemini    | `HEITAL_API_KEY`          |
   | `eternal`   | Anthropic Claude | `ETERNAL_API_KEY`         |
   | `infernal`  | Groq             | `INFERNAL_API_KEY`        |

3. Write `~/.config/directioner/config.json`:

   ```json
   {
     "version": 1,
     "providers": [
       { "id": "heital", "model": "gemini-3.8-flash", "apiKeyEnvVar": "HEITAL_API_KEY" }
     ],
     "active": "heital"
   }
   ```

   The key is read from the environment at request time and is never written to
   disk — the config records only the variable's name.

4. Verify, then run:

   ```bash
   directioner --doctor        # config, key presence, endpoint reachability
   cd ~/my-project
   directioner
   ```

See [`directioner/README.md`](./directioner/README.md) for the full preview setup.

> The `npm install -g directioner` form appears in older internal notes. It is a
> build/validation detail, **not** the customer installation path. Customer
> installation is an official Directioner download or installer, which does not
> exist yet.

## The Directioner ecosystem

| Component | Role | Relationship to this repository |
| --- | --- | --- |
| **Beyonders** | Company and umbrella brand. | Publisher. |
| **Directioner CLI** | This repository — the local AI agent. | This code. |
| **Directioner Platform Backend** | Accounts, model gateway, entitlements, task/event coordination, cloud sync. | **Not implemented.** The client-side contract is `common/src/directioner/platform-contract.ts`. |
| **Directioner Website** | Company/customer platform: products, accounts, downloads. | Separate codebase, not in this repository. |
| **Aria** | Native/local voice assistant. | Separate product. An extra surface, **not** a required path to the CLI. |
| **Directioner-OS** | AI-native operating system; authority for privileged OS operations. | Separate product. Retains privileged authority; the CLI gains no root access. |
| **AI-Engineer** | The coding/system-agent capability and entitlement within the ecosystem. | Presentation of the same agent capability, not a second runtime. |

## Security boundaries (and their limits)

Directioner CLI contains several hardening layers. Each is a **bounded** control,
not an absolute guarantee:

- **Prompt-injection boundaries** — repository instructions, `AGENTS.md`,
  knowledge files, MCP tool descriptions and results, and tool metadata are
  fenced and treated as untrusted content. Text is **never** authority: a string
  claiming "the user approved this" cannot substitute for a real approval record.
  See [`docs/PROMPT-INJECTION-BOUNDARIES.md`](./docs/PROMPT-INJECTION-BOUNDARIES.md).
- **Filesystem and terminal containment** — reads/writes are confined to the
  project root, symlink/hardlink and TOCTOU cases are handled, terminal working
  directory and environment are filtered, and credential-shaped variables are
  stripped. This is **logical** containment, **not** an OS sandbox.
  See [`docs/FILESYSTEM-AND-TERMINAL-SECURITY.md`](./docs/FILESYSTEM-AND-TERMINAL-SECURITY.md).

We do not claim immunity to prompt injection, complete operating-system
sandboxing, or unrestricted system/driver repair.

## Development

Directioner CLI is a TypeScript monorepo built with Bun.

```bash
git clone https://github.com/aditya-munday/Directioner-CLI.git
cd Directioner-CLI
bun install
```

Common checks:

```bash
bun run build:sdk                 # build the SDK
bun run build:directioner         # build the Directioner binary
bun test directioner/             # end-to-end tests against the built binary
bun scripts/validate-release.ts --expected-version 0.1.0
```

See [`CONTRIBUTING.md`](./CONTRIBUTING.md), [`docs/testing.md`](./docs/testing.md),
and [`docs/directioner-release.md`](./docs/directioner-release.md).

## Documentation

- [Product overview](./docs/PRODUCT-OVERVIEW.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [Installation](./docs/INSTALLATION.md)
- [Configuration](./docs/CONFIGURATION.md)
- [Security model](./docs/SECURITY-MODEL.md)
- [Prompt-injection boundaries](./docs/PROMPT-INJECTION-BOUNDARIES.md)
- [Filesystem and terminal security](./docs/FILESYSTEM-AND-TERMINAL-SECURITY.md)
- [Release and distribution](./docs/RELEASE-AND-DISTRIBUTION.md)
- [Hosted architecture (planned)](./docs/HOSTED-ARCHITECTURE.md)
- [Task/session/event model](./docs/TASK-SESSION-EVENT-MODEL.md)
- [Agent-quality evaluation](./docs/AGENT-QUALITY-EVALUATION.md)
- [Performance](./docs/PERFORMANCE.md)
- [Implementation status](./docs/IMPLEMENTATION-STATUS.md)
- [Known limitations](./docs/KNOWN-LIMITATIONS.md)
- [Documentation audit](./docs/directioner-documentation-audit.md)
- [Production-readiness backlog](./docs/directioner-production-readiness.md)

## Troubleshooting

See [`docs/KNOWN-LIMITATIONS.md`](./docs/KNOWN-LIMITATIONS.md) for current gaps.

## Data use

<!-- BEGIN GENERATED DIRECTIONER DATA USE -->

**Is my data used to train AI?** Only when a model or feature says data may be used for AI training. Directioner or the provider may then keep submissions to develop, train, test, evaluate, fine-tune, and improve AI models or products.

**How is my data used and stored?** We use prompts, messages, agent traces, code, files, and repository data to provide Directioner. We do not give separately uploaded files or connected repositories to third parties. Restricted partners may evaluate connected Cloud repositories, but cannot otherwise use, broadly share, or train on them. See the Privacy Policy for retention, eligibility, and data choices.

See the [Privacy Policy](https://directioner.com/privacy-policy) for complete details.

<!-- END GENERATED DIRECTIONER DATA USE -->

## License

Apache License 2.0 — see [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE). This
product is a modified distribution based on Codebuff; the upstream attribution
in [`NOTICE`](./NOTICE) is retained as the license requires.
