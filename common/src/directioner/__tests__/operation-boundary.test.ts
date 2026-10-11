import { describe, expect, test } from 'bun:test'

import {
  compareVerification,
  operationFingerprint,
  runPrivilegedOperation,
  validateOperation,
} from '../operation-boundary'

import type {
  ConsentDecision,
  OperationApproval,
  OperationRequest,
  PrivilegedExecutor,
} from '../operation-boundary'

const NOW = '2026-10-10T00:00:00.000Z'
const FUTURE = '2026-10-10T01:00:00.000Z'
const PAST = '2026-10-09T00:00:00.000Z'

function restartNginx(): OperationRequest {
  return {
    operationId: 'op-1',
    taskId: 'task-1',
    program: '/usr/bin/systemctl',
    action: 'service.restart',
    args: ['nginx.service'],
    domain: 'service',
    scope: 'service:nginx.service',
  }
}

function approvalFor(request: OperationRequest, overrides: Partial<OperationApproval> = {}): OperationApproval {
  return {
    approvalId: 'apr-1',
    operationId: request.operationId,
    fingerprint: operationFingerprint(request),
    scope: request.scope,
    expiresAt: FUTURE,
    grantedBy: 'user',
    ...overrides,
  }
}

const userGrant: ConsentDecision = { decision: 'granted', source: 'user' }

function recordingExecutor(): PrivilegedExecutor & { calls: OperationRequest[] } {
  const calls: OperationRequest[] = []
  return {
    calls,
    async execute(request) {
      calls.push(request)
      return { ok: true }
    },
  }
}

function boundary(executor: PrivilegedExecutor, probes?: (r: OperationRequest) => { diagnosticId: string; expectation: string }[]) {
  return { executor, now: () => NOW, verificationProbes: probes }
}

describe('operation validation', () => {
  test('a well-formed service restart is valid', () => {
    expect(validateOperation(restartNginx()).valid).toBe(true)
  })

  test('shell metacharacters in an argument are refused', () => {
    const req = { ...restartNginx(), args: ['nginx.service; rm -rf /'] }
    const result = validateOperation(req)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toBe('invalid_operation')
  })

  test('a wrong arity is refused', () => {
    const req = { ...restartNginx(), args: [] }
    expect(validateOperation(req).valid).toBe(false)
  })

  test('an action paired with the wrong program is refused', () => {
    const req = { ...restartNginx(), program: '/usr/bin/sysctl' as const }
    const result = validateOperation(req)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toBe('program_not_allowed')
  })

  test('an unknown action is refused', () => {
    const req = { ...restartNginx(), action: 'service.nuke' as never }
    expect(validateOperation(req).valid).toBe(false)
  })

  test('a kernel parameter set is only valid with key=value shape', () => {
    const good = {
      ...restartNginx(),
      program: '/usr/bin/sysctl' as const,
      action: 'kernel.parameter.set' as const,
      args: ['net.ipv4.ip_forward=1'],
      scope: 'kernel:net.ipv4.ip_forward',
    }
    expect(validateOperation(good).valid).toBe(true)
    const bad = { ...good, args: ['net.ipv4.ip_forward 1'] }
    expect(validateOperation(bad).valid).toBe(false)
  })
})

