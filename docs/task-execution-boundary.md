# CLI task execution boundary

`common/src/directioner/` now contains the client half of the backend's task
execution boundary. Together with `shared-task-model.ts` (behaviour) and
`platform-contract.ts` (shapes), it lets the terminal — or Aria, once the backend
validates the request — receive work and report honest results.

The pieces:

| File | Role |
| --- | --- |
| `shared-task-client.ts` | The `SharedTaskClient` interface: the supported execution surface, provider-neutral, no URL or credential. |
| `backend-http-client.ts` | The real HTTP adapter against the Directioner Platform Backend. |
| `task-executor.ts` | The loop: claim a lease, run the agent, journal, record, cancel. |
| `task-delegation.ts` | Composition: `createBackendExecutor` wires client + executor + agent. |
| `sdk/src/directioner/run-sdk-agent.ts` | The production `AgentRunner` that drives the real CLI agent. |

The agent is injected (`AgentRunner`), so `common` stays free of the agent
runtime and the loop is testable with a deterministic runner.

## What the executor guarantees

1. **Lease before run.** A task is only executed after `claim` returns a lease.
   A task whose lease is held elsewhere is reported `not_claimed`, never run.
2. **Started means started.** `task.started` is journaled only after the lease is
   held and the run is about to begin.
3. **Results are honest.** A result is recorded with the host's verification
   verdict. When the host supplies none, the executor records `inconclusive` — a
   run that merely returned is not proof the requested change was made.
4. **Cancellation is not a result.** A `requested` cancellation aborts the agent
   and waits for it to stop. The stop is confirmed only after the run settles;
   if the backend refuses the confirmation, the failure is surfaced, never
   reported as a false "cancelled".
5. **Privileged work is not faked.** Root/OS-authority actions belong to
   Directioner-OS; this executor neither performs nor pretends to perform them.

## Failure classification

Every client call returns an `OperationOutcome`. A transport failure, an
expired session, or a rate limit is a named `DirectionerServiceError` — never a
silent success. HTTP status maps onto the shared vocabulary:

| HTTP | Code |
| --- | --- |
| 400 / 409 / 422 | `TASK_STATE_INVALID` |
| 401 | `AUTH_REQUIRED` |
| 403 | `ENTITLEMENT_DENIED` |
| 404 | `TASK_NOT_FOUND` |
| 429 | `RATE_LIMITED` (retryable, with `retryAfterMs`) |
| 5xx / network | `BACKEND_UNAVAILABLE` (retryable) |

## The worker loop

`createBackendExecutor(config).runPending(limit)` pulls `/executions/runnable`
and runs every task this worker can lease. `executeTask(taskId)` runs one task.
Both return `ExecuteOutcome`, so a caller can distinguish `completed`, `failed`,
`cancelled`, `not_claimed`, and `client_error` without inspecting exceptions.

## The wire contract

The adapter targets the backend's own routes (`docs/TASK-EXECUTION-CONTRACT.md`
in the platform repo): `/tasks`, `/tasks/:id/dispatch`, `/tasks/:id/execution`
(+`/claim`, `/heartbeat`, `/result`, `/cancellation`), `/tasks/:id/events`,
`/tasks/:id/cancel`, `/approvals`, `/executions/runnable`, `/executions/reconcile`.
Responses are validated with zod before they are trusted.

The bearer token travels only in the `authorization` header. The adapter holds a
callback that returns the current in-memory token; it never persists it and never
logs it.
