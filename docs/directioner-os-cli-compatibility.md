# Directioner-OS ↔ Directioner-CLI compatibility

How the CLI relates to Directioner-OS, what capability contracts already exist
in code, and what is deliberately not claimed. Companion to
`directioner-system-architecture-map.md` (trust/authority map) and
`directioner-open-decisions.md` (D-series decisions).

The CLI is intended to become the native agent of Directioner-OS. "Native"
means two things, and they are at different maturity levels:

- **Reading the system** — inspecting kernel state, devices, drivers, boot and
  service state, packages, the kernel log. This is **implemented** as a
  bounded, read-only library (`common/src/directioner/diagnostics/`) with a
  user-facing report (`directioner --system-diagnostics`).
- **Changing the system** — restarting a unit, loading a module, setting a
  kernel parameter. This is **not implemented as an executor**. The client-side
  authorization contract exists (`common/src/directioner/operation-boundary.ts`);
  the privileged side (`ai-capabilityd`) does not.

## 1. Capability contracts that exist today

| Contract | File | Real vs design |
| -------- | ---- | -------------- |
| Platform client contract (account, task, approval, entitlements) | `common/src/directioner/platform-contract.ts` | **design** — types and pure helpers only; no HTTP client, no backend |
| Read-only system diagnostics | `common/src/directioner/diagnostics/` | **real** — reads the local system, allowlisted, bounded |
| Privileged-operation boundary (client half) | `common/src/directioner/operation-boundary.ts` | **real** client logic; the executor it calls is not implemented |
| BYOK provider adapter | `cli/src/utils/directioner-byok.ts` | **real** — development/test path |

The diagnostics and operation-boundary contracts are the concrete expression of
the "capability-declaration + sandbox model" the open-decisions doc sketches.
They are written so the OS side can be built against them without a rewrite.

## 2. Platform support

Directioner is Linux-only. There is no macOS or Windows release path
(`docs/directioner-release.md`). Diagnostics follow the same rule: on a
non-Linux host every diagnostic returns `unavailable` with an explicit
limitation, rather than attempting a partial reading.

| Host | Diagnostics | `--system-diagnostics` |
| ---- | ----------- | ---------------------- |
| Linux with systemd | full (kernel, modules, boot/services, devices, packages, log) | full |
| Linux without systemd (container, chroot) | kernel/modules/procfs yes; services report `unavailable` | yes, with a "systemd not the init system" limitation |
| Linux without `lspci`/`lsusb` | device enumeration reports `unavailable` | yes |
| Linux without `dpkg`/`rpm` | package lookup reports `unavailable` | yes |
| Non-Linux | `unavailable` across the board | reports the platform and the gaps |

A missing optional tool is a capability gap the report states, never an empty
success. This matters because the alternative — an empty hardware list — reads
to a user as "your machine has no devices".

## 3. What Directioner-OS is expected to provide

These are requirements the CLI is written against; the OS half is not built.

- **`ai-capabilityd`** — the privileged broker. The CLI hands it a validated,
  approved {@link OperationRequest} and receives a completed/failed outcome. It
  is the authority; the CLI is a client and holds no privilege itself.
- **Approval issuance** — only the OS authorization path issues an
  `OperationApproval` bound to an operation fingerprint. The CLI can submit a
  user's decision; it can never mint an approval.
- **PolicyEngine / Reviewer** — decide whether a requested operation is
  allowed, and review higher-risk operations, before the broker executes.

Until those exist, the only thing the CLI can do with a privileged operation is
*refuse to run it* and say why — which is precisely what
`docs/operation-boundary.md` specifies.

## 4. The evidence rule, applied to the OS

The architecture map separates *trust* (may I believe your input?) from
*authority* (may you cause an action?). Every capability contract here keeps
that separation:

- A diagnostic result is **data** and carries its provenance. It grants no
  authority.
- A tool result, a repository file, an MCP server, or a model's output can
  **request** an operation. None can authorize one.
- An approval is an **object** issued by an authority, bound to one operation.
  It is not a string, not a boolean, and not reusable.

## 5. Not in scope here

- The hosted Directioner backend (D3). Not started.
- A model-quality evaluation harness. Tracked separately.
- Any actual privileged execution on a user's machine. The boundary refuses
  without an approval from a system that does not yet exist.
