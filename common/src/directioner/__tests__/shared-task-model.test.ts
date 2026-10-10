import { describe, expect, test } from 'bun:test'
import type {
  ApprovalRecord,
  TaskEvent,
  TaskEventType,
} from '../platform-contract'
import {
  applyEvent,
  applyVerification,
  assertApprovalBinding,
  assertMetadataPayload,
  assertTaskOwnership,
  canRouteToDevice,
  createSharedTask,
  isTerminal,
  isTextAnApproval,
  projectEvents,
  projectTask,
  recordApprovalDecision,
  recoveryForSharedError,
  requestCancellation,
  type SharedTask,
  type TaskProjection,
} from '../shared-task-model'

const NOW = '2026-10-10T08:00:00.000Z'
const LATER = '2026-10-10T08:05:00.000Z'

function task(overrides: Partial<Parameters<typeof createSharedTask>[0]> = {}): SharedTask {
  return createSharedTask({
    taskId: 'task_1',
    accountId: 'acct_1',
    origin: 'cli',
    request: 'fix the build',
    contractVersion: '1.0.0',
    now: NOW,
    ...overrides,
  })
}

function event(
  seq: number,
  type: TaskEventType,
  overrides: Partial<TaskEvent> = {},
): TaskEvent {
  return {
    eventId: `task_1:evt:${seq}`,
    taskId: 'task_1',
    sequence: seq,
    type,
    timestamp: NOW,
    correlationId: 'corr_1',
    idempotencyKey: `${type}:${seq}`,
    ...overrides,
  }
}

describe('shared task model: direct CLI work is first-class', () => {
  test('a CLI task needs no Aria session, conversation, or device', () => {
    const t = task({ origin: 'cli' })
    expect(t.origin).toBe('cli')
    expect(t.sessionId).toBeUndefined()
    expect(t.conversationId).toBeUndefined()
    expect(t.deviceId).toBeUndefined()
    expect(t.state).toBe('created')
  })

  test('an Aria-originated task uses the same model', () => {
    const aria = task({ origin: 'aria', conversationId: 'conv_9', sessionId: 'sess_9' })
    const cli = task({ origin: 'cli' })
    // Same required core fields and same lifecycle; only optional origin
    // metadata differs. Aria is additive, never a different task kind.
    expect(aria.taskId).toBe(cli.taskId)
    expect(aria.request).toBe(cli.request)
    expect(aria.state).toBe(cli.state)
    expect(aria.createdAt).toBe(cli.createdAt)
    expect(aria.origin).toBe('aria')
    expect(cli.origin).toBe('cli')
    // The CLI task genuinely has no session or conversation.
    expect('sessionId' in cli).toBe(false)
    expect('conversationId' in cli).toBe(false)
  })

  test('contract version is recorded on the task', () => {
    expect(task({ contractVersion: '1.4.0' }).contractVersion).toBe('1.4.0')
  })
})

describe('shared task model: ownership and routing derive from verified identity', () => {
  test('a task may be read by its owning account', () => {
    expect(() => assertTaskOwnership('acct_1', 'acct_1')).not.toThrow()
  })

  test('another account sees not-found, not the task', () => {
    expect(() => assertTaskOwnership('acct_1', 'acct_2')).toThrow(/not found/i)
  })

  test('a device in another account cannot receive the task', () => {
    const decision = canRouteToDevice('acct_1', {
      deviceId: 'dev_2',
      accountId: 'acct_2',
      clientKind: 'cli',
      revoked: false,
    })
    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.reason).toBe('account_mismatch')
  })

  test('a revoked device cannot receive new authorized work', () => {
    const decision = canRouteToDevice('acct_1', {
      deviceId: 'dev_1',
      accountId: 'acct_1',
      clientKind: 'cli',
      revoked: true,
    })
    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.reason).toBe('device_revoked')
  })

  test('a live owned device routes', () => {
    expect(
      canRouteToDevice('acct_1', {
        deviceId: 'dev_1',
        accountId: 'acct_1',
        clientKind: 'aria',
        revoked: false,
      }).ok,
    ).toBe(true)
  })
})

