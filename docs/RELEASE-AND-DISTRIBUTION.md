# Release and distribution

Directioner owns its release path. It builds, packages, and validates a release —
and stops there. It never publishes to npm, never creates a GitHub release, never
contacts a vendor endpoint, and requires no deploy secret.

The customer artifact is the **Directioner-OS component**: a prebuilt Linux
directory included in the Directioner-OS image. The npm tarball is an internal,
development-only artifact used to exercise the launcher path and must never be
published or presented as the customer distribution.

## Pipeline — customer component

```bash
bun run build:sdk
bun directioner/cli/build.ts <version>
bun scripts/build-component.ts <version>
bun scripts/validate-component.ts --expected-version <version>
bun scripts/test-component-runtime.ts directioner/cli/release/component <version>
bun scripts/test-component-failures.ts
bun scripts/check-no-vendor-egress.ts
bun scripts/test-binary-offline.ts directioner/cli/release/component/bin/directioner <version>
```

## Pipeline — internal npm path (development-only)

```bash
bun directioner/cli/package-release.ts <version>
bun scripts/package-manifest.ts directioner/cli/release/dist/directioner-<version>.tgz
bun scripts/validate-release.ts --expected-version <version>
bun scripts/test-validator-failures.ts
bun scripts/test-release-artifact.ts directioner/cli/release/dist/directioner-<version>.tgz <version>
```

## Components

- **Linux binary** — built by `directioner/cli/build.ts`, with the BYOK build
  flags set explicitly (`DIRECTIONER_MODE=true`, `HOSTED_MODE=false`).
- **`tree-sitter.wasm`** — shipped as a sibling resource of the binary; the
  component manifest and validator both require it.
- **OS component** (`scripts/build-component.ts`) — deterministic
  `directioner-cli-component/` layout (`bin/directioner`, sibling
  `bin/tree-sitter.wasm`, `manifest.json`, `SHA256SUMS`, `NOTICE`). This is the
  customer artifact.
- **Component validator** (`scripts/validate-component.ts`) — the hard gate for
  the component: identity, Linux ELF architecture, required assets, SHA256SUMS
  integrity, no unexpected executables, secret scanning, upstream attribution.
- **Component failure injection** (`scripts/test-component-failures.ts`) —
  injects 10 known component defects and asserts each is caught.
- **Component runtime test** (`scripts/test-component-runtime.ts`) — stages the
  component outside the repository, runs `--version` and the
  `--smoke-tree-sitter` wasm gate from a foreign cwd, and confirms tampering is
  rejected.
- **Internal npm launcher** (`directioner/cli/release/launcher.js`) — committed
  source, Node built-ins only. Development-only; it ships the binary inside the
  package and never downloads, self-updates, or phones a vendor origin.
- **Release validator** (`scripts/validate-release.ts`) — the internal-package
  gate: package identity, vendor references, credentials, archive structure,
  required runtime assets, binary authenticity, and documentation consistency.
- **Release failure injection** (`scripts/test-validator-failures.ts`) — injects
  11 known defects and asserts each is caught.
- **Clean-install artifact test** (`scripts/test-release-artifact.ts`) — installs
  the internal package into a clean prefix and runs the wrapper under
  `scripts/net-guard.cjs`, which makes any outbound socket, DNS, or `fetch` throw.
- **Offline binary test** (`scripts/test-binary-offline.ts`) — runs the binary in
  a network namespace with no reachable network.
- **Egress guard** (`scripts/check-no-vendor-egress.ts`) — fails on a live
  forbidden vendor endpoint; reports remaining vendor strings as tracked debt.
- **CI** — `.github/workflows/directioner-release.yml`, `contents: read`, no
  secrets, no publish. Builds, validates, and uploads the component on PRs
  touching the release path, plus a manual trigger. There is no `push: main`
  trigger; the workflow produces an artifact, not a release.

## Distribution model

Customer distribution is the **Directioner-OS image**, which provides
`directioner` preinstalled. This repository produces the component the image
build consumes; the image itself and its public download surface are owned by
Directioner-OS and **do not exist in this repository**. The internal npm tarball
is a development/validation artifact, not the customer installation path.

## Explicitly not done

- No `npm publish`.
- No GitHub release or tag.
- No dispatch of any legacy/vendor release workflow.
- No modification of registry state.

## Known tracked debt

The vendor `posthog-node` package is still bundled (via
`common/src/analytics-core.ts`), so its host constants remain as inert strings in
the binary. `initAnalytics()` installs a no-op client in `DIRECTIONER_MODE` and
no client is ever constructed. The validator reports this as a warning, not a
blocker.

See [`directioner-release.md`](./directioner-release.md) for the long-form
process description.
