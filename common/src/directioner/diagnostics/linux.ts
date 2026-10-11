/**
 * Bounded, read-only Linux diagnostics.
 *
 * Every function here:
 *  - takes an injected {@link DiagnosticEnvironment} rather than touching the
 *    real system directly, so behaviour is deterministic and testable;
 *  - builds every filesystem path itself (never from a caller-shaped string
 *    joined into a path), and validates any subject that becomes an argument;
 *  - only runs executables from {@link DIAGNOSTIC_EXECUTABLES}, by absolute
 *    path, with a fixed argument array — never a shell string;
 *  - bounds output and time, redacts credentials, and reports what it could
 *    not do instead of guessing.
 *
 * It is Linux-only. On another platform every function returns `unavailable`
 * with a limitation, rather than a fabricated reading.
 */

import { redactDiagnosticText } from './redaction'

import type {
  DiagnosticEnvironment,
  DiagnosticErrorClass,
  DiagnosticFinding,
  DiagnosticResult,
  EvidenceProvenance,
  RunOutcome,
} from './types'

// ---------------------------------------------------------------------------
// Executable allowlist. Absolute paths only. The model never chooses one.
// ---------------------------------------------------------------------------

/**
 * The binaries a diagnostic may run. Values are the absolute paths; a caller
 * picks a *key*, never a path, and the environment's `run` rejects anything not
 * in this set. None of these mutate the system.
 */
export const DIAGNOSTIC_EXECUTABLES = {
  uname: '/usr/bin/uname',
  lspci: '/usr/bin/lspci',
  lsusb: '/usr/bin/lsusb',
  systemctl: '/usr/bin/systemctl',
  journalctl: '/usr/bin/journalctl',
  modinfo: '/usr/sbin/modinfo',
  dpkg: '/usr/bin/dpkg-query',
  rpm: '/usr/bin/rpm',
} as const

export type DiagnosticExecutable = keyof typeof DIAGNOSTIC_EXECUTABLES

/** True when `name` is a key in the allowlist. */
export function isAllowedExecutable(
  name: string,
): name is DiagnosticExecutable {
  return Object.prototype.hasOwnProperty.call(DIAGNOSTIC_EXECUTABLES, name)
}

// ---------------------------------------------------------------------------
// Argument and subject validation.
// ---------------------------------------------------------------------------

/**
 * Kernel module / unit / device names are interpolated into an argument, so
 * they are validated to a conservative atom: letters, digits, and `. _ - : @`.
 * Anything else (spaces, slashes, shell metacharacters, control chars, unicode
 * separators) is refused with `validation_failed`. This is the anti-injection
 * gate that lets us use `run` without a shell at all — and the reason a hostile
 * service name like `"; rm -rf /"` never reaches a process.
 */
const SUBJECT_ATOM = /^[A-Za-z0-9][A-Za-z0-9._@:-]{0,127}$/

export function isValidSubject(value: unknown): value is string {
  return typeof value === 'string' && SUBJECT_ATOM.test(value)
}

/** Package names additionally allow `+` and `~` (Debian version/pin chars). */
const PACKAGE_ATOM = /^[A-Za-z0-9][A-Za-z0-9._+~:-]{0,127}$/

export function isValidPackageName(value: unknown): value is string {
  return typeof value === 'string' && PACKAGE_ATOM.test(value)
}

/** Max bytes captured per stream for an allowlisted command. */
export const DIAGNOSTIC_COMMAND_MAX_BYTES = 64 * 1024
/** Default per-command time budget. */
export const DIAGNOSTIC_COMMAND_TIMEOUT_MS = 5_000
/** Max bytes read from a single procfs/sysfs file. */
export const DIAGNOSTIC_FILE_MAX_BYTES = 32 * 1024

function isLinux(env: DiagnosticEnvironment): boolean {
  return env.platform === 'linux'
}

interface BaseFields {
  id: string
  domain: DiagnosticResult['domain']
  subject: string
  source: EvidenceProvenance
}

/** A result whose source was never reachable on this platform. */
function unavailable<T>(
  env: DiagnosticEnvironment,
  base: BaseFields,
  limitation: string,
): DiagnosticResult<T> {
  return {
    ...base,
    observedAt: env.now(),
    status: 'unavailable',
    data: null,
    findings: [],
    warnings: [],
    errorClass: 'unsupported',
    limitations: [limitation],
  }
}

/** A result for a failed read/run, classified honestly. */
function failure<T>(
  env: DiagnosticEnvironment,
  base: BaseFields,
  errorClass: DiagnosticErrorClass,
  limitation: string,
): DiagnosticResult<T> {
  const status =
    errorClass === 'permission_denied'
      ? 'denied'
      : errorClass === 'timeout'
        ? 'timeout'
        : errorClass === 'cancelled'
          ? 'cancelled'
          : errorClass === 'missing_source' || errorClass === 'missing_executable'
            ? 'unavailable'
            : 'error'
  return {
    ...base,
    observedAt: env.now(),
    status,
    data: null,
    findings: [],
    warnings: [],
    errorClass,
    limitations: [limitation],
  }
}

function fileFailureClass(
  errorClass: DiagnosticErrorClass,
): DiagnosticErrorClass {
  return errorClass
}

