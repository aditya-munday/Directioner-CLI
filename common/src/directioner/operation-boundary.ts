/**
 * The privileged-operation boundary — the client half of the Directioner-OS
 * capability contract.
 *
 * WHY THIS EXISTS
 *
 * Diagnostics are read-only and safe to run on request. Remediation is not:
 * restarting a failed unit, reloading a kernel module, or changing a kernel
 * parameter are privileged operations with real consequences. On
 * Directioner-OS these operations are authorized by the OS's own capability
 * broker (working name: `ai-capabilityd`); the CLI is a *client* of that
 * broker, never the authority. This module is the typed, testable client
 * boundary and the local enforcement of it. The broker itself is not written;
 * nothing here pretends otherwise.
 *
 * THE ONE RULE
 *
 * Text is never authority. A model, a repository file, an MCP server, or a
 * tool result can *ask* for an operation. None of them can authorize one. An
 * operation runs only when it carries an {@link OperationApproval} — an object
 * issued elsewhere and bound to *this exact* operation — supplied together
 * with an explicit, human-readable consent decision. A string that looks like
 * a token is not a token; a boolean `approved: true` from a tool result is not
 * consent.
 *
 * WHY THE BINDING
 *
 * An approval binds to the operation's canonical fingerprint: the process, the
 * action verb, and the exact validated arguments. An approval for "restart
 * nginx" therefore cannot authorize "restart sshd" or "disable nginx". This is
 * what stops a confused-deputy: a genuine approval the user granted for one
 * thing cannot be replayed for another.
 *
 * HONESTY ABOUT VERIFICATION
 *
 * This module never claims a remediation worked. It returns
 * `verificationRequired` with the machine-checkable probes that would confirm
 * it; a caller re-runs the relevant diagnostics and compares. "Ran" is not
 * "fixed", and the types keep those apart.
 */

import type { DiagnosticDomain, DiagnosticResult } from './diagnostics'

// ---------------------------------------------------------------------------
// Operation model
// ---------------------------------------------------------------------------

/** The invoked process, always an allowlisted absolute path (never a string). */
export type OperationProgram =
  | '/usr/bin/systemctl'
  | '/usr/sbin/modprobe'
  | '/usr/sbin/rmmod'
  | '/usr/bin/sysctl'

/** The fixed action verbs the OS capability broker recognizes. */
export type OperationAction =
  | 'service.restart'
  | 'service.start'
  | 'service.stop'
  | 'module.load'
  | 'module.unload'
  | 'kernel.parameter.set'

export interface OperationRequest {
  /** A stable id supplied by the authorization system; opaque to the client. */
  operationId: string
  /** The task this belongs to, so an operation is always attributed. */
  taskId: string
  program: OperationProgram
  action: OperationAction
  /**
   * Validated argument atoms, in the order the program expects. Every element
   * is a plain atom; the boundary refuses anything else. Never shell text.
   */
  args: string[]
  /** The subsystem the operation affects, for risk display and auditing. */
  domain: DiagnosticDomain
  /** What the approval must cover, e.g. `service:nginx.service`. */
  scope: string
}

/**
 * An approval object. It is not a string and not a boolean: replaying,
 * guessing, or fabricating one is a type error, and at runtime the boundary
 * checks it binds to the same operation fingerprint.
 */
export interface OperationApproval {
  approvalId: string
  operationId: string
  /** The canonical fingerprint of the exact operation this approval covers. */
  fingerprint: string
  scope: string
  /** ISO-8601. An approval past this instant is refused. */
  expiresAt: string
  /** Who granted it. Only a human or policy may appear here. */
  grantedBy: 'user' | 'policy'
}

/** The user's explicit decision, supplied separately from the approval object. */
export interface ConsentDecision {
  decision: 'granted' | 'denied'
  /** Who made it. A tool result cannot be `user`. */
  source: 'user' | 'policy' | 'timeout'
}

/** A remediation probe: a diagnostic to re-run to confirm the effect. */
export interface VerificationProbe {
  /** The diagnostic id to re-run (matches `DiagnosticResult.id`). */
  diagnosticId: string
  /** What a successful change looks like, as data, not prose. */
  expectation: string
}

export type OperationOutcome =
  | {
      status: 'completed'
      operationId: string
      /** The effect is not proven; run these and compare. Never claim success. */
      verificationRequired: VerificationProbe[]
    }
  | { status: 'denied'; operationId: string; reason: OperationDenialReason }
  | { status: 'failed'; operationId: string; errorClass: OperationErrorClass }
  | { status: 'unsupported'; operationId: string; reason: string }

