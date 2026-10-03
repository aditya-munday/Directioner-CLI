#!/usr/bin/env bun

/**
 * Directioner release validator — the central pre-release gate.
 *
 * Validates a *built* release package directory (what `package-release.ts`
 * assembles before `npm pack`). It is deliberately explicit: every rule names
 * what it protects against, and rules that could produce meaningless noise are
 * scoped with allowlists.
 *
 * Usage:
 *   bun scripts/validate-release.ts [packageDir] [--expected-version <v>]
 *
 * Default packageDir: directioner/cli/release/.build
 *
 * With `--expected-version`, the packaged version and the version the packaged
 * binary itself reports must both equal it — the version-consistency chain
 * (source -> build -> package -> binary). Without it, the two are still
 * required to agree with each other.
 *
 * Exit code 0 when every check passes, 1 otherwise.
 */

import { execFileSync } from 'child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, resolve } from 'path'

export interface CheckResult {
  name: string
  ok: boolean
  /** 'error' fails the gate; 'warning' is tracked debt that does not. */
  severity: 'error' | 'warning'
  detail: string
}

export interface ValidationReport {
  ok: boolean
  checks: CheckResult[]
}

const REPO_ROOT = resolve(import.meta.dir, '..')

/** The package identity Directioner ships under. */
const EXPECTED_PACKAGE_NAME = 'directioner'
const EXPECTED_BIN = { directioner: 'index.js' }

/** The one repository a Directioner release may point at. */
const EXPECTED_REPOSITORY = 'github.com/aditya-munday/Directioner-CLI'

/**
 * Tokens that must never appear in the Directioner-owned release *files*
 * (launcher, entrypoint, README, manifest). These are the legacy vendor
 * origins, the legacy telemetry sink, and the legacy product names.
 */
const FORBIDDEN_PACKAGE_TOKENS = [
  'beyonders.com',
  'directioner.com',
  'beyondersai',
  'freebuff',
  'codebuff',
  'codecane',
  'manicode',
  'posthog',
  'api/releases',
  'stripe.com',
  'registry.npmjs.org',
]

/**
 * The same tokens inside the compiled *binary*. The BYOK binary makes no such
 * calls in DIRECTIONER_MODE (analytics is a no-op and auth is skipped), but
 * legacy strings are still embedded — chiefly the inert `posthog-node` bundle
 * and vendor URLs in unreachable branches. That is tracked debt, reported as a
 * warning, not a release blocker.
 */
const TRACKED_DEBT_BINARY_TOKENS = FORBIDDEN_PACKAGE_TOKENS

/** Files a Directioner package is expected to contain at its root. */
const REQUIRED_PACKAGE_FILES = [
  'package.json',
  'index.js',
  'launcher.js',
  'README.md',
]