// ---------------------------------------------------------------------------
// Kernel
// ---------------------------------------------------------------------------

export interface KernelReleaseData {
  release: string
  version: string
}

/**
 * Kernel release and version from `uname`. Read through the allowlisted
 * `uname` binary rather than parsed from a prose command string.
 */
export async function diagnoseKernelRelease(
  env: DiagnosticEnvironment,
  signal?: AbortSignal,
): Promise<DiagnosticResult<KernelReleaseData>> {
  const source: EvidenceProvenance = {
    source: DIAGNOSTIC_EXECUTABLES.uname,
    kind: 'executable',
  }
  const base: BaseFields = {
    id: 'kernel.release',
    domain: 'kernel',
    subject: 'kernel',
    source,
  }
  if (!isLinux(env)) {
    return unavailable(env, base, 'kernel release is a Linux-only diagnostic')
  }
  const run = await runGuarded(env, 'uname', ['-srm'], signal)
  if (!run.ok) {
    return failure(env, base, run.errorClass, run.limitation)
  }
  const text = run.text.trim()
  const [sysname, release, machine] = text.split(/\s+/)
  if (!release) {
    return failure(
      env,
      base,
      'malformed_output',
      'uname did not report a kernel release',
    )
  }
  const findings: DiagnosticFinding[] = [
    {
      code: 'kernel.release.observed',
      message: `kernel ${release} on ${machine ?? 'unknown'} (${sysname ?? 'Linux'})`,
      severity: 'info',
    },
  ]
  return {
    ...base,
    observedAt: env.now(),
    status: 'ok',
    data: { release, version: run.text.trim() },
    findings,
    warnings: run.truncated
      ? ['uname output was truncated at the byte limit']
      : [],
    errorClass: null,
    limitations: [],
  }
}

export interface KernelArchData {
  machine: string
  operatingSystem: string
}

/** Architecture and OS identity from `uname`. */
export async function diagnoseKernelArch(
  env: DiagnosticEnvironment,
  signal?: AbortSignal,
): Promise<DiagnosticResult<KernelArchData>> {
  const source: EvidenceProvenance = {
    source: DIAGNOSTIC_EXECUTABLES.uname,
    kind: 'executable',
  }
  const base: BaseFields = {
    id: 'kernel.arch',
    domain: 'kernel',
    subject: 'kernel',
    source,
  }
  if (!isLinux(env)) {
    return unavailable(env, base, 'architecture is a Linux-only diagnostic')
  }
  const run = await runGuarded(env, 'uname', ['-sm'], signal)
  if (!run.ok) {
    return failure(env, base, run.errorClass, run.limitation)
  }
  const [operatingSystem, machine] = run.text.trim().split(/\s+/)
  if (!machine) {
    return failure(env, base, 'malformed_output', 'uname reported no machine')
  }
  return {
    ...base,
    observedAt: env.now(),
    status: 'ok',
    data: { machine, operatingSystem: operatingSystem ?? 'Linux' },
    findings: [
      {
        code: 'kernel.arch.observed',
        message: `architecture ${machine}`,
        severity: 'info',
      },
    ],
    warnings: [],
    errorClass: null,
    limitations: [],
  }
}

export interface LoadedModule {
  name: string
  sizeBytes: number | null
  usedBy: string[]
}

export interface KernelModulesData {
  modules: LoadedModule[]
  count: number
}

/**
 * Loaded kernel modules from `/proc/modules`. Procfs, not `lsmod` — no process
 * needed, and the file is read with a bounded reader.
 */
export async function diagnoseKernelModules(
  env: DiagnosticEnvironment,
): Promise<DiagnosticResult<KernelModulesData>> {
  const source: EvidenceProvenance = { source: '/proc/modules', kind: 'procfs' }
  const base: BaseFields = {
    id: 'kernel.modules',
    domain: 'kernel',
    subject: 'modules',
    source,
  }
  if (!isLinux(env)) {
    return unavailable(env, base, 'kernel modules are a Linux-only diagnostic')
  }
  const read = env.readTextFile('/proc/modules', DIAGNOSTIC_FILE_MAX_BYTES)
  if (!read.ok) {
    return failure(
      env,
      base,
      fileFailureClass(read.errorClass),
      read.errorClass === 'permission_denied'
        ? 'may require elevated privileges to read /proc/modules'
        : '/proc/modules is not available on this system',
    )
  }
  const modules: LoadedModule[] = []
  for (const line of read.text.split('\n')) {
    if (!line.trim()) continue
    const cols = line.split(/\s+/)
    const [name, size, _refcount, usedBy] = cols
    if (!name) continue
    // A real /proc/modules row has at least four columns and a numeric size.
    // A junk line that does not (a stray header, a truncated tail) is skipped
    // rather than turned into a module with invented fields.
    const sizeBytes = Number.parseInt(size ?? '', 10)
    if (cols.length < 4 || !Number.isFinite(sizeBytes)) continue
    modules.push({
      name,
      sizeBytes,
      usedBy: !usedBy || usedBy === '-' ? [] : usedBy.split(',').filter(Boolean),
    })
  }
  return {
    ...base,
    observedAt: env.now(),
    status: 'ok',
    data: { modules, count: modules.length },
    findings: [
      {
        code: 'kernel.modules.count',
        message: `${modules.length} kernel module(s) loaded`,
        severity: 'info',
      },
    ],
    warnings: read.truncated
      ? ['/proc/modules was truncated at the byte limit']
      : [],
    errorClass: null,
    limitations: [],
  }
}