describe('authority: text is never authority', () => {
  test('a valid operation with no approval object is denied', async () => {
    const exec = recordingExecutor()
    const outcome = await runPrivilegedOperation(
      boundary(exec),
      restartNginx(),
      null,
      userGrant,
    )
    expect(outcome.status).toBe('denied')
    if (outcome.status === 'denied') expect(outcome.reason).toBe('no_approval')
    expect(exec.calls.length).toBe(0)
  })

  test('consent alone without approval is not enough', async () => {
    const exec = recordingExecutor()
    const outcome = await runPrivilegedOperation(
      boundary(exec),
      restartNginx(),
      null,
      { decision: 'granted', source: 'user' },
    )
    expect(outcome.status).toBe('denied')
    expect(exec.calls.length).toBe(0)
  })

  test('consent that did not come from a user or policy is denied', async () => {
    const exec = recordingExecutor()
    const req = restartNginx()
    const outcome = await runPrivilegedOperation(
      boundary(exec),
      req,
      approvalFor(req),
      { decision: 'granted', source: 'timeout' },
    )
    expect(outcome.status).toBe('denied')
    if (outcome.status === 'denied')
      expect(outcome.reason).toBe('consent_not_from_user')
    expect(exec.calls.length).toBe(0)
  })

  test('explicit denial is respected', async () => {
    const exec = recordingExecutor()
    const req = restartNginx()
    const outcome = await runPrivilegedOperation(
      boundary(exec),
      req,
      approvalFor(req),
      { decision: 'denied', source: 'user' },
    )
    expect(outcome.status).toBe('denied')
    if (outcome.status === 'denied') expect(outcome.reason).toBe('consent_denied')
    expect(exec.calls.length).toBe(0)
  })
})

describe('binding: an approval cannot be replayed or confused', () => {
  test('an approval for a different operation id is refused', async () => {
    const exec = recordingExecutor()
    const req = restartNginx()
    const outcome = await runPrivilegedOperation(
      boundary(exec),
      req,
      approvalFor(req, { operationId: 'op-other' }),
      userGrant,
    )
    expect(outcome.status).toBe('denied')
    if (outcome.status === 'denied')
      expect(outcome.reason).toBe('approval_fingerprint_mismatch')
    expect(exec.calls.length).toBe(0)
  })

  test('an approval for restarting nginx cannot restart sshd', async () => {
    const exec = recordingExecutor()
    const nginx = restartNginx()
    const approval = approvalFor(nginx)
    const sshd: OperationRequest = {
      ...nginx,
      operationId: 'op-2',
      args: ['sshd.service'],
      scope: 'service:sshd.service',
    }
    const outcome = await runPrivilegedOperation(
      boundary(exec),
      sshd,
      approval,
      userGrant,
    )
    expect(outcome.status).toBe('denied')
    expect(exec.calls.length).toBe(0)
  })

  test('an approval with a matching fingerprint but wrong scope is refused', async () => {
    const exec = recordingExecutor()
    const req = restartNginx()
    const outcome = await runPrivilegedOperation(
      boundary(exec),
      req,
      approvalFor(req, { scope: 'service:everything' }),
      userGrant,
    )
    expect(outcome.status).toBe('denied')
    if (outcome.status === 'denied')
      expect(outcome.reason).toBe('approval_scope_mismatch')
    expect(exec.calls.length).toBe(0)
  })

  test('an expired approval is refused even when it otherwise matches', async () => {
    const exec = recordingExecutor()
    const req = restartNginx()
    const outcome = await runPrivilegedOperation(
      boundary(exec),
      req,
      approvalFor(req, { expiresAt: PAST }),
      userGrant,
    )
    expect(outcome.status).toBe('denied')
    if (outcome.status === 'denied') expect(outcome.reason).toBe('approval_expired')
    expect(exec.calls.length).toBe(0)
  })

  test('an unparseable expiry fails closed', async () => {
    const exec = recordingExecutor()
    const req = restartNginx()
    const outcome = await runPrivilegedOperation(
      boundary(exec),
      req,
      approvalFor(req, { expiresAt: 'not-a-date' }),
      userGrant,
    )
    expect(outcome.status).toBe('denied')
    if (outcome.status === 'denied') expect(outcome.reason).toBe('approval_expired')
  })

  test('a forged approval missing the fingerprint cannot authorize', async () => {
    const exec = recordingExecutor()
    const req = restartNginx()
    const outcome = await runPrivilegedOperation(
      boundary(exec),
      req,
      { ...approvalFor(req), fingerprint: 'passed' },
      userGrant,
    )
    expect(outcome.status).toBe('denied')
    expect(exec.calls.length).toBe(0)
  })
})

