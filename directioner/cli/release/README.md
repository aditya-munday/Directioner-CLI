# Directioner

**The terminal coding agent for Directioner-OS.**

> **Internal development preview.** This npm package is an internal, development
> artifact used to exercise the launcher path and its tests. It is **not** the
> customer distribution and is never published. The customer artifact is the
> prebuilt Linux **OS component** assembled by `scripts/build-component.ts` and
> included in the Directioner-OS image; the OS install provides `directioner`
> already installed.

Directioner-CLI is a built-in component of Directioner-OS. Open a terminal and
run `directioner` directly — no separate installer, no account, and no
provider key are required for the shipped product. The eventual production
architecture routes model access through Directioner-owned services; the
present BYOK configuration below is a development/testing path only.

An AI coding agent that runs in your terminal — describe what you want, and
Directioner edits your code.

## Platform

Directioner-CLI targets **Linux** (Directioner-OS). The component build produces
a Linux ELF executable; there is no Windows or macOS customer build.

## Configure (development / BYOK)

Directioner talks directly to a model provider you name. Export the API key for
the provider you want, then write `~/.config/directioner/config.json`:

| Provider id | Model provider   | Suggested API key env var |
| ----------- | ---------------- | ------------------------- |
| `heital`    | Google Gemini    | `HEITAL_API_KEY`          |
| `eternal`   | Anthropic Claude | `ETERNAL_API_KEY`         |
| `infernal`  | Groq             | `INFERNAL_API_KEY`        |

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

The key is read from the environment at request time and is never written to
disk. Run `directioner --doctor` to check the setup, and `directioner` with no
config to see the same guidance in the terminal.

## Usage

```bash
cd ~/my-project
directioner
```

## Updates

Directioner-CLI does not check for updates automatically and has no update
endpoint. Updates are delivered by **Directioner-OS**: installing a newer OS
image provides the updated component. `directioner --check-update` prints the
same guidance.

## Platform note

Directioner-CLI ships a **Linux** (Directioner-OS) ELF executable. There is no
Windows or macOS customer build.

## Data use

<!-- BEGIN GENERATED DIRECTIONER DATA USE -->

**Is my data used to train AI?** Only when a model or feature says data may be used for AI training. Directioner or the provider may then keep submissions to develop, train, test, evaluate, fine-tune, and improve AI models or products.

**How is my data used and stored?** We use prompts, messages, agent traces, code, files, and repository data to provide Directioner. We do not give separately uploaded files or connected repositories to third parties. Restricted partners may evaluate connected Cloud repositories, but cannot otherwise use, broadly share, or train on them. See the Privacy Policy for retention, eligibility, and data choices.

See the [Privacy Policy](https://directioner.com/privacy-policy) for complete details.

<!-- END GENERATED DIRECTIONER DATA USE -->

## Links

- [Documentation](https://github.com/aditya-munday/Directioner-CLI)
- [Repository](https://github.com/aditya-munday/Directioner-CLI)
- [Issues](https://github.com/aditya-munday/Directioner-CLI/issues)

## License

MIT