export type OperationDenialReason =
  | 'no_approval'
  | 'approval_fingerprint_mismatch'
  | 'approval_scope_mismatch'
  | 'approval_expired'
  | 'consent_denied'
  | 'consent_not_from_user'
  | 'invalid_operation'
  | 'program_not_allowed'
  | 'action_not_allowed'

export type OperationErrorClass =
  | 'executor_failed'
  | 'timeout'
  | 'cancelled'
  | 'verification_unavailable'

// ---------------------------------------------------------------------------
// Canonical fingerprint — the binding
// ---------------------------------------------------------------------------

/**
 * The canonical, stable identity of an operation: program, action, and exact
 * ordered arguments, length-prefixed so argument boundaries cannot be
 * confused (`['a','b']` is not `['ab']`). The authorization system computes the
 * same string for the operation it approved; equality is the binding check.
 *
 * Deterministic and pure, so it can be unit-tested and reproduced by the
 * broker independently.
 */
export function operationFingerprint(request: {
  program: string
  action: string
  args: readonly string[]
}): string {
  const parts = [request.program, request.action, ...request.args]
  return parts.map((p) => `${p.length}:${p}`).join('|')
}

// ---------------------------------------------------------------------------
// The executor seam
// ---------------------------------------------------------------------------

/**
 * The privileged executor. On Directioner-OS this is backed by the capability
 * broker; in tests it is a fake. The boundary calls it only after every check
 * passes, so an executor can assume its input is already authorized.
 */
export interface PrivilegedExecutor {
  execute(request: OperationRequest): Promise<
    { ok: true } | { ok: false; errorClass: OperationErrorClass }
  >
}

export interface OperationBoundaryOptions {
  executor: PrivilegedExecutor
  /** Injected clock (ISO-8601), so expiry is deterministic under test. */
  now: () => string
  /** Probe registry: given an operation, the diagnostics that would verify it. */
  verificationProbes?: (request: OperationRequest) => VerificationProbe[]
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * A coarse printable-atom gate. The structural check is per-action
 * ({@link ACTION_RULES}); this only rejects control characters and absurd
 * length. Arguments are passed to `spawn` as an array with no shell, so a
 * printable character cannot become a command — the per-action shape is what
 * constrains meaning.
 */
const ATOM = /^[^\u0000-\u001f\u007f]{1,128}$/

/** The arguments each action is allowed to take, by position and shape. */
const ACTION_RULES: Record<
  OperationAction,
  { program: OperationProgram; argShapes: RegExp[] }[]
> = {
  'service.restart': [
    {
      program: '/usr/bin/systemctl',
      argShapes: [
        /^[A-Za-z0-9][A-Za-z0-9@._-]*\.(service|socket|target|timer)$/,
      ],
    },
  ],
  'service.start': [
    {
      program: '/usr/bin/systemctl',
      argShapes: [
        /^[A-Za-z0-9][A-Za-z0-9@._-]*\.(service|socket|target|timer)$/,
      ],
    },
  ],
  'service.stop': [
    {
      program: '/usr/bin/systemctl',
      argShapes: [
        /^[A-Za-z0-9][A-Za-z0-9@._-]*\.(service|socket|target|timer)$/,
      ],
    },
  ],
  'module.load': [
    {
      program: '/usr/sbin/modprobe',
      argShapes: [/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/],
    },
  ],
  'module.unload': [
    {
      // `modprobe -r <module>`
      program: '/usr/sbin/modprobe',
      argShapes: [
        /^-r$/,
        /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/,
      ],
    },
    {
      // `rmmod <module>`
      program: '/usr/sbin/rmmod',
      argShapes: [/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/],
    },
  ],
  'kernel.parameter.set': [
    {
      program: '/usr/bin/sysctl',
      argShapes: [
        /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){0,6}=[A-Za-z0-9 ,._-]{1,64}$/,
      ],
    },
  ],
}

/**
 * Whether the operation is well-formed and matches a known action shape. This
 * is pure and runs before approval checks, so an invalid operation is rejected
 * identically whether or not an approval was presented.
 */