export interface ModuleInfoData {
  module: string
  filename: string | null
  description: string | null
  license: string | null
  version: string | null
  depends: string[]
  loaded: boolean | null
}

/**
 * Metadata for one kernel module from `modinfo`, plus whether it is currently
 * loaded (cross-referenced against `/proc/modules`). The module name is
 * validated before it becomes an argument.
 */
export async function diagnoseModuleInfo(
  env: DiagnosticEnvironment,
  moduleName: string,
  signal?: AbortSignal,
): Promise<DiagnosticResult<ModuleInfoData>> {
  const source: EvidenceProvenance = { source: '/proc/modules', kind: 'procfs' }
  const base: BaseFields = {
    id: 'kernel.module.info',
    domain: 'kernel',
    subject: moduleName,
    source,
  }
  if (!isLinux(env)) {
    return unavailable(env, base, 'module metadata is a Linux-only diagnostic')
  }
  if (!isValidSubject(moduleName)) {
    return failure(
      env,
      base,
      'validation_failed',
      `refused a module name that is not a plain module atom: ${JSON.stringify(moduleName)}`,
    )
  }
  const run = await runGuarded(env, 'modinfo', [moduleName], signal)
  if (!run.ok) {
    return failure(env, base, run.errorClass, run.limitation)
  }
  const data = parseModinfo(moduleName, run.text)
  const loaded = await isModuleLoaded(env, moduleName)
  if (loaded === null) data.loaded = null
  else data.loaded = loaded
  const findings: DiagnosticFinding[] = []
  findings.push({
    code: data.loaded ? 'module.loaded' : 'module.not_loaded',
    message: data.loaded
      ? `module ${moduleName} is loaded`
      : `module ${moduleName} is present but not loaded`,
    severity: data.loaded ? 'info' : 'warning',
  })
  return {
    ...base,
    observedAt: env.now(),
    status: 'ok',
    data,
    findings,
    warnings: run.truncated ? ['modinfo output was truncated'] : [],
    errorClass: null,
    limitations: loaded === null ? ['could not read /proc/modules to confirm load state'] : [],
  }
}

function parseModinfo(module: string, text: string): ModuleInfoData {
  const field = (key: string): string | null => {
    const line = text.split('\n').find((l) => l.startsWith(`${key}:`))
    return line ? line.slice(key.length + 1).trim() : null
  }
  const depends = field('depends')
  return {
    module,
    filename: field('filename'),
    description: field('description'),
    license: field('license'),
    version: field('version'),
    depends: depends ? depends.split(',').filter(Boolean) : [],
    loaded: null,
  }
}

async function isModuleLoaded(
  env: DiagnosticEnvironment,
  name: string,
): Promise<boolean | null> {
  const read = env.readTextFile('/proc/modules', DIAGNOSTIC_FILE_MAX_BYTES)
  if (!read.ok) return null
  return read.text
    .split('\n')
    .some((line) => line.split(/\s+/)[0] === name)
}

export interface KernelParameterData {
  parameter: string
  value: string | null
}

/**
 * A single kernel parameter from `/proc/sys/<path>`. The caller supplies a
 * parameter path such as `net.ipv4.ip_forward`; it is validated to a dotted
 * atom and mapped to `/proc/sys/net/ipv4/ip_forward`. No arbitrary path is ever
 * built from input.
 */
export async function diagnoseKernelParameter(
  env: DiagnosticEnvironment,
  parameter: string,
): Promise<DiagnosticResult<KernelParameterData>> {
  const source: EvidenceProvenance = { source: '/proc/sys', kind: 'procfs' }
  const base: BaseFields = {
    id: 'kernel.parameter',
    domain: 'kernel',
    subject: parameter,
    source,
  }
  if (!isLinux(env)) {
    return unavailable(env, base, 'kernel parameters are a Linux-only diagnostic')
  }
  const path = parameterPath(parameter)
  if (!path) {
    return failure(
      env,
      base,
      'validation_failed',
      `refused a kernel parameter that is not a dotted atom: ${JSON.stringify(parameter)}`,
    )
  }
  const read = env.readTextFile(path, 4096)
  if (!read.ok) {
    return failure(
      env,
      base,
      fileFailureClass(read.errorClass),
      `could not read ${path}`,
    )
  }
  return {
    ...base,
    observedAt: env.now(),
    status: 'ok',
    data: { parameter, value: read.text.trim() },
    findings: [
      {
        code: 'kernel.parameter.observed',
        message: `${parameter} = ${read.text.trim()}`,
        severity: 'info',
      },
    ],
    warnings: [],
    errorClass: null,
    limitations: [],
  }
}

/** Map a dotted parameter to a `/proc/sys` path, or null if it is not one. */
function parameterPath(parameter: string): string | null {
  if (typeof parameter !== 'string') return null
  // Dotted segments, each a plain atom; no empty segments, no traversal.
  if (!/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){0,6}$/.test(parameter)) return null
  return `/proc/sys/${parameter.replace(/\./g, '/')}`
}

