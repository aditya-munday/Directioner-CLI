/**
 * Redaction for diagnostic output.
 *
 * Kernel and service logs can carry credentials by accident: a unit file with
 * `Environment=API_TOKEN=...`, an auth line, a connection string. Diagnostics
 * exist to be shown to a model and a user, so anything credential-shaped is
 * scrubbed before it leaves this module.
 *
 * This is deliberately conservative (it may over-redact) because the failure
 * mode we must avoid is a leaked secret, not a withheld log line. It reports
 * *what class* it redacted, never the value, so the result stays honest about
 * having removed something.
 *
 * This is a pattern scrubber, not a proof of secrecy. It complements — it does
 * not replace — running diagnostics with a scrubbed environment (see
 * `sdk/src/tools/terminal-env-policy.ts`); a diagnostic never receives a
 * credential in the first place.
 */

/** A redaction event, recorded so the caller knows output was altered. */
export interface RedactionRecord {
  /** The class that matched, e.g. `private_key`, `bearer_token`. */
  kind: string
  /** How many occurrences were replaced. */
  count: number
}

export interface RedactionOutcome {
  text: string
  records: RedactionRecord[]
}

export const REDACTED = '[redacted]'

interface Rule {
  kind: string
  pattern: RegExp
  /** Replacement, given the whole match. `$` capture refs are honoured. */
  replacement: string
}

/**
 * Ordered rules. Private keys first (a whole PEM block), then high-signal
 * token shapes, then assignments by credential-like key name. Order matters:
 * a PEM block contains `-----BEGIN`, which the assignment rule would otherwise
 * only partially touch.
 */
const RULES: readonly Rule[] = [
  {
    kind: 'private_key',
    pattern:
      /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g,
    replacement: `-----BEGIN PRIVATE KEY-----${REDACTED}-----END PRIVATE KEY-----`,
  },
  // GitHub, GitLab, Slack, AWS, Google, OpenAI-style, and generic sk- tokens.
  {
    kind: 'provider_token',
    pattern:
      /\b(?:gh[posru]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|sk-[A-Za-z0-9]{20,})\b/g,
    replacement: REDACTED,
  },
  {
    kind: 'bearer_token',
    pattern: /\b([Bb]earer\s+)[A-Za-z0-9._~+/-]{16,}=*/g,
    replacement: `$1${REDACTED}`,
  },
  {
    kind: 'url_userinfo',
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/)[^/@\s:]+:[^/@\s]+@/gi,
    replacement: `$1${REDACTED}@`,
  },
  {
    kind: 'secret_assignment',
    // `KEY=value`, `KEY: value`, `"key": "value"` where the key names a secret.
    pattern:
      /\b([A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE|CREDENTIAL)[A-Za-z0-9_]*)(\s*[=:]\s*)("?)([^\s"'`]{4,})\3/g,
    replacement: `$1$2$3${REDACTED}$3`,
  },
  {
    kind: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replacement: REDACTED,
  },
]

/**
 * Redact credential-shaped substrings from `text`, returning the cleaned text
 * and a record of which classes matched. The same text in yields the same text
 * out (deterministic), so results are reproducible.
 */
export function redactDiagnosticText(text: string): RedactionOutcome {
  let out = text
  const records: RedactionRecord[] = []
  for (const rule of RULES) {
    let count = 0
    out = out.replace(rule.pattern, (...args) => {
      count += 1
      // The last arg is the full match when named groups are absent; simpler to
      // re-derive by applying the replacement template ourselves.
      const match = args[0] as string
      return applyTemplate(rule.replacement, match, args)
    })
    if (count > 0) records.push({ kind: rule.kind, count })
  }
  return { text: out, records }
}

/** Apply `$n` capture references in a replacement template. */
function applyTemplate(
  template: string,
  _match: string,
  args: unknown[],
): string {
  const groups = args.slice(0, -2) as (string | undefined)[]
  return template.replace(/\$(\d)/g, (_, d: string) => {
    const idx = Number(d)
    return groups[idx] ?? ''
  })
}
