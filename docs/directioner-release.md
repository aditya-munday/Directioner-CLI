# Directioner release process

This document describes how a Directioner release is built, packaged, validated,
and tested. It is Directioner-owned and self-contained: nothing here depends on
a Beyonders backend, a hosted account, a vendor workflow, or a registry secret.

## The one rule

A release is the artifact the pipeline produced, and that artifact is the thing
the gates exercised. There is no separate "publish" step that trusts a
different build.

## What a release does not do

- No `npm publish`, and no registry write of any kind.
- No GitHub release or tag is created.
- No dispatch to `BeyondersAI/directioner-private` or any legacy workflow.
- No provider API key, deploy secret, or vendor credential is required.

The workflow runs with `permissions: contents: read` and references no
`secrets.*`.

## Local: build a release

```bash
bun install --frozen-lockfile
bun run build:sdk
bun directioner/cli/release.ts 0.1.0
```

`directioner/cli/release.ts` is the pipeline entrypoint. It runs, in order:

1. `directioner/cli/build.ts <version>` — builds the BYOK standalone binary
   (`DIRECTIONER_MODE=true`, `HOSTED_MODE=false`) into `cli/bin/directioner`.
2. `directioner/cli/package-release.ts <version>` — assembles the npm package
   directory (`directioner/cli/release/.build`) and runs `npm pack` into
   `directioner/cli/release/dist/directioner-<version>.tgz`.
3. `scripts/validate-release.ts --expected-version <version>` — the hard gate.

Nothing in this pipeline opens a network connection.

## The gates

Each gate is a script in `scripts/` so it can be run by hand and in CI
identically.

| Script | What it proves |
| ------ | -------------- |
| `validate-release.ts` | The package is a valid, correctly-identified, secret-free, Directioner-owned release with a runnable binary. |
| `test-validator-failures.ts` | The validator actually fails on injected defects (the gate is not silently broken). |
| `package-manifest.ts` | Prints the tarball inventory — every entry's role, size, and sha256 — and rejects development-only files. |
| `check-no-vendor-egress.ts` | Source contains no forbidden egress hostnames. |
| `test-release-artifact.ts` | The packed tarball installs cleanly, runs offline, has no login flow, and launches the packaged binary. |
| `test-binary-offline.ts` | The packaged binary itself runs with no network reachable, inside a Linux network namespace (`unshare -n`). Skips clearly where namespaces are unavailable. |
| `net-guard.cjs` | A `--require` preload that turns any outbound socket, DNS, or `fetch` into a thrown error, for the artifact test. |

### Version consistency

`validate-release.ts --expected-version <v>` checks the whole chain: the
packaged `package.json` version, the requested release version, and the version
the **packaged binary itself reports** via `directioner --version`. A build that
stamps the wrong version fails here.

A binary that cannot be executed on the validating machine (a synthetic fixture,
or a package built for another platform) skips the version check rather than
reporting a false mismatch. The artifact test runs the real binary on its own
platform, so the chain is still verified end to end.

### Offline guarantee

The artifact test runs the installed wrapper with `node --require
scripts/net-guard.cjs` and asserts that `--version`, `--doctor`, `--check-update`,
and `--help` make **zero** network attempts. This is stronger than grepping the
source: it catches a connection made indirectly through a dependency.

The one place the test deliberately touches the network is a loopback HTTP
server (`127.0.0.1`) used to exercise the configured-provider `--doctor` path.
That is local, and it also asserts the report names the key's environment
variable and never prints its value.

## Failure behavior

The validator exits `0` only when every `error`-severity check passes. Each
failure names the defect class. `scripts/test-validator-failures.ts` proves the
gate with 11 injections, including: an injected vendor URL, a fake credential, a
missing `tree-sitter.wasm`, a wrong package or executable name, an archive
nested inside itself, a missing binary, vendor repository metadata, a
binary/package version mismatch, a README without BYOK guidance, and a
development-only file shipped.

## CI

`.github/workflows/directioner-release.yml` runs on `workflow_dispatch` and on
pull requests that touch the release path. It builds, packages, manifests,
validates, runs the failure injections, runs the egress guard, runs the
Directioner unit and e2e suites, runs the clean-install artifact test, and
uploads the tarball as a build artifact.

## Legacy release machinery (not used by Directioner)

These paths serve the other products and are left in place but are **not** part
of the Directioner release:

- `cli/scripts/release.ts` — dispatches
  `BeyondersAI/directioner-private/actions/workflows/cli-release-prod.yml` using
  a `BEYONDERS_GITHUB_TOKEN`. It is reachable only via `bun run release` in
  `cli/package.json`, requires a vendor token, and targets a vendor repository.
  Directioner never calls it.
- `cli/release-core/` — the legacy download-and-self-update launcher core. Its
  README marks it as not used by Directioner.
- `cli/release-staging/` — legacy staging package.

These are historical debt. Do not wire them into a Directioner release.

## Known tracked debt (follow-up)

`posthog-node` is still bundled into the Directioner binary, through
`common/src/analytics-core.ts`. In `DIRECTIONER_MODE`, `initAnalytics()` installs
a no-op client and returns before any client is constructed, so nothing is sent —
but the module's host constants (`us.i.posthog.com`, etc.) remain as inert
strings in the compiled binary, which is why the validator and the egress guard
report posthog as tracked debt rather than zero.

Removing it is a bundling task, not a release-gate task: the CLI imports
`posthog-node` for the hosted variant, and dead-code elimination does not
currently drop the module. The clean fix is to make the analytics client
injectable so the Directioner build never pulls in `posthog-node` at all. Until
then this is a non-blocking warning; it is not a network call and not a
correctness defect.