// ---------------------------------------------------------------------------
// Hardware and driver
// ---------------------------------------------------------------------------

export interface PciDevice {
  slot: string
  vendorDevice: string
  className: string
  description: string
  driver: string | null
}

export interface HardwareData {
  bus: 'pci' | 'usb'
  devices: PciDevice[]
  count: number
}

/**
 * PCI or USB devices from `lspci`/`lsusb`. Missing binary → `unavailable`,
 * never an empty-but-ok list.
 */
export async function diagnoseHardware(
  env: DiagnosticEnvironment,
  bus: 'pci' | 'usb',
  signal?: AbortSignal,
): Promise<DiagnosticResult<HardwareData>> {
  const exe = bus === 'pci' ? 'lspci' : 'lsusb'
  const source: EvidenceProvenance = {
    source: DIAGNOSTIC_EXECUTABLES[exe],
    kind: 'executable',
  }
  const base: BaseFields = {
    id: `hardware.${bus}`,
    domain: 'hardware',
    subject: bus,
    source,
  }
  if (!isLinux(env)) {
    return unavailable(env, base, 'hardware enumeration is Linux-only')
  }
  if (!env.exists(DIAGNOSTIC_EXECUTABLES[exe])) {
    return failure(
      env,
      base,
      'missing_executable',
      `${exe} is not installed; hardware enumeration unavailable`,
    )
  }
  const args = bus === 'pci' ? ['-nnk'] : []
  const run = await runGuarded(env, exe, args, signal)
  if (!run.ok) {
    return failure(env, base, run.errorClass, run.limitation)
  }
  const devices =
    bus === 'pci' ? parseLspci(run.text) : parseLsusb(run.text)
  return {
    ...base,
    observedAt: env.now(),
    status: 'ok',
    data: { bus, devices, count: devices.length },
    findings: [
      {
        code: `hardware.${bus}.count`,
        message: `${devices.length} ${bus.toUpperCase()} device(s) enumerated`,
        severity: 'info',
      },
    ],
    warnings: run.truncated ? [`${exe} output was truncated`] : [],
    errorClass: null,
    limitations: [],
  }
}

function parseLspci(text: string): PciDevice[] {
  const lines = text.split('\n')
  const devices: PciDevice[] = []
  for (const line of lines) {
    const m = line.match(/^([0-9a-f]{2}:[0-9a-f]{2}\.[0-9a-f])\s+(.+)$/i)
    if (!m) continue
    devices.push({
      slot: m[1],
      vendorDevice: '',
      className: '',
      description: m[2].trim(),
      driver: null,
    })
  }
  return devices
}

function parseLsusb(text: string): PciDevice[] {
  const devices: PciDevice[] = []
  for (const line of text.split('\n')) {
    const m = line.match(/^Bus (\d+) Device (\d+): ID (\S+)\s*(.*)$/)
    if (!m) continue
    devices.push({
      slot: `usb${m[1]}:${m[2]}`,
      vendorDevice: m[3],
      className: '',
      description: m[4].trim(),
      driver: null,
    })
  }
  return devices
}

export interface DriverBindingData {
  devicePath: string
  driver: string | null
}

/**
 * The driver currently bound to a sysfs device path. The caller supplies a
 * device *identifier* (e.g. `0000:00:1f.6`); it is validated and mapped to
 * `/sys/bus/pci/devices/<id>/driver`. The symlink target's basename is the
 * bound driver, or null when the device is unbound.
 */
export async function diagnoseDriverBinding(
  env: DiagnosticEnvironment,
  deviceId: string,
): Promise<DiagnosticResult<DriverBindingData>> {
  const source: EvidenceProvenance = { source: '/sys/bus', kind: 'sysfs' }
  const base: BaseFields = {
    id: 'driver.binding',
    domain: 'driver',
    subject: deviceId,
    source,
  }
  if (!isLinux(env)) {
    return unavailable(env, base, 'driver binding is a Linux-only diagnostic')
  }
  if (!isValidSubject(deviceId)) {
    return failure(
      env,
      base,
      'validation_failed',
      `refused a device id that is not a plain atom: ${JSON.stringify(deviceId)}`,
    )
  }
  const dir = `/sys/bus/pci/devices/${deviceId}`
  if (!env.exists(dir)) {
    return failure(
      env,
      base,
      'missing_source',
      `no sysfs device at ${dir} (wrong bus, or sysfs not mounted)`,
    )
  }
  const link = env.readLink(`${dir}/driver`)
  const driver = link ? link.replace(/\/+$/, '').split('/').pop() ?? null : null
  const findings: DiagnosticFinding[] = [
    driver
      ? {
          code: 'driver.bound',
          message: `device ${deviceId} is bound to ${driver}`,
          severity: 'info',
        }
      : {
          code: 'driver.unbound',
          message: `device ${deviceId} has no driver bound`,
          severity: 'warning',
        },
  ]
  return {
    ...base,
    observedAt: env.now(),
    status: 'ok',
    data: { devicePath: dir, driver },
    findings,
    warnings: [],
    errorClass: null,
    limitations: [],
  }
}

