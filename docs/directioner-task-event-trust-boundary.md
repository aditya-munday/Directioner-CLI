# Directioner-CLI task / event / approval trust boundary

The invariant: **receiving an event or an approval never executes anything, and
an approval is authority only within its task, operation, scope, grant state,
and lifetime.** The shared task model (`common/src/directioner/shared-task-model.ts`)
is the pure, provider- and client-neutral core a CLI task, the website, and Aria
all reduce to; this audit covers the assurance that untrusted event data cannot
become authority.

Measured on `directioner/security-task-event-boundary` (stacked on
`directioner/shared-task-model`; see that PR for the base model).

## What the model already guarantees (re-verified)

Proof is `common/src/directioner/__tests__/shared-task-model.test.ts` (real code
path, no mocks): **43 pass / 0 fail / 91 expect** after this pass.

| Rule | Function |
| --- | --- |
| Direct CLI work is first-class; no required Aria session | `createSharedTask` |
| Ownership derives from a verified account, not a request field | `assertTaskOwnership` |
| Device routing derives from verified account + revocation, never a device id | `canRouteToDevice` |
| An event applies at most once (id *or* idempotency key) | `applyEvent` |
| A stale event never overwrites newer state | `applyEvent` |
| A terminal task cannot be reopened by a later event | `applyEvent` |
| A cancellation *request* is not proof the work stopped | `requestCancellation` |
| An acknowledgement is not a result | `applyEvent` (`approval.*` never completes) |
| Absence of evidence is not success | `applyVerification` |
| Receiving an event never executes anything | no executor in the module |
| Conversation content is rejected from the metadata stream | privacy gate |

## Finding this prompt closed

### F3 — the approval gate checked binding but not grant state or expiry

**Attack surface.** `assertApprovalBinding(approval, taskId, operationId, scope)`
answered "does this approval authorize this operation" from three fields only:
task, operation, and scope.

**Why it is a boundary crossing.** An `ApprovalRecord` carries `decision`
(`'granted' | 'denied'`), `decisionSource`, and `expiresAt`, but the gate never
consulted them. So a record whose `decision` was **denied** and one whose
`expiresAt` had **passed** both returned `{ ok: true }`. A pending or spent
approval — or a record whose `expiresAt` was edited — authorized an operation as
readily as a live grant. This is exactly the "acknowledgement is not a result"
family: the gate accepted the *shape* of an approval without checking that it
was actually a live authorization.

**Reproduction (before the fix).** `assertApprovalBinding({ ...approval,
decision: 'denied' }, 'task_1', 'op_1', 'service:nginx.service')` returned
`{ ok: true }`; so did the same call with `expiresAt` in the past.

**Fix.** The gate now also requires:

- `decision === 'granted'` (otherwise `not_granted`);
- `clock.now` not after `expiresAt` (otherwise `expired`).

The clock is a **required, caller-supplied** `TrustedClock`. It must come from
the caller's own wall clock, never from a timestamp inside the event or approval
being judged — otherwise the input could keep a stale approval alive by moving
"now" itself. The two new deny reasons extend `ApprovalBindingResult`.

**Regression tests.** Five added cases in `shared-task-model.test.ts`: pending /
denied approval refused (`not_granted`), expired grant refused (`expired`), a
forged far-future `expiresAt` still refused against the trusted clock, a plain
grant valid at the clock accepted, and an approval with no expiry not treated as
already expired. The four pre-existing binding tests were updated to pass the
clock.

## Trust-boundary table

| Input | May it authorize? | Enforced by |
| --- | --- | --- |
| User text ("yes, go ahead") | No (`isTextAnApproval` → `false`) | model + test |
| A model message / transcript | No | not an `ApprovalRecord` |
| A tool result | No | not an `ApprovalRecord` |
| Event `payload` claiming approval | No | `applyEvent` has no executor |
| `approval.granted` event alone | No — cannot complete a task | `applyEvent` |
| A denied approval record | No (`not_granted`) | **this pass** |
| An expired approval record | No (`expired`) | **this pass** |
| An approval for another task/operation/scope | No | pre-existing |
| A device id supplied in a request | No — routing uses verified account | `canRouteToDevice` |
| A replayed / stale event | No — idempotent + order-aware | `applyEvent` |
| A later event on a terminal task | No | `applyEvent` |

## Known limitations

- The model is deliberately pure: it has no executor, so "receiving an event
  never runs anything" is true by construction, not by a check that could be
  bypassed. A future real adapter must keep execution in the operation boundary,
  not in this reducer.
- Expiry comparison uses `Date.parse`; an unparseable timestamp is treated as
  *not* expired. Timestamps are expected to be ISO-8601 from the backend. A
  malformed timestamp should be rejected upstream rather than silently accepted.
- This pass hardened the client-side model. The backend is the ultimate
  authority for issuing approvals; this is the client half of the same rule.
