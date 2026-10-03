import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  ReferenceTransport,
  TASK_TRANSITIONS,
  canTransition,
  type ReferenceClock,
  type ReferenceTransportOptions,
} from '../testing/reference-transport'

import type { DirectionerTask, OperationOutcome } from '../platform-contract'

/** A clock the test drives by hand, so expiry is deterministic. */
function manualClock(start = 1_700_000_000_000): {
  clock: ReferenceClock
  advance: (ms: number) => void
} {
  let now = start
  return {
    clock: { now: () => now },
    advance: (ms) => {
      now += ms
    },
  }
}

const WORKSPACE = { path: '/tmp/test-repo', branch: 'main' }

const OFFLINE: ReferenceTransportOptions['failCloudWith'] = {
  code: 'BACKEND_UNAVAILABLE',
  message: 'backend down',
  retryable: true,
}

/** Sign in and register a device, returning a ready-to-use transport. */
async function signedIn(
  options: ReferenceTransportOptions = {},
): Promise<ReferenceTransport> {
  const t = new ReferenceTransport(options)
  await t.authenticate()
  t.__approveDeviceAuthorization()
  await t.registerDevice('test-host')
  return t
}

function expectOk<T>(outcome: OperationOutcome<T>): T {
  if (outcome.status !== 'ok') {
    throw new Error(`expected ok, got ${outcome.status}`)
  }
  return outcome.value
}

function expectFailed<T>(outcome: OperationOutcome<T>): { code: string } {
  if (outcome.status !== 'failed') {
    throw new Error(`expected failed, got ${outcome.status}`)
  }
  return { code: outcome.error.code }
}

async function createTask(t: ReferenceTransport): Promise<DirectionerTask> {
  return expectOk(
    await t.createTask({ request: 'do the thing', workspace: WORKSPACE }),
  )
}