// ---------------------------------------------------------------------------
// Boot and services
// ---------------------------------------------------------------------------

export interface FailedUnit {
  unit: string
  loadState: string
  activeState: string
  subState: string
  description: string
}

export interface BootStateData {
  failedUnits: FailedUnit[]
  degraded: boolean
}

/**
 * Failed systemd units from `systemctl --failed`. A missing `systemctl` (no
 * systemd, e.g. a container) is `unavailable`, not "no failures".
 */
export async function diagnoseBootState(
  env: DiagnosticEnvironment,
  signal?: AbortSignal,
): Promise<DiagnosticResult<BootStateData>> {
  const source: EvidenceProvenance = {
    source: DIAGNOSTIC_EXECUTABLES.systemctl,
    kind: 'executable',
  }
  const base: BaseFields = {
    id: 'boot.state',
    domain: 'boot',
    subject: 'system',
    source,
  }
  if (!isLinux(env)) {
    return unavailable(env, base, 'boot state is a Linux-only diagnostic')
  }
  if (!env.exists(DIAGNOSTIC_EXECUTABLES.systemctl)) {
    return failure(
      env,
      base,
      'missing_executable',
      'systemctl is not present; systemd boot state unavailable',
    )
  }
  const run = await runGuarded(
    env,
    'systemctl',
    ['--failed', '--no-legend', '--no-pager', '--plain'],
    signal,
  )
  if (!run.ok) {
    return failure(env, base, run.errorClass, run.limitation)
  }
  if (systemdUnavailable(run.text)) {
    return unavailable(
      env,
      base,
      'systemctl is present but systemd is not the init system here (container/chroot); boot state unavailable',
    )
  }
  const failedUnits = parseSystemctlFailed(run.text)
  return {
    ...base,
    observedAt: env.now(),
    status: 'ok',
    data: { failedUnits, degraded: failedUnits.length > 0 },
    findings: failedUnits.length
      ? [
          {
            code: 'boot.failed_units',
            message: `${failedUnits.length} failed unit(s): ${failedUnits
              .map((u) => u.unit)
              .join(', ')}`,
            severity: 'error',
          },
        ]
      : [
          {
            code: 'boot.no_failed_units',
            message: 'no failed systemd units',
            severity: 'info',
          },
        ],
    warnings: run.truncated ? ['systemctl output was truncated'] : [],
    errorClass: null,
    limitations: [],
  }
}

function parseSystemctlFailed(text: string): FailedUnit[] {
  const units: FailedUnit[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const cols = trimmed.split(/\s+/)
    if (cols.length < 4) continue
    const [unit, loadState, activeState, subState, ...rest] = cols
    // A real row has a unit name (dot-suffixed), a known load state, and a
    // known active state. A prose line that happens to have four words is
    // rejected rather than turned into a unit.
    if (!/^[^\s]+\.(service|socket|timer|target|mount|device|path|slice|scope)$/.test(unit)) {
      continue
    }
    if (!SYSTEMD_LOAD_STATES.has(loadState)) continue
    if (!SYSTEMD_ACTIVE_STATES.has(activeState)) continue
    units.push({ unit, loadState, activeState, subState, description: rest.join(' ') })
  }
  return units
}

export interface ServiceStatusData {
  unit: string
  loadState: string
  activeState: string
  subState: string
  unitFileState: string | null
}

/**
 * Status for one systemd unit. The unit name is validated before use. A
 * non-zero exit from `systemctl show` for an unknown unit is reported as
 * `error`, not silently as an inactive service.
 */
export async function diagnoseServiceStatus(
  env: DiagnosticEnvironment,
  unit: string,
  signal?: AbortSignal,
): Promise<DiagnosticResult<ServiceStatusData>> {
  const source: EvidenceProvenance = {
    source: DIAGNOSTIC_EXECUTABLES.systemctl,
    kind: 'executable',
  }
  const base: BaseFields = {
    id: 'service.status',
    domain: 'service',
    subject: unit,
    source,
  }
  if (!isLinux(env)) {
    return unavailable(env, base, 'service status is a Linux-only diagnostic')
  }
  if (!isValidSubject(unit)) {
    return failure(
      env,
      base,
      'validation_failed',
      `refused a unit name that is not a plain atom: ${JSON.stringify(unit)}`,
    )
  }
  if (!env.exists(DIAGNOSTIC_EXECUTABLES.systemctl)) {
    return failure(
      env,
      base,
      'missing_executable',
      'systemctl is not present; systemd service status unavailable',
    )
  }
  const run = await runGuarded(
    env,
    'systemctl',
    [
      'show',
      unit,
      '--property=LoadState,ActiveState,SubState,UnitFileState',
      '--no-pager',
    ],
    signal,
  )
  if (!run.ok) {
    return failure(env, base, run.errorClass, run.limitation)
  }
  if (systemdUnavailable(run.text)) {
    return unavailable(
      env,
      base,
      'systemctl is present but systemd is not the init system here (container/chroot); service status unavailable',
    )
  }
  const props = parseProperties(run.text)
  if (!props.LoadState) {
    return failure(
      env,
      base,
      'malformed_output',
      `systemctl show returned no state for ${unit}`,
    )
  }
  if (props.LoadState === 'not-found') {
    return failure(env, base, 'missing_source', `unit ${unit} was not found`)
  }
  const data: ServiceStatusData = {
    unit,
    loadState: props.LoadState,
    activeState: props.ActiveState ?? 'unknown',
    subState: props.SubState ?? 'unknown',
    unitFileState: props.UnitFileState ?? null,
  }
  const severity: DiagnosticFinding['severity'] =
    data.activeState === 'failed'
      ? 'error'
      : data.activeState === 'active'
        ? 'info'
        : 'warning'
  return {
    ...base,
    observedAt: env.now(),
    status: 'ok',
    data,
    findings: [
      {
        code: `service.${data.activeState}`,
        message: `unit ${unit} is ${data.activeState} (${data.subState})`,
        severity,
      },
    ],
    warnings: run.truncated ? ['systemctl output was truncated'] : [],
    errorClass: null,
    limitations: [],
  }
}

