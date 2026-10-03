# Directioner

**The terminal coding agent from Beyonders.** Directioner runs on your machine
and works on your codebase — describe what you want, and Directioner edits your
code.

## How you get Directioner

**Production (Directioner account).** The normal way to use Directioner is with a
Directioner account. You install the official Directioner application, sign in,
and register the device. Directioner then runs against Directioner-owned model
services, so you never configure or hold a model provider key:

1. Create or sign in to your Directioner account.
2. Install the official Directioner application for your platform.
3. Authenticate and register this device.
4. Start using Directioner.

> **Status.** This is the production direction and it is not yet available — the
> Directioner account backend and model gateway are still being built. Until
> they ship, use the developer preview below.

**Developer preview (bring your own provider).** For local development,
engineering tests, and explicit developer configurations, Directioner can run
directly against a model provider you configure yourself. This path is
**development/testing only** — it is not the customer onboarding model, and it
requires you to hold your own provider API key. See
[Development and testing (BYOK)](#development-and-testing-byok).

## Development and testing (BYOK)

> **Development/testing only.** This section is not the production customer
> path. It exists for local development and engineering tests.

An AI coding agent that runs in your terminal — describe what you want, and
Directioner edits your code.

### Configure

Directioner talks directly to a model provider you name. Pick one and export its
API key:

| Provider id | Model provider   | Suggested API key env var |
| ----------- | ---------------- | ------------------------- |
| `heital`    | Google Gemini    | `HEITAL_API_KEY`          |
| `eternal`   | Anthropic Claude | `ETERNAL_API_KEY`         |
| `infernal`  | Groq             | `INFERNAL_API_KEY`        |

Then write `~/.config/directioner/config.json`:

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

The env var name is whatever you set `apiKeyEnvVar` to; the table above is the
suggested convention. The API key is read from the environment at request time
and is never written to disk — the config records only the variable's name. Run
`directioner` with no config to see the same setup guidance in the terminal.

To point a provider at a self-hosted gateway or an OpenAI-compatible server
(including a model running on this machine), add a `baseUrl` to its entry, e.g.
`"baseUrl": "http://localhost:11434/v1"`. `https` is required except on
loopback, where plain `http` is allowed.

### Check the setup

Before opening the chat, confirm the wiring:

```bash
directioner --doctor          # config, key presence, endpoint reachability
directioner --doctor --ping   # also send one minimal request to confirm auth
```

`--doctor` prints which provider, model and endpoint the run would use, whether
the key variable is set (never its value), and whether the endpoint answers. It
exits non-zero on a failed check, so it is safe to script.

### Usage

```bash
cd ~/my-project
directioner
```

In this development mode every request goes straight from your machine to the
provider you configured. There is no login and no Beyonders endpoint involved.

## Project Structure

```
directioner/
├── cli/       # CLI build, packaging, and the npm launcher
└── e2e/       # tmux-driven end-to-end tests against the built binary
```

## Building from Source

```bash
# From the repo root
bun directioner/cli/build.ts 1.0.0
```

## Packaging a Release

The release pipeline builds, packages, and validates — and stops there. It never
publishes and never contacts a vendor endpoint.

```bash
# Build → assemble the npm package → validate. Nothing is published.
bun directioner/cli/release.ts 1.0.0

# Add --smoke to also run the binary smoke test.
bun directioner/cli/release.ts 1.0.0 --smoke
```

That produces `directioner/cli/release/dist/directioner-1.0.0.tgz`. The tarball
contains the compiled binary, its `tree-sitter.wasm` sibling, and the launcher;
installing it runs no install scripts and downloads nothing. To publish it,
do so deliberately:

```bash
npm publish directioner/cli/release/dist/directioner-1.0.0.tgz --access public
```

The release gate is `scripts/validate-release.ts`. It fails the build on a wrong
package identity, any vendor reference or credential in the package files, a
malformed archive, or a binary that is not a real native executable. Legacy
strings still embedded in the compiled binary are reported as warnings, not
blockers.

---

For everything else — what Directioner does, how it works, FAQ, and how it relates to Beyonders — see the [repo root README](../README.md). We keep that one up to date as the single source of truth.

## License

MIT