describe('shared task model: event application', () => {
  function project(): TaskProjection {
    return projectTask(task())
  }

  test('a newer lifecycle event advances the state', () => {
    const outcome = applyEvent(project(), event(1, 'task.started'))
    expect(outcome.kind).toBe('applied')
    expect(outcome.projection.state).toBe('running')
    expect(outcome.projection.lastSequence).toBe(1)
  })

  test('a duplicate delivery (same event id) is a no-op', () => {
    const once = applyEvent(project(), event(1, 'task.started'))
    const twice = applyEvent(once.projection, event(1, 'task.started'))
    expect(twice.kind).toBe('duplicate')
    expect(twice.projection.state).toBe('running')
    expect(twice.projection.lastSequence).toBe(1)
  })

  test('a retry that reuses an idempotency key but a new id is a no-op', () => {
    const first = event(1, 'task.started')
    const once = applyEvent(project(), first)
    const retry = applyEvent(once.projection, {
      ...first,
      eventId: 'task_1:evt:1-redelivery',
    })
    expect(retry.kind).toBe('duplicate')
    expect(retry.projection.lastSequence).toBe(1)
  })

  test('a stale event does not overwrite newer state', () => {
    const a = applyEvent(project(), event(5, 'task.started'))
    const stale = applyEvent(a.projection, event(2, 'task.paused'))
    expect(stale.kind).toBe('out_of_order')
    expect(stale.projection.state).toBe('running')
    expect(stale.projection.lastSequence).toBe(5)
  })

  test('an event for another task is rejected, not applied', () => {
    const outcome = applyEvent(project(), event(1, 'task.started', { taskId: 'task_2' }))
    expect(outcome.kind).toBe('rejected')
    expect(outcome.projection.state).toBe('created')
  })

  test('a sequence gap marks the projection partial', () => {
    const outcome = applyEvent(project(), event(3, 'task.started'))
    expect(outcome.kind).toBe('applied')
    expect(outcome.projection.partial).toBe(true)
  })

  test('contiguous events are not partial', () => {
    let p = applyEvent(project(), event(1, 'task.started')).projection
    p = applyEvent(p, event(2, 'task.paused')).projection
    expect(p.partial).toBe(false)
  })

  test('metadata events (e.g. tool.completed) do not change lifecycle state', () => {
    const started = applyEvent(project(), event(1, 'task.started')).projection
    const tool = applyEvent(started, event(2, 'tool.completed'))
    expect(tool.projection.state).toBe('running')
  })

  test('a terminal task cannot be reopened by a later event', () => {
    let p = applyEvent(project(), event(1, 'task.started')).projection
    p = applyEvent(p, event(2, 'task.completed')).projection
    expect(isTerminal(p.state)).toBe(true)
    const reopen = applyEvent(p, event(3, 'task.started'))
    expect(reopen.kind).toBe('rejected')
    expect(reopen.projection.state).toBe('completed')
  })

  test('projectEvents folds a whole journal', () => {
    const p = projectEvents(task(), [
      event(1, 'task.created'),
      event(2, 'task.started'),
      event(3, 'task.paused'),
      event(4, 'task.resumed'),
    ])
    expect(p.state).toBe('running')
    expect(p.lastSequence).toBe(4)
  })

  test('an approval acknowledgement never completes a task', () => {
    const started = applyEvent(project(), event(1, 'task.started')).projection
    const granted = applyEvent(started, event(2, 'approval.granted'))
    expect(granted.projection.state).toBe('running')
    expect(isTerminal(granted.projection.state)).toBe(false)
  })
})

describe('shared task model: cancellation is a request, not a result', () => {
  test('requesting cancellation moves to cancelling, not cancelled', () => {
    const running = applyEvent(projectTask(task()), event(1, 'task.started')).projection
    const requested = requestCancellation(running, LATER)
    expect(requested.ok).toBe(true)
    if (requested.ok) {
      expect(requested.projection.state).toBe('cancelling')
      expect(requested.projection.cancellation).toBe('requested')
    }
  })

  test('only a task.cancelled event confirms cancellation', () => {
    const p2 = applyEvent(projectTask(task()), event(1, 'task.started')).projection
    const req = requestCancellation(p2, LATER)
    const base = req.ok ? req.projection : p2
    const cancelled = applyEvent(base, event(2, 'task.cancelled'))
    expect(cancelled.projection.state).toBe('cancelled')
    expect(cancelled.projection.cancellation).toBe('confirmed')
  })

  test('completion racing a cancel is reported truthfully, not as cancelled', () => {
    let p = applyEvent(projectTask(task()), event(1, 'task.started')).projection
    const req = requestCancellation(p, LATER)
    p = req.ok ? req.projection : p
    const completed = applyEvent(p, event(2, 'task.completed'))
    expect(completed.projection.state).toBe('completed')
    expect(completed.projection.cancellation).toBe('unknown')
  })

  test('cancelling a terminal task is refused', () => {
    let p = applyEvent(projectTask(task()), event(1, 'task.started')).projection
    p = applyEvent(p, event(2, 'task.completed')).projection
    const req = requestCancellation(p, LATER)
    expect(req.ok).toBe(false)
    if (!req.ok) expect(req.reason).toBe('already_terminal')
  })

  test('a second cancellation request is refused', () => {
    const running = applyEvent(projectTask(task()), event(1, 'task.started')).projection
    const first = requestCancellation(running, LATER)
    const base = first.ok ? first.projection : running
    const second = requestCancellation(base, LATER)
    expect(second.ok).toBe(false)
  })
})