function parseProperties(text: string): Record<string, string> {
  const props: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const idx = line.indexOf('=')
    if (idx <= 0) continue
    props[line.slice(0, idx)] = line.slice(idx + 1)
  }
  return props
}

export interface KernelLogData {
  lines: string[]
  truncated: boolean
  redacted: boolean
}

/**
 * Recent kernel-log lines from the journal. A missing `journalctl`, or a
 * journal that cannot be read without elevation, is reported as such. Output is
 * redacted before it is returned.
 */
export async function diagnoseKernelLog(
  env: DiagnosticEnvironment,
  options: { lines?: number; signal?: AbortSignal } = {},
): Promise<DiagnosticResult<KernelLogData>> {
  const source: EvidenceProvenance = {
    source: DIAGNOSTIC_EXECUTABLES.journalctl,
    kind: 'executable',
  }
  const base: BaseFields = {
    id: 'kernel.log',
    domain: 'kernel',
    subject: 'journal',
    source,
  }
  if (!isLinux(env)) {
    return unavailable(env, base, 'kernel log is a Linux-only diagnostic')
  }
  if (!env.exists(DIAGNOSTIC_EXECUTABLES.journalctl)) {
    return failure(
      env,
      base,
      'missing_executable',
      'journalctl is not present; kernel log unavailable',
    )
  }
  // Bound the requested line count; never pass an unbounded value.
  const requested =
    typeof options.lines === 'number' && Number.isFinite(options.lines)
      ? Math.min(Math.max(Math.floor(options.lines), 1), 2000)
      : 200
  const run = await runGuarded(
    env,
    'journalctl',
    ['-k', '-n', String(requested), '--no-pager', '-o', 'cat'],
    options.signal,
  )
  if (!run.ok) {
    return failure(env, base, run.errorClass, run.limitation)
  }
  const { text, records } = redactDiagnosticText(run.text)
  return {
    ...base,
    observedAt: env.now(),
    status: 'ok',
    data: {
      lines: text.split('\n').filter((l) => l.length > 0),
      truncated: run.truncated,
      redacted: records.length > 0,
    },
    findings: [
      {
        code: 'kernel.log.observed',
        message: `read recent kernel log (${requested} line budget)`,
        severity: 'info',
      },
    ],
    warnings: [
      ...(run.truncated ? ['kernel log output was truncated'] : []),
      ...(records.length > 0
        ? [`redacted credential-shaped content: ${records.map((r) => r.kind).join(', ')}`]
        : []),
    ],
    errorClass: null,
    limitations: [],
  }
}

// ---------------------------------------------------------------------------
// Packages
// ---------------------------------------------------------------------------

export interface PackageInfoData {
  manager: 'dpkg' | 'rpm'
  name: string
  version: string | null
  status: string | null
}

/**
 * Installed-package information. The package manager is detected from the
 * presence of its binary; the name is validated. When neither manager is
 * present, the result is `unavailable`.
 */
export async function diagnosePackageInfo(
  env: DiagnosticEnvironment,
  name: string,
  signal?: AbortSignal,
): Promise<DiagnosticResult<PackageInfoData>> {
  const source: EvidenceProvenance = { source: '/usr/bin', kind: 'derived' }
  const base: BaseFields = {
    id: 'package.info',
    domain: 'package',
    subject: name,
    source,
  }
  if (!isLinux(env)) {
    return unavailable(env, base, 'package info is a Linux-only diagnostic')
  }
  if (!isValidPackageName(name)) {
    return failure(
      env,
      base,
      'validation_failed',
      `refused a package name that is not a plain atom: ${JSON.stringify(name)}`,
    )
  }
  if (env.exists(DIAGNOSTIC_EXECUTABLES.dpkg)) {
    const run = await runGuarded(
      env,
      'dpkg',
      ['-W', '--showformat=${Version}\\t${Status}', name],
      signal,
    )
    if (!run.ok) return failure(env, base, run.errorClass, run.limitation)
    const [version, status] = run.text.trim().split('\t')
    if (!version && !status) {
      return failure(env, base, 'missing_source', `package ${name} is not installed`)
    }
    return {
      ...base,
      observedAt: env.now(),
      status: 'ok',
      data: { manager: 'dpkg', name, version: version ?? null, status: status ?? null },
      findings: [
        {
          code: 'package.installed',
          message: `${name} ${version ?? '(unknown version)'} — ${status ?? ''}`.trim(),
          severity: 'info',
        },
      ],
      warnings: [],
      errorClass: null,
      limitations: [],
    }
  }
  if (env.exists(DIAGNOSTIC_EXECUTABLES.rpm)) {
    const run = await runGuarded(
      env,
      'rpm',
      ['-q', '--qf', '%{VERSION}-%{RELEASE}', name],
      signal,
    )
    if (!run.ok) return failure(env, base, run.errorClass, run.limitation)
    if (/not installed/i.test(run.text)) {
      return failure(env, base, 'missing_source', `package ${name} is not installed`)
    }
    return {
      ...base,
      observedAt: env.now(),
      status: 'ok',
      data: { manager: 'rpm', name, version: run.text.trim() || null, status: null },
      findings: [
        {
          code: 'package.installed',
          message: `${name} ${run.text.trim()}`,
          severity: 'info',
        },
      ],
      warnings: [],
      errorClass: null,
      limitations: [],
    }
  }
  return unavailable(
    env,
    base,
    'no supported package manager (dpkg/rpm) found',
  )
}