export function validateOperation(
  request: OperationRequest,
): { valid: true } | { valid: false; reason: OperationDenialReason } {
  const rules = ACTION_RULES[request.action]
  if (!rules) return { valid: false, reason: 'action_not_allowed' }
  const rule = rules.find((r) => r.program === request.program)
  if (!rule) return { valid: false, reason: 'program_not_allowed' }
  if (request.args.length !== rule.argShapes.length) {
    return { valid: false, reason: 'invalid_operation' }
  }
  for (let i = 0; i < request.args.length; i++) {
    const arg = request.args[i]
    if (typeof arg !== 'string' || !ATOM.test(arg) || !rule.argShapes[i].test(arg)) {
      return { valid: false, reason: 'invalid_operation' }
    }
  }
  if (typeof request.scope !== 'string' || request.scope.length === 0) {
    return { valid: false, reason: 'invalid_operation' }
  }
  return { valid: true }
}

// ---------------------------------------------------------------------------
// The boundary
// ---------------------------------------------------------------------------

/**
 * Run a privileged operation, but only if it is validated and carries an
 * unexpired approval bound to its exact fingerprint, and the consent decision
 * came from a user or policy. Every other path is a named denial. A completed
 * operation returns the probes that would verify it — never a success claim.
 */
export async function runPrivilegedOperation(
  options: OperationBoundaryOptions,
  request: OperationRequest,
  approval: OperationApproval | null,
  consent: ConsentDecision | null,
): Promise<OperationOutcome> {
  const id = request.operationId

  const validation = validateOperation(request)
  if (!validation.valid) {
    return { status: 'denied', operationId: id, reason: validation.reason }
  }

  // Consent must be explicit and must come from a human or policy — never
  // from a tool result, a repository file, or a model.
  if (!consent) {
    return { status: 'denied', operationId: id, reason: 'consent_denied' }
  }
  if (consent.source !== 'user' && consent.source !== 'policy') {
    return {
      status: 'denied',
      operationId: id,
      reason: 'consent_not_from_user',
    }
  }
  if (consent.decision !== 'granted') {
    return { status: 'denied', operationId: id, reason: 'consent_denied' }
  }

  // No approval object ⇒ no authority, regardless of consent.
  if (!approval) {
    return { status: 'denied', operationId: id, reason: 'no_approval' }
  }

  const fingerprint = operationFingerprint(request)
  if (approval.operationId !== id) {
    return {
      status: 'denied',
      operationId: id,
      reason: 'approval_fingerprint_mismatch',
    }
  }
  if (approval.fingerprint !== fingerprint) {
    return {
      status: 'denied',
      operationId: id,
      reason: 'approval_fingerprint_mismatch',
    }
  }
  if (approval.scope !== request.scope) {
    return {
      status: 'denied',
      operationId: id,
      reason: 'approval_scope_mismatch',
    }
  }
  if (isExpired(approval.expiresAt, options.now())) {
    return { status: 'denied', operationId: id, reason: 'approval_expired' }
  }

  const outcome = await options.executor.execute(request)
  if (!outcome.ok) {
    return { status: 'failed', operationId: id, errorClass: outcome.errorClass }
  }

  const probes = options.verificationProbes?.(request) ?? []
  return {
    status: 'completed',
    operationId: id,
    verificationRequired: probes,
  }
}

/** ISO-8601 comparison without pulling in a date library. */
function isExpired(expiresAt: string, nowIso: string): boolean {
  const expires = Date.parse(expiresAt)
  const now = Date.parse(nowIso)
  if (Number.isNaN(expires) || Number.isNaN(now)) return true // fail closed
  return now >= expires
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Compare a before/after pair of diagnostics to decide whether a remediation
 * is confirmed. The rule is the same as everywhere else: absence of evidence
 * is not evidence of success. If either side is unreadable, the verdict is
 * `inconclusive`, never `confirmed`.
 */
export type VerificationVerdict = 'confirmed' | 'not_confirmed' | 'inconclusive'

export interface VerificationComparison {
  verdict: VerificationVerdict
  detail: string
}

export function compareVerification(
  before: Pick<DiagnosticResult<unknown>, 'status' | 'findings'>,
  after: Pick<DiagnosticResult<unknown>, 'status' | 'findings'>,
  expectAbsent: string,
): VerificationComparison {
  if (before.status !== 'ok' || after.status !== 'ok') {
    return {
      verdict: 'inconclusive',
      detail: `cannot verify: before=${before.status}, after=${after.status}`,
    }
  }
  const afterStillPresent = after.findings.some((f) => f.code === expectAbsent)
  if (afterStillPresent) {
    return {
      verdict: 'not_confirmed',
      detail: `after the change, ${expectAbsent} is still present`,
    }
  }
  return {
    verdict: 'confirmed',
    detail: `after the change, ${expectAbsent} is no longer reported`,
  }
}
