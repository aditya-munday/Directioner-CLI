#!/usr/bin/env bun

/**
 * CI guard: no Beyonders/Directioner product endpoints in a Directioner build.
 *
 * Scans source and an optionally-built binary for hostnames that must never be
 * contacted. Exits non-zero with a list of offenders, so a regression that
 * reintroduces a vendor call cannot pass CI.
 *
 * Usage:
 *   bun scripts/check-no-vendor-egress.ts            # scan source
 *   bun scripts/check-no-vendor-egress.ts cli/bin/directioner   # also scan binary
 *
 * Design notes:
 *  - Matches full hostnames bounded by non-hostname characters. An early naive
 *    pass matched thousands of minified fragments (`A.dev`, `H.com`); anchoring
 *    on the full domain avoids that noise.
 *  - Attribution files are exempt: the license and NOTICE keep the original
 *    project's name on purpose, and a legal requirement is not egress.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, extname } from 'path'

/**
 * Third-party egress endpoints. A request to any of these is data leaving the
 * user's machine for advertising, billing or an integration broker — none of
 * which Directioner does. A single reference is a hard failure.
 *
 * These are all avoidable in source, so zero is achievable and enforced.
 */
const FORBIDDEN_HOSTS = [
  'api.stripe.com',
  'stripe.com',
  'zeroclick.dev',
  'backend.zeroclick.dev',
  'api.composio.dev',
  'composio.dev',
]

/**
 * Counted debt: hosts that remain referenced but are unreachable in a
 * Directioner build.
 *
 *  - The original web hosts (`beyonders.com`, `directioner.com`) survive as
 *    user-facing URL text and release-download constants in disabled
 *    subsystems.
 *  - PostHog hosts appear because `posthog-node` is still bundled (its module
 *    defines these constants), even though Directioner installs a no-op
 *    analytics client and never constructs a PostHog client.
 *
 * Reported as a count, not a failure, because the count is the honest measure
 * of remaining rebrand work. `--strict` promotes them to failures, for use
 * once they reach zero.
 */
const TRACKED_HOSTS = [
  'beyonders.com',
  'directioner.com',
  'posthog.com',
  'us.i.posthog.com',
  'eu.i.posthog.com',
  'app.posthog.com',
]

/** Files allowed to mention the original project (legal attribution). */
const EXEMPT_FILES = [
  'LICENSE',
  'NOTICE',
  'ATTRIBUTION.md',
  'docs/audit/',
  'scripts/check-no-vendor-egress.ts',
]

const SCAN_ROOTS = ['cli/src', 'sdk/src', 'common/src', 'packages', 'directioner']
const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.json'])

function isExempt(path: string): boolean {
  return EXEMPT_FILES.some((exempt) => path.includes(exempt))
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git') continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

/**
 * Match a hostname as a whole domain, including any subdomain labels, but not
 * as a substring of another domain.
 *
 * The leading `(^|[^A-Za-z0-9-])` rejects `xstripe.com`, while the repeated
 * label group accepts `billing.stripe.com`. Requiring a delimiter after the
 * domain rejects `stripe.company` and — importantly — keeps minified
 * fragments such as `A.dev` from matching, which a naive substring scan does
 * thousands of times.
 */
function hostPattern(host: string): RegExp {
  const escaped = host.replace(/\./g, '\\.')
  return new RegExp(
    `(^|[^A-Za-z0-9-])([A-Za-z0-9-]+\\.)*${escaped}([:/'"?\\s)\\]},;]|$)`,
    'g',
  )
}

type Hit = { file: string; host: string; line: number; text: string }

function scanText(path: string, text: string, hosts: string[]): Hit[] {
  const hits: Hit[] = []
  const lines = text.split('\n')
  for (const host of hosts) {
    const re = hostPattern(host)
    for (let i = 0; i < lines.length; i++) {
      re.lastIndex = 0
      if (re.test(lines[i]!)) {
        hits.push({ file: path, host, line: i + 1, text: lines[i]!.trim().slice(0, 120) })
      }
    }
  }
  return hits
}

const args = process.argv.slice(2)
const strict = args.includes('--strict')
const binaryPath = args.find((a) => !a.startsWith('--'))
const egressHits: Hit[] = []
const legacyHits: Hit[] = []

for (const root of SCAN_ROOTS) {
  for (const file of walk(root)) {
    if (isExempt(file)) continue
    if (!SCAN_EXTENSIONS.has(extname(file))) continue
    const text = readFileSync(file, 'utf8')
    egressHits.push(...scanText(file, text, FORBIDDEN_HOSTS))
    legacyHits.push(...scanText(file, text, TRACKED_HOSTS))
  }
}

if (binaryPath) {
  if (!existsSync(binaryPath)) {
    console.error(`Binary not found: ${binaryPath}`)
    process.exit(2)
  }
  // The binary is large; a latin1 read keeps line numbers usable without
  // decoding the embedded UTF-8 incorrectly.
  const text = readFileSync(binaryPath, 'latin1')
  egressHits.push(...scanText(binaryPath, text, FORBIDDEN_HOSTS))
  legacyHits.push(...scanText(binaryPath, text, TRACKED_HOSTS))
}

if (legacyHits.length > 0) {
  const byHost = new Map<string, number>()
  for (const hit of legacyHits) {
    byHost.set(hit.host, (byHost.get(hit.host) ?? 0) + 1)
  }
  const summary = [...byHost.entries()]
    .map(([host, count]) => `${host}=${count}`)
    .join(' ')
  const label = strict ? '✗ (strict)' : '⚠ tracked debt'
  console.log(`${label}: tracked unreachable hosts still present: ${summary}`)
  if (strict) {
    for (const hit of legacyHits) {
      console.log(`  ${hit.file}:${hit.line}  [${hit.host}]  ${hit.text}`)
    }
  }
}

if (egressHits.length > 0) {
  console.error(`\n✗ Found ${egressHits.length} forbidden egress reference(s):\n`)
  for (const hit of egressHits) {
    console.error(`  ${hit.file}:${hit.line}  [${hit.host}]`)
    console.error(`      ${hit.text}`)
  }
  console.error(
    '\nDirectioner must not contact these hosts (ads, billing, analytics). Remove the reference or disable the code path that reaches it.',
  )
  process.exit(1)
}

if (strict && legacyHits.length > 0) process.exit(1)

console.log(
  `✓ No forbidden egress hostnames in source${binaryPath ? ' or binary' : ''}.`,
)
