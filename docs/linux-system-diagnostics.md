# Linux system diagnostics

The read-only primitives the agent uses to answer "why did this fail on my
machine" — kernel, devices, drivers, boot and service state, packages, the
kernel log. Implemented in `common/src/directioner/diagnostics/`.

## 1. The evidence rule

Every result carries its source, a status, and its limitations. The failure
states are kept distinct so a caller never renders "we could not look" as
"there is nothing there":

| Status | Meaning |
| ------ | ------- |
| `ok` | The source was read; findings are meaningful. |
| `unavailable` | The source does not exist here (no procfs, no systemd, module dir absent). A capability gap, not an error. |
| `denied` | The source exists but the process may not read it (needs root). |
| `timeout` | A bounded command exceeded its budget. |
| `cancelled` | The caller aborted. |
| `error` | The source was reachable but malformed, or the read failed. |

`data` is `null` for every non-`ok` status. A diagnostic never returns a
plausible-looking guess. Two real cases enforced by tests:

- A host where `systemctl` exists but systemd is not PID 1 prints prose
  ("System has not been booted with systemd…"). The boot-state diagnostic
  detects it and returns `unavailable` — it does **not** count the words as two
  failed units.
- A malformed `uname` output is `malformed_output`, not a partial reading.

## 2. Surface

### Agent-facing library

`common/src/directioner/diagnostics/` exports typed diagnostics for `kernel`,
`hardware`, `driver`, `boot`, `service`, `package`. Each returns a
`DiagnosticResult<T>` with `findings` (derived, with stable `code`s), `warnings`,
and `limitations`.

All system access goes through an injectable `DiagnosticEnvironment`, so logic
is deterministic under test. `createProcessDiagnosticEnvironment()` is the only
production seam, and it:

- reads files with a byte cap and reports truncation;
- runs only executables from a fixed absolute-path allowlist
  (`DIAGNOSTIC_EXECUTABLES`), with a fixed argument array, no shell;
- kills on timeout and on abort;
- passes the child only `PATH`, `LANG`, `LC_ALL`, `HOME` — never credentials.

### CLI report

```
directioner --system-diagnostics
```

Prints a read-only report: which inspection capabilities the host has, kernel
release/arch, loaded modules, boot/service state, PCI devices. Each section
shows its source; a section that could not be read is listed under "Could not
read" with the reason. Exit code is 1 only when a *reachable* source was
malformed, not when a source is merely absent.

The report opens with `os.capabilities`, the machine-checkable form of the
compatibility matrix in `docs/directioner-os-cli-compatibility.md`. It answers
"can I look?" — procfs, sysfs, a running systemd, `journalctl`, `lspci`,
`lsusb`, `modinfo`, `dpkg`, `rpm` — before anything is read, so a capability
gap is stated once rather than rediscovered per section.

Example (a container with no systemd and no `lspci`):

```
### os.capabilities
  source: derived /proc
    - [ok] procfs
    - [ok] sysfs
    - [--] systemd (systemd reported 'offline', not a running init system)
    - [--] pci (lspci not installed)

### kernel.release
  source: executable /usr/bin/uname
    - [info] kernel 6.8.0-1055-gke on x86_64 (Linux)
### boot.state
  source: executable /usr/bin/systemctl
    - (unavailable: unsupported)

Could not read:
- boot.state: systemctl is present but systemd is not the init system here (container/chroot); boot state unavailable
- hardware.pci: lspci is not installed; hardware enumeration unavailable
```

## 3. Validation and injection safety

Any subject that becomes a process argument (module name, unit name, device id,
package name) is validated to a conservative atom before use:

- module/unit/device: `^[A-Za-z0-9][A-Za-z0-9._@:-]{0,127}$`
- package: same plus `+ ~`
- kernel parameter: a dotted atom, mapped to `/proc/sys/...` — traversal
  (`..`, `/`) is refused

A hostile subject (`"; rm -rf / #`, `a$(whoami)`, `` `id` ``, `../../etc/passwd`)
is refused with `validation_failed` and **no process is started**. Tests assert
this for the whole hostile-class list.

## 4. Redaction

Diagnostic output is redacted before it leaves the module: PEM private keys,
provider tokens (`ghp_`, `glpat-`, `xox…`, `AKIA…`, `AIza…`, `sk-…`), bearer
tokens, URL userinfo, JWTs, and `*_KEY/TOKEN/SECRET/PASSWORD=…` assignments.
The result records which classes matched and warns if anything was redacted.
The scrubber is a safety net, not a proof — diagnostics are also run with a
scrubbed child environment so a credential is never read in the first place.

## 5. What this is not

- Not a kernel sandbox. The boundary enforced is *what it asks for and how*: an
  allowlist, validated atoms, no shell, bounded output. A process that can read
  `/proc` can read more of `/proc` than these helpers do.
- Not a remediation tool. Nothing here writes, elevates, or changes state. See
  `docs/operation-boundary.md` for the privileged path.

## 6. Tests

- `common/src/directioner/diagnostics/__tests__/linux-diagnostics.test.ts` — 40
  injectable-environment cases: evidence discipline, hostile-subject refusal,
  timeout/cancel/truncation, device/driver, redaction, invariants.
- `common/src/directioner/diagnostics/__tests__/process-environment.test.ts` —
  6 cases against the real environment and real Linux files (allowlist
  enforcement, bounded reads, real kernel release, real `/proc/modules`).
- `cli/src/utils/__tests__/directioner-system-diagnostics.test.ts` — 4 cases
  over the report renderer.
