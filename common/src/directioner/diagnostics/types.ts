/**
 * Read-only Linux system diagnostics — the typed result model.
 *
 * WHY THIS EXISTS
 *
 * Directioner-CLI is intended to become the native agent of Directioner-OS, so
 * the user can ask "why did this service fail" or "why is this driver not
 * working" and get an evidence-backed answer. That requires reading the system:
 * kernel state, devices, drivers, boot and service state, packages.
 *
 * The one property every diagnostic here holds is: **it never invents a fact
 * the OS did not report.** Every result names its source, carries an explicit
 * status, and separates *findings* (derived from observed data) from
 * *limitations* (what could not be read, and why). When the source is missing,
 * the result is `unavailable` — not a plausible-looking guess.
 *
 * These are read-only primitives. Nothing in this module mutates the system.
 * A runtime, killable diagnostic command reads files and runs allowlisted
 * binaries; it never writes, never elevates, and never shells out a string.
 *
 * WHAT THIS IS NOT
 *
 * It is not a kernel sandbox. A process that can read `/proc` can read more of
 * it than these helpers do. The boundary this module enforces is *what it will
 * ask for and how it asks*: fixed absolute executables, validated argument
 * atoms, bounded output, redaction, and an honest error taxonomy — not an
 * isolation guarantee. The executor's own notes say the same thing.
 */

/** The subsystem a diagnostic inspects. */
export type DiagnosticDomain =
  | 'kernel'
  | 'hardware'
  | 'driver'
  | 'boot'
  | 'service'
  | 'package'

/**
 * The outcome of a diagnostic attempt.
 *
 * `ok` means the source was read and the findings are meaningful. The failure
 * states are kept distinct on purpose so a caller never renders "we could not
 * look" as "there is nothing there":
 *
 *  - `unavailable` — the source does not exist on this system (e.g. no procfs,
 *    no systemd, module directory absent). Not an error; a capability gap.
 *  - `denied` — the source exists but the process may not read it (EPERM/EACCES).
 *  - `timeout` — a bounded command exceeded its budget.
 *  - `cancelled` — the caller aborted.
 *  - `error` — the source was reachable but malformed or the read failed.
 */
export type DiagnosticStatus =
  | 'ok'
  | 'unavailable'
  | 'denied'
  | 'timeout'
  | 'cancelled'
  | 'error'

/** A stable, machine-readable failure class. Never a raw errno string. */
export type DiagnosticErrorClass =
  | 'permission_denied'
  | 'missing_source'
  | 'missing_executable'
  | 'malformed_output'
  | 'timeout'
  | 'cancelled'
  | 'output_truncated'
  | 'validation_failed'
  | 'unsupported'

/** Where a result's evidence came from, so a claim can be traced to a source. */
export interface EvidenceProvenance {
  /**
   * The absolute filesystem path read, or the absolute path of the executable
   * run. Never a caller-supplied string; always the path actually consulted.
   */
  source: string
  /** How the source was consulted. */
  kind: 'procfs' | 'sysfs' | 'file' | 'executable' | 'derived'
}

/** A conclusion drawn from observed data, or the absence of a data point. */
export interface DiagnosticFinding {
  /** Stable key, e.g. `module.not_loaded`. Callers match on this, not prose. */
  code: string
  /** Explanation assembled from observed values only. */
  message: string
  severity: 'info' | 'warning' | 'error'
}

/**
 * The full result of one diagnostic. `data` is the typed payload (or `null`
 * when unavailable); `findings` are derived; `warnings` and `limitations`
 * record what could not be established and are never silently dropped.
 */
export interface DiagnosticResult<T = Record<string, unknown>> {
  /** Stable diagnostic id, e.g. `kernel.release`. */
  id: string
  domain: DiagnosticDomain
  /** Identity of the thing inspected (module, unit, device, package, ...). */
  subject: string
  /** ISO-8601, from the injected clock — deterministic in tests. */
  observedAt: string
  source: EvidenceProvenance
  status: DiagnosticStatus
  data: T | null
  findings: DiagnosticFinding[]
  warnings: string[]
  errorClass: DiagnosticErrorClass | null
  /** What the environment could not provide (missing procfs, needs root, ...). */
  limitations: string[]
}

/** The injected capabilities a diagnostic is allowed to use. */
export interface DiagnosticEnvironment {
  /** `process.platform` in production; a fixture string in tests. */
  platform: string
  /** `process.arch` in production. */
  arch: string
  /** Injected clock so `observedAt` is deterministic under test. */
  now: () => string
  /**
   * Read a text file's first `maxBytes`, if present.
   *
   * A missing file is `missing_source`; an unreadable one is
   * `permission_denied`. Implementations must not follow a caller-shaped path:
   * callers pass only paths this module built.
   */
  readTextFile: (path: string, maxBytes: number) => ReadOutcome
  /** Whether a path exists (no follow of a dangling final link needed here). */
  exists: (path: string) => boolean
  /** Read a symlink target (used for driver binding), or null if unreadable. */
  readLink: (path: string) => string | null
  /** List directory entry names, or a failure. */
  readDir: (path: string) => DirOutcome
  /**
   * Run an allowlisted executable with a validated, fixed argument array.
   * Implementations must reject an executable outside the allowlist.
   */
  run: (spec: RunSpec) => Promise<RunOutcome>
}

export type ReadOutcome =
  | { ok: true; text: string; truncated: boolean }
  | { ok: false; errorClass: DiagnosticErrorClass }

export type DirOutcome =
  | { ok: true; entries: string[] }
  | { ok: false; errorClass: DiagnosticErrorClass }

export interface RunSpec {
  /** Absolute path chosen from the module's allowlist, never caller input. */
  executable: string
  /** Fixed arguments. Each element is validated by the caller. */
  args: readonly string[]
  /** Milliseconds before the run is killed. */
  timeoutMs: number
  /** Optional caller cancellation. */
  signal?: AbortSignal
  /** Cap on captured bytes for each of stdout/stderr. */
  maxBytes: number
}

export type RunOutcome =
  | {
      ok: true
      status: number | null
      stdout: string
      stderr: string
      truncated: boolean
    }
  | { ok: false; errorClass: DiagnosticErrorClass }
