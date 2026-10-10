# Known limitations

Honest, current gaps. None of these are hidden; failing and skipped tests are
kept visible rather than deleted.

## Product

- **No hosted product.** No account sign-in, device registration, model gateway,
  or cloud sync. The current build is BYOK.
- **No customer installer.** No official download URL, public installer,
  published version, release channel, or automatic updater exists. The customer
  experience is `directioner` preinstalled by the Directioner-OS image, which is
  owned by the OS and not part of this repository.
- **Linux only.** The build produces a Linux ELF executable and the component
  packages exactly that. Windows and macOS are not supported targets.
- **Not a privileged-system tool.** No driver repair, privileged system
  administration, or autonomous execution.
- **No Aria or Directioner-OS integration** in this repository.

## Security (bounded, by design)

- Prompt-injection boundaries are structural. They do not prove a model *reasons*
  correctly about hostile content.
- Filesystem containment is logical (project-root resolution plus the
  write/delete primitives), not an OS sandbox. No mount namespace outside a
  sponsored run.
- The terminal boundary controls the inherited environment and starting
  directory; it is **not** a filesystem or network sandbox. A shell that starts
  in the project can still read absolute paths or open a socket.
- `O_NOFOLLOW` is unavailable on Windows, so the pre-write containment check is
  the only defence for the final component there.
- The structured approval model is designed, not implemented. The property that
  holds is negative: no untrusted text carries an authorization field the runtime
  reads.

## Test suite

- `bun test` in `common/` reports pre-existing failures for tests that read
  directories not present in this repository slice (`web/`, `landing-lab/`,
  `directioner-desktop/`). These are **environmental**, not regressions.
- `bun test` in `sdk/` reports pre-existing failures that require a real LLM or
  subprocess and several that are flaky in this environment. Verified identical
  on a clean baseline.
- There is no real provider in CI; provider-behaviour coverage is mock-only.

## Release

- The vendor `posthog-node` package is still bundled, so its host constants
  remain as inert strings (reported as a warning, not a blocker).
- No npm publish, no GitHub release, and no production distribution exists.

## Tracked debt summary

| Item | Type | Impact |
| --- | --- | --- |
| `posthog-node` inert constants | Release warning | None on behaviour |
| Environmental test failures | Test hygiene | None on product |
| LLM-dependent e2e failures | Test hygiene | None on product |
| No live provider coverage | Coverage gap | Provider quality unproven |

See [`directioner-production-readiness.md`](./directioner-production-readiness.md)
for the actionable backlog.
