/**
 * Pins the shared execution lifecycle contract against the canonical fixture.
 *
 * The fixture is a byte-for-byte copy of the backend's
 * `contracts/execution/execution-lifecycle.v1.json`; the `.sha256` is the pin
 * that fails if either repo's copy drifts. The vocabulary assertions are typed
 * as exhaustive records, so adding or removing a member of the CLI's unions
 * fails this test at type-check time as well as at run time.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'bun:test'

import type {
  BackendCancellationState,
  BackendTaskEventType,
  BackendVerificationState,
  ClaimRefusal,
  ExecutionState,
} from '../shared-task-client'

const fixtureUrl = fileURLToPath(
  new URL(
    '../../../contracts/execution/execution-lifecycle.v1.json',
    import.meta.url,
  ),
)
const hashUrl = fileURLToPath(
  new URL(
    '../../../contracts/execution/execution-lifecycle.v1.sha256',
    import.meta.url,
  ),
)
const fixtureBytes = readFileSync(fixtureUrl)
const fixture = JSON.parse(fixtureBytes.toString('utf8')) as Record<
  string,
  unknown
>

/** Exhaustive membership maps: a missing or extra union member fails `tsc`. */
const EXECUTION_STATES: Record<ExecutionState, true> = {
  pending: true,
  leased: true,
  running: true,
  completed: true,
  failed: true,
  cancelled: true,
}
const CLAIM_REFUSALS: Record<ClaimRefusal, true> = {
  terminal: true,
  not_dispatched: true,
  lease_held: true,
  cancellation_requested: true,
  cancellation_unconfirmed: true,
}
const CANCELLATIONS: Record<BackendCancellationState, true> = {
  none: true,
  requested: true,
  confirmed: true,
  unknown: true,
  failed: true,
}
const VERIFICATIONS: Record<BackendVerificationState, true> = {
  unverified: true,
  confirmed: true,
  not_confirmed: true,
  inconclusive: true,
}
const EVENT_TYPES: Record<BackendTaskEventType, true> = {
  'task.created': true,
  'task.started': true,
  'task.recovered': true,
  'task.completed': true,
  'task.failed': true,
  'task.cancelled': true,
  'cancellation.requested': true,
  'tool.completed': true,
  'approval.requested': true,
  'approval.granted': true,
  'approval.denied': true,
  'verification.recorded': true,
  'security.event': true,
}

describe('shared execution lifecycle contract', () => {
  it('the fixture hash pin matches the canonical bytes', () => {
    const recorded = readFileSync(hashUrl, 'utf8').trim().split(/\s+/)[0]
    const actual = createHash('sha256').update(fixtureBytes).digest('hex')
    expect(actual).toBe(recorded)
  })

  it('the CLI vocabulary matches the fixture exactly', () => {
    expect(fixture.version).toBe(1)
    expect(fixture.executionState).toEqual(Object.keys(EXECUTION_STATES))
    expect(fixture.claimRefusal).toEqual(Object.keys(CLAIM_REFUSALS))
    expect(fixture.cancellationState).toEqual(Object.keys(CANCELLATIONS))
    expect(fixture.verificationState).toEqual(Object.keys(VERIFICATIONS))
    expect(fixture.taskEventType).toEqual(Object.keys(EVENT_TYPES))
  })
})