// ---------------------------------------------------------------------------
// OS capability probe — what this host can actually be inspected for
// ---------------------------------------------------------------------------

/** One capability and whether this host provides it. */
export interface OsCapability {
  /** Stable id, e.g. `procfs`, `systemd`, `journal`, `pci`, `dpkg`. */
  id: string
  /** The diagnostics that require it. */
  enables: string[]
  available: boolean
  /** Why it is unavailable, when it is. */
  reason: string | null
}

export interface OsCapabilitiesData {
  platform: string
  arch: string
  capabilities: OsCapability[]
  /** Ids of the capabilities that are available. */
  available: string[]
}

/**
 * Probe which inspection capabilities this host has, without reading anything
 * large: does procfs exist, is systemd the init system, is an allowlisted
 * binary present. This is the machine-checkable form of the compatibility
 * matrix in `docs/directioner-os-cli-compatibility.md`, so a report can state
 * up front what it will and will not be able to say.
 *
 * It answers "can I look?" (a filesystem/binary presence check), not "what did
 * I see?" — so it is cheap and never elevates.
 */
export async function diagnoseOsCapabilities(
  env: DiagnosticEnvironment,
  signal?: AbortSignal,
): Promise<DiagnosticResult<OsCapabilitiesData>> {
  const source: EvidenceProvenance = { source: '/proc', kind: 'derived' }
  const base: BaseFields = {
    id: 'os.capabilities',
    domain: 'kernel',
    subject: 'host',
    source,
  }
  if (!isLinux(env)) {
    return unavailable(env, base, 'OS capability probing is Linux-only')
  }

  const cap = (
    id: string,
    enables: string[],
    available: boolean,
    reason: string | null,
  ): OsCapability => ({ id, enables, available, reason })

  const procModules = env.exists('/proc/modules')
  const sysBus = env.exists('/sys/bus/pci/devices')
  const hasSystemctl = env.exists(DIAGNOSTIC_EXECUTABLES.systemctl)
  const hasJournalctl = env.exists(DIAGNOSTIC_EXECUTABLES.journalctl)
  const hasLspci = env.exists(DIAGNOSTIC_EXECUTABLES.lspci)
  const hasLsusb = env.exists(DIAGNOSTIC_EXECUTABLES.lsusb)
  const hasModinfo = env.exists(DIAGNOSTIC_EXECUTABLES.modinfo)
  const hasDpkg = env.exists(DIAGNOSTIC_EXECUTABLES.dpkg)
  const hasRpm = env.exists(DIAGNOSTIC_EXECUTABLES.rpm)

  // systemd presence is only provable by asking systemctl; if it is present,
  // run the bounded capability check once.
  let systemdReachable = false
  let systemdReason: string | null = null
  if (hasSystemctl) {
    const probe = await runGuarded(
      env,
      'systemctl',
      ['is-system-running'],
      signal,
    )
    if (!probe.ok) {
      systemdReason = `systemctl present but not runnable: ${probe.limitation}`
    } else if (systemdUnavailable(probe.text)) {
      systemdReason = 'systemctl present but systemd is not the init system'
    } else {
      // `is-system-running` prints a single state word; `offline`/`unknown`
      // mean systemd is not actually reachable even though the binary ran.
      const state = probe.text.trim().split('\n')[0].trim().toLowerCase()
      if (SYSTEMD_REACHABLE_STATES.has(state)) {
        systemdReachable = true
      } else {
        systemdReason = `systemd reported '${state}', not a running init system`
      }
    }
  } else {
    systemdReason = 'systemctl is not installed'
  }

  const capabilities: OsCapability[] = [
    cap('procfs', ['kernel.modules'], procModules, procModules ? null : '/proc/modules not present'),
    cap('sysfs', ['driver.binding'], sysBus, sysBus ? null : '/sys/bus/pci/devices not present'),
    cap('systemd', ['boot.state', 'service.status'], systemdReachable, systemdReason),
    cap('journal', ['kernel.log'], hasJournalctl, hasJournalctl ? null : 'journalctl not installed'),
    cap('pci', ['hardware.pci'], hasLspci, hasLspci ? null : 'lspci not installed'),
    cap('usb', ['hardware.usb'], hasLsusb, hasLsusb ? null : 'lsusb not installed'),
    cap('modinfo', ['kernel.module.info'], hasModinfo, hasModinfo ? null : 'modinfo not installed'),
    cap('dpkg', ['package.info'], hasDpkg, hasDpkg ? null : 'dpkg-query not installed'),
    cap('rpm', ['package.info'], hasRpm, hasRpm ? null : 'rpm not installed'),
  ]
  const available = capabilities.filter((c) => c.available).map((c) => c.id)
  const missing = capabilities.filter((c) => !c.available)

  return {
    ...base,
    observedAt: env.now(),
    status: 'ok',
    data: {
      platform: env.platform,
      arch: env.arch,
      capabilities,
      available,
    },
    findings: [
      {
        code: 'os.capabilities.available',
        message: `${available.length}/${capabilities.length} inspection capabilities available: ${available.join(', ')}`,
        severity: missing.length === 0 ? 'info' : 'warning',
      },
    ],
    warnings: missing.map((c) => `${c.id}: ${c.reason}`),
    errorClass: null,
    limitations: missing.map((c) => `${c.id} unavailable: ${c.reason}`),
  }
}

