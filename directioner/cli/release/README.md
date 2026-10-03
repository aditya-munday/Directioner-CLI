# Directioner

**The terminal coding agent from Beyonders.**

> **Development/testing preview.** This package is the developer preview. It is
> not the production customer onboarding path. Production Directioner is a
> locally installed application that signs in to a Directioner account and runs
> against Directioner-owned model services — you do not configure a provider key.
> That backend is still being built. This preview exists for local development
> and engineering tests, and it runs directly against a model provider you
> configure yourself.

An AI coding agent that runs in your terminal — describe what you want, and
Directioner edits your code.

## Install (preview)

```bash
npm install -g directioner
```

The package ships the compiled binary for your platform. Nothing is downloaded
at install time or on first run.

## Configure (preview)

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

This package does not check for updates automatically and has no update
endpoint. To update, reinstall:

```bash
npm install -g directioner
```

`directioner --check-update` prints the same guidance.

## Older Intel Macs (without AVX2)

If the standard Intel binary exits with an illegal-instruction error, install
the `darwin-x64-baseline` build instead and keep the extracted `directioner`
binary and `tree-sitter.wasm` together.

## Links

- [Documentation](https://github.com/aditya-munday/Directioner-CLI)
- [Repository](https://github.com/aditya-munday/Directioner-CLI)
- [Issues](https://github.com/aditya-munday/Directioner-CLI/issues)

## License

MIT
