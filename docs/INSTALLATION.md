# Installation

Directioner CLI is intended to be **production locally installed software**, not
an end-user `npm install -g` product.

## Customer installation

**Status: DESIGNED.** Directioner CLI is a **preinstalled component of
Directioner-OS**, not an end-user `npm install -g` product and not a separate
download. In the intended customer experience the OS image provides `directioner`
already installed; the user opens a terminal and runs it. The OS image build step
that consumes this component (`scripts/build-component.ts`) is defined here; the
Directioner-OS image integration itself is owned by the OS and **is not part of
this repository**. No official download URL, public installer, published version,
release channel, or automatic updater is claimed, because none exists.

## Component build (engineers)

The customer artifact is a prebuilt Linux **component directory**, assembled from
the built binary:

```bash
bun run build:sdk
bun directioner/cli/build.ts 0.1.0
bun scripts/build-component.ts 0.1.0
bun scripts/validate-component.ts --expected-version 0.1.0
bun scripts/test-component-runtime.ts directioner/cli/release/component 0.1.0
```

This produces `directioner/cli/release/component/` (`bin/directioner`, its
sibling `bin/tree-sitter.wasm`, `manifest.json`, `SHA256SUMS`, `NOTICE`).
**Nothing is published.** See
[`RELEASE-AND-DISTRIBUTION.md`](./RELEASE-AND-DISTRIBUTION.md).

## Internal release packaging (engineers)

An **internal, development-only** npm tarball is also assembled, purely to
exercise the launcher path and its clean-install/artifact tests. It is never
published and is not a customer distribution.

```bash
bun directioner/cli/package-release.ts 0.1.0
bun scripts/validate-release.ts --expected-version 0.1.0
```

This produces `directioner/cli/release/dist/directioner-0.1.0.tgz`.

## Development installation

```bash
git clone https://github.com/aditya-munday/Directioner-CLI.git
cd Directioner-CLI
bun install
bun run build:sdk
bun run build:directioner
```

## Test setup

The end-to-end tests drive the built binary in tmux:

```bash
bun test directioner/
```

Some tests require `tmux`; they run on Linux (Directioner-OS).

## Local engineering build (fast iteration)

```bash
bun directioner/cli/build.ts 0.0.0-dev
./cli/bin/directioner --doctor
```

## Platforms

Directioner CLI targets **Linux** (Directioner-OS). The build produces a Linux
ELF executable, and the component packages exactly that. Windows and macOS are
not supported targets in this build; see
[`KNOWN-LIMITATIONS.md`](./KNOWN-LIMITATIONS.md). Audio/video/PDF model inputs
depend on the provider, not the client.
