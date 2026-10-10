/**
 * `directioner --system-diagnostics`: a read-only Linux system report.
 *
 * This is the user-facing seam over `@beyonders/common/directioner/diagnostics`.
 * It exists so the capability the Directioner-OS workstreams plan against is
 * real today: a user can ask the CLI to look at the machine and get an
 * evidence-backed report, with each line traceable to a source.
 *
 * The report only ever reports what the OS actually returned. A section that
 * could not be read prints why (missing source, needs root, timed out) rather
 * than an empty success. Nothing here writes, elevates, or opens a network
 * connection.
 */

import {
  createProcessDiagnosticEnvironment,
  diagnoseBootState,
  diagnoseHardware,
  diagnoseKernelArch,
  diagnoseKernelModules,
  diagnoseKernelRelease,
} from '@beyonders/common/directioner/diagnostics'

import type {
  DiagnosticEnvironment,
  DiagnosticResult,
} from '@beyonders/common/directioner/diagnostics'

export interface SystemDiagnosticsReport {
  /** One rendered line per diagnostic, header included. */
  lines: string[]
  /** True when every probed diagnostic returned a non-error status. */
  ok: boolean
  /** Diagnostics that could not be read, with the reason, in order. */
  unavailable: Array<{ id: string; reason: string }>
}

export interface SystemDiagnosticsOptions {
  /** Inject a fully-formed environment (tests); defaults to the real one. */
  env?: DiagnosticEnvironment
  signal?: AbortSignal
}

/**
 * Probe the machine and render a report. The set of probes is fixed here and
 * runs sequentially so the report order is stable and a slow probe does not
 * hide a fast one.
 */
export async function runSystemDiagnostics(
  options: SystemDiagnosticsOptions = {},
): Promise<SystemDiagnosticsReport> {
  const env = options.env ?? createProcessDiagnosticEnvironment()
  const lines: string[] = [
    '### Directioner system diagnostics',
    '',
    `- Platform: ${env.platform} ${env.arch}`,
    `- Observed at: ${env.now()}`,
    '',
  ]
  const unavailable: SystemDiagnosticsReport['unavailable'] = []
  let ok = true

  const results: DiagnosticResult<unknown>[] = [
    await diagnoseKernelRelease(env, options.signal),
    await diagnoseKernelArch(env, options.signal),
    await diagnoseKernelModules(env),
    await diagnoseBootState(env, options.signal),
    await diagnoseHardware(env, 'pci', options.signal),
  ]

  for (const result of results) {
    lines.push(renderResult(result))
    if (result.status !== 'ok') {
      // An unreadable probe is not a failure of the run — a missing `lspci` is
      // a fact about the machine, not an error the user caused. Only a genuine
      // `error` status (malformed reachable data) marks the report not-ok.
      unavailable.push({
        id: result.id,
        reason: result.limitations[0] ?? result.status,
      })
      if (result.status === 'error') ok = false
    }
  }

  lines.push('')
  if (unavailable.length === 0) {
    lines.push('All probed diagnostics were readable.')
  } else {
    lines.push('Could not read:')
    for (const u of unavailable) {
      lines.push(`- ${u.id}: ${u.reason}`)
    }
  }

  return { lines, ok, unavailable }
}

function renderResult(result: DiagnosticResult<unknown>): string {
  const findings = result.findings.length
    ? result.findings.map((f) => `    - [${f.severity}] ${f.message}`).join('\n')
    : `    - (${result.status}: ${result.errorClass ?? 'no data'})`
  const warning = result.warnings.length
    ? `\n    ! ${result.warnings.join('; ')}`
    : ''
  return [`### ${result.id}`, `  source: ${result.source.kind} ${result.source.source}`, findings + warning].join(
    '\n',
  )
}