// ---------------------------------------------------------------------------
// Guarded command runner
// ---------------------------------------------------------------------------

type GuardedRun =
  | { ok: true; text: string; truncated: boolean; status: number | null }
  | { ok: false; errorClass: DiagnosticErrorClass; limitation: string }

/**
 * Lines `systemctl` prints when it is present but cannot reach systemd (a
 * container without an init, a chroot, a down system bus). These are *prose*,
 * not unit rows; treating them as units invents failures, so they are detected
 * and reported as the capability gap they are.
 */
const SYSTEMCTL_NO_SYSTEMD = [
  /has not been booted with systemd/i,
  /Failed to connect to system scope bus/i,
  /System has not been booted/i,
  /Failed to connect to bus/i,
]

function systemdUnavailable(text: string): boolean {
  return SYSTEMCTL_NO_SYSTEMD.some((re) => re.test(text))
}

/** Load states `systemctl --plain` reports in column 2. */
const SYSTEMD_LOAD_STATES = new Set([
  'loaded',
  'not-found',
  'masked',
  'error',
  'bad-setting',
])
/** Active states reported in column 3. */
const SYSTEMD_ACTIVE_STATES = new Set([
  'active',
  'inactive',
  'failed',
  'activating',
  'deactivating',
  'reloading',
  'maintenance',
])

/**
 * Outputs of `systemctl is-system-running` that mean systemd is actually the
 * running init system. `offline` and `unknown` mean it is not reachable (a
 * container, a chroot, a down bus) even though the binary answered.
 */
const SYSTEMD_REACHABLE_STATES = new Set([
  'running',
  'degraded',
  'maintenance',
  'starting',
  'stopping',
  'reloading',
])

/**
 * Run an allowlisted executable with fixed args, mapping the environment's
 * {@link RunOutcome} onto a bounded text result plus an honest limitation
 * string. `name` must be an allowlist key; a lookup failure is a client bug
 * and is reported as `validation_failed` rather than silently skipped.
 */
async function runGuarded(
  env: DiagnosticEnvironment,
  name: DiagnosticExecutable,
  args: readonly string[],
  signal?: AbortSignal,
): Promise<GuardedRun> {
  if (!isAllowedExecutable(name)) {
    return {
      ok: false,
      errorClass: 'validation_failed',
      limitation: `refused a non-allowlisted executable: ${String(name)}`,
    }
  }
  // Belt and braces: validate every argument atom before it can reach a process.
  for (const arg of args) {
    if (typeof arg !== 'string' || /[\u0000-\u001f\u007f]/.test(arg)) {
      return {
        ok: false,
        errorClass: 'validation_failed',
        limitation: 'refused an argument containing a control character',
      }
    }
  }
  const outcome: RunOutcome = await env.run({
    executable: DIAGNOSTIC_EXECUTABLES[name],
    args,
    timeoutMs: DIAGNOSTIC_COMMAND_TIMEOUT_MS,
    signal,
    maxBytes: DIAGNOSTIC_COMMAND_MAX_BYTES,
  })
  if (!outcome.ok) {
    return {
      ok: false,
      errorClass: outcome.errorClass,
      limitation: describeRunFailure(name, outcome.errorClass),
    }
  }
  return {
    ok: true,
    text: `${outcome.stdout}${outcome.stderr ? `\n${outcome.stderr}` : ''}`,
    truncated: outcome.truncated,
    status: outcome.status,
  }
}

function describeRunFailure(
  name: DiagnosticExecutable,
  errorClass: DiagnosticErrorClass,
): string {
  switch (errorClass) {
    case 'missing_executable':
      return `${name} is not installed`
    case 'permission_denied':
      return `${name} could not be run without elevated privileges`
    case 'timeout':
      return `${name} exceeded its time budget`
    case 'cancelled':
      return `${name} was cancelled`
    default:
      return `${name} failed to run`
  }
}