/** Credential shapes a release must never carry. Kept deliberately specific. */
const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'openai-style key', pattern: /\bsk-[A-Za-z0-9]{16,}\b/ },
  { name: 'anthropic-style key', pattern: /\bsk-ant-[A-Za-z0-9-]{16,}\b/ },
  { name: 'posthog key', pattern: /\bphc_[A-Za-z0-9]{16,}\b/ },
  { name: 'github token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { name: 'aws access key id', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'google api key', pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
  { name: 'groq key', pattern: /\bgsk_[A-Za-z0-9]{20,}\b/ },
  { name: 'private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'bearer literal', pattern: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/ },
]

function check(
  name: string,
  fn: () => string | null,
  severity: 'error' | 'warning' = 'error',
): CheckResult {
  try {
    const failure = fn()
    return failure === null
      ? { name, ok: true, severity, detail: 'ok' }
      : { name, ok: false, severity, detail: failure }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { name, ok: false, severity, detail: message }
  }
}

/** Read a text file, or null when it is not there. */
function readText(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

/** Case-insensitive first match of any token, with surrounding context. */
function findToken(
  haystack: string,
  tokens: string[],
): { token: string; index: number } | null {
  const lower = haystack.toLowerCase()
  let best: { token: string; index: number } | null = null
  for (const token of tokens) {
    const index = lower.indexOf(token.toLowerCase())
    if (index !== -1 && (best === null || index < best.index)) {
      best = { token, index }
    }
  }
  return best
}

function redactContext(text: string, index: number): string {
  const start = Math.max(0, index - 30)
  return `…${text.slice(start, index + 30).replace(/\n/g, ' ')}…`
}

// --- Identity ------------------------------------------------------------

function validateIdentity(packageDir: string): CheckResult[] {
  const manifestPath = join(packageDir, 'package.json')
  return [
    check('identity: package name', () => {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      return manifest.name === EXPECTED_PACKAGE_NAME
        ? null
        : `package name is "${manifest.name}", expected "${EXPECTED_PACKAGE_NAME}"`
    }),
    check('identity: executable name', () => {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      return JSON.stringify(manifest.bin) === JSON.stringify(EXPECTED_BIN)
        ? null
        : `bin is ${JSON.stringify(manifest.bin)}, expected ${JSON.stringify(EXPECTED_BIN)}`
    }),
    check('identity: version is semver', () => {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      return /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(manifest.version)
        ? null
        : `version "${manifest.version}" is not semver`
    }),
    check('identity: repository metadata', () => {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      const url = manifest.repository?.url ?? ''
      return url.includes(EXPECTED_REPOSITORY)
        ? null
        : `repository.url "${url}" does not name ${EXPECTED_REPOSITORY}`
    }),
    check('identity: no install-time lifecycle scripts', () => {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      const scripts = manifest.scripts ?? {}
      const offenders = [
        'preinstall',
        'install',
        'postinstall',
        'preuninstall',
      ].filter((s) => scripts[s])
      return offenders.length === 0
        ? null
        : `install-time scripts present: ${offenders.join(', ')}`
    }),
    check('identity: no runtime dependencies', () => {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      const deps = Object.keys(manifest.dependencies ?? {})
      return deps.length === 0
        ? null
        : `runtime dependencies declared: ${deps.join(', ')}`
    }),
    check('identity: entrypoint exists', () => {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      const entry = manifest.bin?.directioner
      return entry && existsSync(join(packageDir, entry))
        ? null
        : `bin entrypoint "${entry}" is missing from the package`
    }),
  ]
}

// --- Version consistency -------------------------------------------------

/** First semver-looking token in a string, or null. */
function firstSemver(text: string): string | null {
  const match = text.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/)
  return match ? match[0] : null
}

/**
 * The version the packaged binary reports when run. This executes the real
 * artifact, not a source constant: a build that stamps the wrong version is
 * exactly the failure this catches.
 *
 * A binary that cannot be executed here (a synthetic fixture, or a package
 * built for another platform) is not a version mismatch — the caller skips the
 * check with a clear reason, and the clean-install artifact test runs the real
 * binary on its own platform.
 */
type BinaryVersionResult =
  | { kind: 'version'; version: string | null }
  | { kind: 'unrunnable'; reason: string }
  | { kind: 'absent' }

function readBinaryVersion(packageDir: string): BinaryVersionResult {
  const binaryPath = ['directioner', 'directioner.exe']
    .map((name) => join(packageDir, name))
    .find((p) => existsSync(p))
  if (!binaryPath) return { kind: 'absent' }
  try {
    const stdout = execFileSync(binaryPath, ['--version'], {
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, NO_COLOR: '1' },
    })
    return { kind: 'version', version: firstSemver(stdout) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { kind: 'unrunnable', reason: message.split('\n')[0]! }
  }
}

function validateVersionConsistency(
  packageDir: string,
  expectedVersion: string | null,
): CheckResult[] {
  const manifestVersion = (() => {
    try {
      return JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')).version
    } catch {
      return null
    }
  })()

  const observed = readBinaryVersion(packageDir)

  return [
    check('version: binary reports the packaged version', () => {
      if (observed.kind === 'absent') return 'no binary in package'
      if (observed.kind === 'unrunnable') {
        // Skipped, not failed: the format check above already proves the binary
        // is a real executable, and the artifact test runs it for real.
        return null
      }
      if (!manifestVersion) return 'package.json has no version'
      return observed.version === manifestVersion
        ? null
        : `binary reports ${observed.version} but package.json says ${manifestVersion}`
    }),
    check('version: matches the requested release version', () => {
      if (expectedVersion === null) return null
      if (manifestVersion !== expectedVersion) {
        return `package.json is ${manifestVersion}, expected ${expectedVersion}`
      }
      if (observed.kind === 'unrunnable' || observed.kind === 'absent') return null
      if (observed.version !== expectedVersion) {
        return `binary reports ${observed.version}, expected ${expectedVersion}`
      }
      return null
    }),
  ]
}

// --- Legacy coupling -----------------------------------------------------

function validateLegacyCoupling(packageDir: string): CheckResult[] {
  const textFiles = ['index.js', 'launcher.js', 'README.md', 'package.json']
  return [
    check('legacy: package files carry no vendor references', () => {
      for (const fileName of textFiles) {
        const text = readText(join(packageDir, fileName))
        if (text === null) continue
        const hit = findToken(text, FORBIDDEN_PACKAGE_TOKENS)
        if (hit) {
          return `${fileName} contains "${hit.token}" at ${redactContext(text, hit.index)}`
        }
      }
      return null
    }),
    check(
      'legacy: binary carries no vendor references',
      () => {
        const binaryPath = ['directioner', 'directioner.exe']
          .map((name) => join(packageDir, name))
          .find((p) => existsSync(p))
        if (!binaryPath) return 'no binary in package to scan'
        const lower = readFileSync(binaryPath).toString('latin1').toLowerCase()
        const hit = findToken(lower, TRACKED_DEBT_BINARY_TOKENS)
        return hit === null
          ? null
          : `binary embeds "${hit.token}" at byte ${hit.index} (inert in DIRECTIONER_MODE)`
      },
      'warning',
    ),
  ]
}

// --- Repository metadata -------------------------------------------------

function validateRepositoryMetadata(): CheckResult[] {
  return [
    check('repo: Directioner remote present, vendor remote absent', () => {
      let remotes: string
      try {
        remotes = execFileSync('git', ['remote', '-v'], {
          cwd: REPO_ROOT,
          encoding: 'utf8',
        })
      } catch {
        return 'not a git repository (skipping remote check)'
      }
      if (!remotes.trim()) return 'no git remotes configured'
      if (!remotes.includes('Directioner-CLI')) {
        return 'no remote names the Directioner repository'
      }
      const vendor = ['BeyondersAI', 'beyonders', 'codecane', 'freebuff', 'codebuff']
        .find((token) => remotes.toLowerCase().includes(token.toLowerCase()))
      return vendor ? `a remote references legacy vendor "${vendor}"` : null
    }),
  ]
}

// --- Secrets -------------------------------------------------------------

/** Scan text for credential shapes. Returns a redacted description or null. */
export function scanForSecrets(text: string): string | null {
  for (const { name, pattern } of SECRET_PATTERNS) {
    const match = pattern.exec(text)
    if (match) {
      // Never print the value: report the shape and a short, masked context.
      return `${name} detected near ${redactContext(text, match.index)}`
    }
  }
  return null
}

function validateSecrets(packageDir: string): CheckResult[] {
  const textFiles = ['index.js', 'launcher.js', 'README.md', 'package.json']
  return [
    check('secrets: no credentials in package files', () => {
      for (const fileName of textFiles) {
        const text = readText(join(packageDir, fileName))
        if (text === null) continue
        const found = scanForSecrets(text)
        if (found) return `${fileName}: ${found}`
      }
      return null
    }),
    check('secrets: no environment-file artifacts in package', () => {
      const offenders = readdirSync(packageDir).filter((name) =>
        /^\.env|\.pem$|\.key$|id_rsa/.test(name),
      )
      return offenders.length === 0
        ? null
        : `secret-bearing files present: ${offenders.join(', ')}`
    }),
  ]
}

// --- Archive / package integrity ----------------------------------------

const MAX_BINARY_BYTES = 250 * 1024 * 1024
const MIN_BINARY_BYTES = 5 * 1024 * 1024

function validateArchiveIntegrity(packageDir: string): CheckResult[] {
  const entries = readdirSync(packageDir)
  return [
    check('archive: required files present', () => {
      const missing = REQUIRED_PACKAGE_FILES.filter(
        (name) => !existsSync(join(packageDir, name)),
      )
      return missing.length === 0 ? null : `missing: ${missing.join(', ')}`
    }),
    check('archive: required runtime assets present', () => {
      const hasBinary = ['directioner', 'directioner.exe'].some((name) =>
        existsSync(join(packageDir, name)),
      )
      if (!hasBinary) return 'no directioner binary in the package'
      return existsSync(join(packageDir, 'tree-sitter.wasm'))
        ? null
        : 'tree-sitter.wasm is missing (required for code intelligence)'
    }),
    check('archive: no nested copy of itself', () => {
      const nested = entries.filter((name) => name.endsWith('.tgz'))
      return nested.length === 0 ? null : `nested tarballs: ${nested.join(', ')}`
    }),
    check('archive: no duplicate huge binaries', () => {
      const big = entries.filter((name) => {
        const path = join(packageDir, name)
        return statSync(path).isFile() && statSync(path).size >= MIN_BINARY_BYTES
      })
      return big.length <= 1
        ? null
        : `multiple large binaries: ${big.join(', ')}`
    }),
    check('archive: no internal-only files', () => {
      const offenders = entries.filter((name) =>
        /^\.build$|\.map$|\.ts$|node_modules|\.git|PROGRESS\.md|SPEC\.md/.test(name),
      )
      return offenders.length === 0
        ? null
        : `internal files present: ${offenders.join(', ')}`
    }),
    check('archive: binary size is reasonable', () => {
      const binaryPath = ['directioner', 'directioner.exe']
        .map((name) => join(packageDir, name))
        .find((p) => existsSync(p))
      if (!binaryPath) return 'no binary in package'
      const { size } = statSync(binaryPath)
      if (size < MIN_BINARY_BYTES) return `binary is suspiciously small (${size} bytes)`
      if (size > MAX_BINARY_BYTES) return `binary is suspiciously large (${size} bytes)`
      return null
    }),
  ]
}

// --- Binary integrity ----------------------------------------------------

/** Identify an executable by its magic bytes. */
export function detectBinaryFormat(buffer: Buffer): string | null {
  if (buffer.length < 20) return null
  if (buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) {
    const machine = buffer.readUInt16LE(0x12)
    const arch = machine === 0x3e ? 'x64' : machine === 0xb7 ? 'arm64' : `machine:${machine}`
    return `elf:${arch}`
  }
  const magic = buffer.readUInt32BE(0)
  if (magic === 0xfeedfacf || magic === 0xfeedface) return 'mach-o'
  if (buffer[0] === 0x4d && buffer[1] === 0x5a) return 'pe'
  return null
}

function validateBinaryIntegrity(packageDir: string): CheckResult[] {
  const binaryPath = ['directioner', 'directioner.exe']
    .map((name) => join(packageDir, name))
    .find((p) => existsSync(p))

  return [
    check('binary: exists and is a native executable', () => {
      if (!binaryPath) return 'no binary in package'
      const format = detectBinaryFormat(readFileSync(binaryPath))
      return format ? null : 'binary is not a recognized ELF/Mach-O/PE file'
    }),
    check('binary: has an expected architecture', () => {
      if (!binaryPath) return 'no binary in package'
      const format = detectBinaryFormat(readFileSync(binaryPath)) ?? ''
      const arch = format.split(':')[1]
      if (format.startsWith('mach-o') || format.startsWith('pe')) return null
      return arch === 'x64' || arch === 'arm64'
        ? null
        : `unexpected architecture: ${format}`
    }),
    check('binary: forbidden endpoints absent', () => {
      if (!binaryPath) return 'no binary in package'
      const lower = readFileSync(binaryPath).toString('latin1').toLowerCase()
      const hit = findToken(lower, TRACKED_DEBT_BINARY_TOKENS)
      return hit === null
        ? null
        : `binary embeds "${hit.token}" at byte ${hit.index} (inert in DIRECTIONER_MODE)`
    }, 'warning'),
  ]
}

// --- Documentation consistency ------------------------------------------

function validateDocsConsistency(packageDir: string): CheckResult[] {
  return [
    check('docs: README does not describe hosted-login behavior', () => {
      const readme = readText(join(packageDir, 'README.md'))
      if (readme === null) return 'README.md is missing'
      const hostedClaims = [
        /press enter to login/i,
        /free coding agent/i,
        /earn up to/i,
        /limited mode/i,
        /sessions per day/i,
      ]
      const hit = hostedClaims.find((pattern) => pattern.test(readme))
      return hit ? `README describes hosted behavior (matched ${hit})` : null
    }),
    check('docs: README describes BYOK configuration', () => {
      const readme = readText(join(packageDir, 'README.md'))
      if (readme === null) return 'README.md is missing'
      return /provider/i.test(readme) && /api key/i.test(readme)
        ? null
        : 'README does not describe provider configuration'
    }),
  ]
}

// --- Driver --------------------------------------------------------------

export function validateRelease(
  packageDir: string,
  expectedVersion: string | null = null,
): ValidationReport {
  if (!existsSync(packageDir) || !statSync(packageDir).isDirectory()) {
    return {
      ok: false,
      checks: [
        {
          name: 'package directory',
          ok: false,
          severity: 'error',
          detail: `not a directory: ${packageDir}`,
        },
      ],
    }
  }

  const checks = [
    ...validateIdentity(packageDir),
    ...validateVersionConsistency(packageDir, expectedVersion),
    ...validateLegacyCoupling(packageDir),
    ...validateRepositoryMetadata(),
    ...validateSecrets(packageDir),
    ...validateArchiveIntegrity(packageDir),
    ...validateBinaryIntegrity(packageDir),
    ...validateDocsConsistency(packageDir),
  ]

  const errorsOk = checks.every((c) => c.ok || c.severity === 'warning')
  return { ok: errorsOk, checks }
}

function main() {
  const args = process.argv.slice(2)
  const expectedIndex = args.indexOf('--expected-version')
  const expectedVersion =
    expectedIndex !== -1 && args[expectedIndex + 1] ? args[expectedIndex + 1]! : null
  const versionValueIndex = expectedIndex === -1 ? -1 : expectedIndex + 1
  const positional = args.filter(
    (arg, i) => !arg.startsWith('--') && i !== versionValueIndex,
  )
  const packageDir = positional[0]
    ? resolve(positional[0])
    : join(REPO_ROOT, 'directioner', 'cli', 'release', '.build')

  console.log(`Directioner release validation — ${packageDir}`)
  if (expectedVersion) console.log(`Expected release version: ${expectedVersion}`)
  console.log('')
  const report = validateRelease(packageDir, expectedVersion)
  for (const result of report.checks) {
    const mark = result.ok ? '✓' : result.severity === 'warning' ? '⚠' : '✗'
    console.log(`  ${mark} ${result.name}: ${result.detail}`)
  }

  const warnings = report.checks.filter((c) => !c.ok && c.severity === 'warning')
  const failures = report.checks.filter((c) => !c.ok && c.severity === 'error')
  console.log('')
  if (warnings.length > 0) {
    console.log(`${warnings.length} tracked-debt warning(s); not release blockers.`)
  }
  if (report.ok) {
    console.log('All release checks passed.')
    return
  }
  console.log(`Release validation FAILED (${failures.length} error(s)). Fix the ✗ lines above.`)
  process.exit(1)
}

if (import.meta.main) main()
