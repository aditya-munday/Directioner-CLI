# Shared Directioner task, session, and event model

`common/src/directioner/shared-task-model.ts` is the client-side behavioural core
of the shared task system. `platform-contract.ts` defines the shapes; this module
defines what an event *does*, what a cancellation *proves*, and how an approval
*binds*.

It is pure: no I/O, no network, no implicit clock. A future real adapter — and an
Aria-originated request after the backend validates it — both reduce to this.

## One task model

The terminal, the website, and Aria drive the same `SharedTask`. There is no
"CLI task" versus "Aria task". Origin is metadata:

| Field | CLI-origin | Aria-origin |
| --- | --- | --- |
| `taskId`, `accountId`, `request`, `state`, times | required | required |
| `origin` | `'cli'` | `'aria'` |
| `deviceId`, `sessionId` | optional | optional |
| `conversationId` | absent | optional |

A task created directly in the CLI requires **no** Aria session, conversation id,
voice connection, or website session. Aria is additive.

## Event application rules

`applyEvent(projection, event)` folds one event and returns one of:

- `applied` — a newer event advanced the projection (and sets `partial` if it
  detected a sequence gap).
- `duplicate` — the same event id, *or* the same idempotency key, was already
  applied. No state change.
- `out_of_order` — the sequence is at or below the high-water mark. The newer
  state is preserved.
- `rejected` — the event belongs to another task, or the task is terminal.

Order of checks: identity → duplicate → stale → terminal → apply. A terminal task
is never reopened by a later event; a stale event never overwrites newer state.

Metadata events (`tool.completed`, `model.stream_ended`, …) never change
lifecycle state. An `approval.granted` acknowledgement never completes a task.

## Cancellation semantics

`requestCancellation` records that cancellation was *requested*. It moves a
running task to `cancelling`; it does **not** claim the work stopped. Only a
`task.cancelled` event sets `cancellation: 'confirmed'`.

If a `task.completed` event lands while a cancel was requested, the projection
records `state: 'completed'` and `cancellation: 'unknown'` — the task completed
and the request did not take effect. It is never reported as cancelled.

## Verification semantics

`applyVerification` accepts `confirmed` / `not_confirmed` / `inconclusive`. Only
`confirmed` marks the effect proven. A missing or unreadable check is
`inconclusive`, never `confirmed` — absence of evidence is not success.

## Approval binding

`assertApprovalBinding(approval, taskId, operationId, scope)` enforces that an
approval issued for one task, operation, and scope cannot be presented for
another. `isTextAnApproval` always returns `false`: a transcript, a model
message, or a tool result is not an approval object however it is worded.
`recordApprovalDecision` records the *user's* decision about an existing
approval; it can never create one, and an already-decided approval cannot be
re-decided.

## Routing and ownership

`canRouteToDevice` derives the decision from the verified account on both sides
plus revocation state. A device id supplied in a request is not authority. A
revoked device receives no new authorized work. `assertTaskOwnership` reports a
mismatch as not-found, so another tenant's task is not confirmed to exist.

## Privacy

`assertMetadataPayload` rejects a shared-metadata payload that carries
conversation content (`transcript`, `audio`, `rawPrompt`, `conversation`,
`messages`). Task and event metadata may sync; transcripts and audio stay in the
client's local store under its own retention policy. This is what keeps the
shared model from silently making every voice transcript persistent.