describe('reference transport: isolation', () => {
  test('no production source imports the test transport', () => {
    // The transport is only safe if it cannot leak into the shipped client.
    const projectRoot = join(import.meta.dir, '..', '..', '..', '..')
    const roots = ['cli/src', 'sdk/src', 'packages', 'common/src']
    const offenders: string[] = []
    for (const root of roots) {
      for (const file of walk(join(projectRoot, root))) {
        if (file.includes(join('directioner', 'testing'))) continue
        if (/reference-transport/.test(readFileSync(file, 'utf8'))) {
          offenders.push(file)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  test('the fake verification URL is non-routable', async () => {
    const t = new ReferenceTransport()
    const grant = expectOk(await t.authenticate())
    expect(grant.verificationUrl).toContain('.invalid')
    expect(grant.userCode).toContain('TEST')
  })
})

describe('reference transport: identity lifecycle', () => {
  test('registering before the user approves the device fails', async () => {
    const t = new ReferenceTransport()
    await t.authenticate()
    expect(expectFailed(await t.registerDevice()).code).toBe('AUTH_REQUIRED')
  })

  test('the happy path reaches an active device and session', async () => {
    const t = await signedIn()
    expect(expectOk(await t.isDeviceActive())).toBe(true)
    expect(expectOk(await t.getSession()).state).toBe('active')
  })

  test('an expired session is AUTH_EXPIRED, not a generic failure', async () => {
    const { clock, advance } = manualClock()
    const t = await signedIn({ clock })
    advance(60 * 60 * 1000 + 1)
    expect(expectFailed(await t.getSession()).code).toBe('AUTH_EXPIRED')
  })

  test('a revoked device is DEVICE_REVOKED, and logout clears identity', async () => {
    const t = await signedIn()
    t.__revokeDevice()
    expect(expectFailed(await t.isDeviceActive()).code).toBe('DEVICE_REVOKED')
    expectOk(await t.logout())
    expect(expectFailed(await t.getAccount()).code).toBe('AUTH_REQUIRED')
  })

  test('a denied device authorization never registers', async () => {
    const t = new ReferenceTransport()
    await t.authenticate()
    t.__denyDeviceAuthorization()
    expect(expectFailed(await t.registerDevice()).code).toBe('AUTH_REQUIRED')
  })
})

describe('reference transport: task lifecycle', () => {
  test('every transition-table edge is accepted and terminal states are closed', () => {
    for (const [from, tos] of Object.entries(TASK_TRANSITIONS)) {
      for (const to of tos) {
        expect(canTransition(from as never, to)).toBe(true)
      }
    }
    expect(canTransition('completed', 'running')).toBe(false)
    expect(canTransition('cancelled', 'running')).toBe(false)
  })

  test('a created task starts in created and records task.created', async () => {
    const t = await signedIn()
    const task = await createTask(t)
    expect(task.state).toBe('created')
    const events = expectOk(await t.getTaskEvents(task.taskId)).events
    expect(events[0].type).toBe('task.created')
    expect(events[0].sequence).toBe(1)
  })

  test('cancelling a completed task is rejected, not silently applied', async () => {
    const t = await signedIn()
    const task = await createTask(t)
    t.__seedTaskState(task.taskId, 'completed')
    expect(expectFailed(await t.cancelTask(task.taskId)).code).toBe(
      'TASK_STATE_INVALID',
    )
  })

  test('a missing task is TASK_NOT_FOUND', async () => {
    const t = await signedIn()
    expect(expectFailed(await t.getTask('nope')).code).toBe('TASK_NOT_FOUND')
  })
})

describe('reference transport: events are append-only and monotonic', () => {
  test('sequences are monotonic and unique', async () => {
    const t = await signedIn()
    const task = await createTask(t)
    await t.sendTaskInput({ taskId: task.taskId, message: 'hello' })
    const seqs = expectOk(await t.getTaskEvents(task.taskId)).events.map(
      (e) => e.sequence,
    )
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
    expect(new Set(seqs).size).toBe(seqs.length)
  })

  test('getTaskEvents(sinceSequence) returns only newer events', async () => {
    const t = await signedIn()
    const task = await createTask(t)
    const first = expectOk(await t.getTaskEvents(task.taskId)).events
    const since = first[0].sequence
    const rest = expectOk(await t.getTaskEvents(task.taskId, since)).events
    expect(rest.every((e) => e.sequence > since)).toBe(true)
  })
})

describe('reference transport: approvals cannot be forged or replayed', () => {
  test('a requested approval is undecided, not granted', async () => {
    const t = await signedIn()
    const task = await createTask(t)
    const req = t.__requestApproval({
      taskId: task.taskId,
      operationId: 'op_1',
      scope: 'rm -rf build/',
    })
    expect(req.decidedAt).toBe('')
    expect(t.__getStoredApproval(req.approvalId)?.decidedAt).toBe('')
  })

  test('submitting a decision records the user as the source', async () => {
    const t = await signedIn()
    const task = await createTask(t)
    const req = t.__requestApproval({
      taskId: task.taskId,
      operationId: 'op_1',
      scope: 'deploy',
    })
    const decided = expectOk(
      await t.submitApproval({
        approvalId: req.approvalId,
        decision: 'granted',
      }),
    )
    expect(decided.decision).toBe('granted')
    expect(decided.decisionSource).toBe('user')
  })

  test('an approval cannot be replayed', async () => {
    const t = await signedIn()
    const task = await createTask(t)
    const req = t.__requestApproval({
      taskId: task.taskId,
      operationId: 'op_1',
      scope: 'deploy',
    })
    await t.submitApproval({ approvalId: req.approvalId, decision: 'granted' })
    expect(
      expectFailed(
        await t.submitApproval({
          approvalId: req.approvalId,
          decision: 'granted',
        }),
      ).code,
    ).toBe('TASK_STATE_INVALID')
  })

  test('a denied approval cannot become granted by replay', async () => {
    const t = await signedIn()
    const task = await createTask(t)
    const req = t.__requestApproval({
      taskId: task.taskId,
      operationId: 'op_1',
      scope: 'deploy',
    })
    await t.submitApproval({ approvalId: req.approvalId, decision: 'denied' })
    expect(
      expectFailed(
        await t.submitApproval({
          approvalId: req.approvalId,
          decision: 'granted',
        }),
      ).code,
    ).toBe('TASK_STATE_INVALID')
    expect(t.__getStoredApproval(req.approvalId)?.decision).toBe('denied')
  })

  test('an expired approval cannot be granted', async () => {
    const { clock, advance } = manualClock()
    const t = await signedIn({ clock })
    const task = await createTask(t)
    const req = t.__requestApproval({
      taskId: task.taskId,
      operationId: 'op_1',
      scope: 'deploy',
    })
    advance(5 * 60 * 1000 + 1)
    expect(
      expectFailed(
        await t.submitApproval({
          approvalId: req.approvalId,
          decision: 'granted',
        }),
      ).code,
    ).toBe('APPROVAL_REQUIRED')
  })

  test('a decision cannot widen the scope it was requested for', async () => {
    const t = await signedIn()
    const task = await createTask(t)
    const req = t.__requestApproval({
      taskId: task.taskId,
      operationId: 'op_1',
      scope: 'read only',
    })
    const decided = expectOk(
      await t.submitApproval({
        approvalId: req.approvalId,
        decision: 'granted',
      }),
    )
    expect(decided.scope).toBe('read only')
    expect(decided.operationId).toBe('op_1')
  })
})

describe('reference transport: offline vs cloud failure', () => {
  test('a cloud failure on sync is "queued", never "ok"', async () => {
    const t = await signedIn()
    const task = await createTask(t)
    // The connection drops after the task exists, as it would mid-session.
    t.__setCloudFailure(OFFLINE)
    const outcome = await t.syncEvents(task.taskId)
    expect(outcome.status).toBe('queued')
    if (outcome.status === 'queued') {
      expect(outcome.sync.lastError?.code).toBe('BACKEND_UNAVAILABLE')
      // The local events are still there: local success is not cloud success.
      expect(outcome.sync.pendingCount).toBeGreaterThan(0)
    }
  })

  test('reconnecting syncs the events that were queued while offline', async () => {
    const t = await signedIn()
    const task = await createTask(t)
    t.__setCloudFailure(OFFLINE)
    const queued = await t.syncEvents(task.taskId)
    expect(queued.status).toBe('queued')
    t.__setCloudFailure(undefined)
    const after = expectOk(await t.syncEvents(task.taskId))
    expect(after.pendingCount).toBe(0)
  })

  test('cloud-dependent calls fail with a named error while offline', async () => {
    const t = new ReferenceTransport({ failCloudWith: OFFLINE })
    expect(expectFailed(await t.authenticate()).code).toBe(
      'BACKEND_UNAVAILABLE',
    )
  })

  test('sync after a healthy path acknowledges the pending events', async () => {
    const t = await signedIn()
    const task = await createTask(t)
    const before = expectOk(await t.getTaskEvents(task.taskId)).sync
    expect(before.pendingCount).toBeGreaterThan(0)
    const after = expectOk(await t.syncEvents(task.taskId))
    expect(after.pendingCount).toBe(0)
    expect(after.acknowledgedThrough).toBe(before.pendingCount)
  })
})

/** Minimal recursive file walk for the isolation test. */
function* walk(dir: string): Generator<string> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      yield* walk(full)
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      yield full
    }
  }
}