describe('shared task model: verification honesty', () => {
  test('only confirmed marks the effect proven', () => {
    const p = projectTask(task())
    expect(applyVerification(p, 'confirmed').verification).toBe('confirmed')
    expect(applyVerification(p, 'not_confirmed').verification).toBe('not_confirmed')
    expect(applyVerification(p, 'inconclusive').verification).toBe('inconclusive')
  })

  test('a fresh task is unverified', () => {
    expect(projectTask(task()).verification).toBe('unverified')
  })
})

describe('shared task model: approvals bind to task, operation, and scope', () => {
  const approval: ApprovalRecord = {
    approvalId: 'appr_1',
    taskId: 'task_1',
    operationId: 'op_1',
    riskTier: 'high',
    scope: 'service:nginx.service',
    requestedAt: NOW,
    expiresAt: LATER,
    decision: 'granted',
    decisionSource: 'user',
    decidedAt: NOW,
  }

  test('a matching binding is accepted', () => {
    expect(assertApprovalBinding(approval, 'task_1', 'op_1', 'service:nginx.service').ok).toBe(true)
  })

  test('an approval cannot be replayed onto another task', () => {
    const result = assertApprovalBinding(approval, 'task_2', 'op_1', 'service:nginx.service')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('wrong_task')
  })

  test('an approval cannot authorize a different operation', () => {
    const result = assertApprovalBinding(approval, 'task_1', 'op_2', 'service:nginx.service')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('wrong_operation')
  })

  test('an approval cannot be widened beyond its scope', () => {
    const result = assertApprovalBinding(approval, 'task_1', 'op_1', 'service:everything')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('scope_mismatch')
  })

  test('text is never an approval', () => {
    expect(isTextAnApproval('yes, go ahead')).toBe(false)
    expect(isTextAnApproval('{"approved": true}')).toBe(false)
    expect(isTextAnApproval('')).toBe(false)
  })

  test('recording a decision stamps the user as the source', () => {
    const undecided: ApprovalRecord = { ...approval, decision: 'denied', decisionSource: 'policy', decidedAt: '' }
    const decided = recordApprovalDecision(undecided, 'granted', LATER)
    expect(decided.decision).toBe('granted')
    expect(decided.decisionSource).toBe('user')
  })

  test('an already-decided approval cannot be re-decided', () => {
    expect(() => recordApprovalDecision(approval, 'denied', LATER)).toThrow(/already been decided/)
  })
})

describe('shared task model: error taxonomy has a recovery per kind', () => {
  test('authentication and session failures ask to authenticate', () => {
    expect(recoveryForSharedError('authentication_required')).toBe('authenticate')
    expect(recoveryForSharedError('session_expired')).toBe('authenticate')
  })

  test('device revocation asks to register, not authenticate', () => {
    expect(recoveryForSharedError('device_revoked')).toBe('register_device')
  })

  test('uncertain outcomes resync rather than being reported as done', () => {
    expect(recoveryForSharedError('result_uncertain')).toBe('resync')
    expect(recoveryForSharedError('verification_unavailable')).toBe('report')
    expect(recoveryForSharedError('os_integration_unavailable')).toBe('report')
  })
})

describe('shared task model: privacy of the metadata stream', () => {
  test('plain metadata is accepted', () => {
    expect(assertMetadataPayload({ from: 'running', to: 'paused' }).ok).toBe(true)
  })

  test('conversation content is rejected from the shared stream', () => {
    for (const key of ['transcript', 'audio', 'rawPrompt', 'conversation', 'messages']) {
      const result = assertMetadataPayload({ [key]: 'anything' })
      expect(result.ok).toBe(false)
    }
  })
})