describe('execution and honest verification', () => {
  test('a fully authorized operation runs and asks for verification', async () => {
    const exec = recordingExecutor()
    const req = restartNginx()
    const outcome = await runPrivilegedOperation(
      boundary(exec, () => [
        { diagnosticId: 'service.status', expectation: 'activeState=active' },
      ]),
      req,
      approvalFor(req),
      userGrant,
    )
    expect(outcome.status).toBe('completed')
    expect(exec.calls.length).toBe(1)
    if (outcome.status === 'completed') {
      expect(outcome.verificationRequired.length).toBe(1)
      expect(outcome.verificationRequired[0].diagnosticId).toBe('service.status')
    }
  })

  test('a completed operation never claims success, only verification probes', async () => {
    const exec = recordingExecutor()
    const req = restartNginx()
    const outcome = await runPrivilegedOperation(
      boundary(exec),
      req,
      approvalFor(req),
      userGrant,
    )
    expect(outcome.status).toBe('completed')
    expect('success' in (outcome as object)).toBe(false)
    if (outcome.status === 'completed') {
      expect(Array.isArray(outcome.verificationRequired)).toBe(true)
    }
  })

  test('an invalid operation is denied before the executor is reached', async () => {
    const exec = recordingExecutor()
    const req = { ...restartNginx(), args: ['a; b'] }
    const outcome = await runPrivilegedOperation(
      boundary(exec),
      req,
      approvalFor(req),
      userGrant,
    )
    expect(outcome.status).toBe('denied')
    expect(exec.calls.length).toBe(0)
  })

  test('an executor failure is surfaced as failed, not completed', async () => {
    const exec: PrivilegedExecutor = {
      async execute() {
        return { ok: false, errorClass: 'executor_failed' }
      },
    }
    const req = restartNginx()
    const outcome = await runPrivilegedOperation(
      boundary(exec),
      req,
      approvalFor(req),
      userGrant,
    )
    expect(outcome.status).toBe('failed')
  })
})

describe('fingerprint canonicalization', () => {
  test('is deterministic and stable', () => {
    const req = { program: '/usr/bin/systemctl', action: 'service.restart', args: ['nginx.service'] }
    expect(operationFingerprint(req)).toBe(operationFingerprint(req))
  })

  test('argument boundaries cannot be confused', () => {
    const a = operationFingerprint({ program: 'p', action: 'a', args: ['a', 'b'] })
    const b = operationFingerprint({ program: 'p', action: 'a', args: ['ab'] })
    const c = operationFingerprint({ program: 'p', action: 'a', args: ['a|b'] })
    expect(a).not.toBe(b)
    expect(a).not.toBe(c)
  })

  test('a different action yields a different fingerprint', () => {
    const base = { program: '/usr/bin/systemctl', args: ['nginx.service'] }
    expect(operationFingerprint({ ...base, action: 'service.restart' })).not.toBe(
      operationFingerprint({ ...base, action: 'service.stop' }),
    )
  })
})

describe('verification comparison', () => {
  const before = { status: 'ok' as const, findings: [{ code: 'service.failed', message: 'x', severity: 'error' as const }] }

  test('confirms when the expected finding is gone and both sides readable', () => {
    const after = { status: 'ok' as const, findings: [{ code: 'service.active', message: 'y', severity: 'info' as const }] }
    expect(compareVerification(before, after, 'service.failed').verdict).toBe('confirmed')
  })

  test('does not confirm when the finding remains', () => {
    expect(compareVerification(before, before, 'service.failed').verdict).toBe('not_confirmed')
  })

  test('is inconclusive when the after-read was unavailable', () => {
    const after = { status: 'unavailable' as const, findings: [] }
    expect(compareVerification(before, after, 'service.failed').verdict).toBe('inconclusive')
  })

  test('is inconclusive when the before-read was unavailable', () => {
    const beforeBad = { status: 'denied' as const, findings: [] }
    expect(compareVerification(beforeBad, before, 'service.failed').verdict).toBe('inconclusive')
  })
})
