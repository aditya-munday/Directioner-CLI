# Cross-client conformance

`common/src/directioner/testing/` contains the test-only conformance harness
(`cross-client-conformance.ts`) and its cases
(`cross-client-conformance.test.ts`). It wires the shared task/session/event
model to the in-memory reference transport so cross-client behaviour can be
exercised deterministically without a backend.

It lives under `directioner/testing/` on purpose: production code must not import
it, and the reference-transport isolation guard skips this directory.

## What these tests prove — and what they do not

They prove **contract and lifecycle correctness**: idempotency, ordering,
authority boundaries, cancellation semantics, and failure recovery. They do
**not** prove model intelligence. There is no fabricated provider response
pretending the system reasons well about arbitrary tasks.

## Cases

| # | Case | Asserts |
| --- | --- | --- |
| A | Direct CLI task | A task is created and progressed with no Aria session/conversation. |
| B | Aria-originated task | An Aria-origin request maps to the same shared model and lifecycle. |
| C | Cross-account denial | A task cannot be read or routed outside the authenticated account. |
| D | Device revocation | A revoked device cannot receive new authorized work (`DEVICE_REVOKED`). |
| E | Duplicate task request | A retried request reusing an idempotency key does not create a second transition. |
| F | Duplicate event | The same event twice does not double-apply. |
| G | Out-of-order events | A stale sequence does not overwrite newer state. |
| H | Cancellation race | Cancel vs complete resolves to a defined, truthful state (completed + unknown cancellation). |
| I | Approval spoofing | Text claiming approval is not authority. |
| J | Expired/mismatched approval | An approval cannot transfer across task, operation, or scope. |
| K | Lost connection | A sequence gap marks the stream partial; a cloud failure on sync is "queued", not "ok". |
| L | Resume | A completed task is not re-run by a replayed start event. |
| M | OS unavailable | The client reports unsupported/unavailable rather than inventing an outcome. |
| N | Malformed payload | A payload smuggling conversation content is refused. |
| O | Missing contract feature | An unsupported feature returns a specific not-integrated result. |

## Running

```bash
bun test common/src/directioner/
```

The harness names the reference transport in comments only; the isolation guard
(`reference-transport.test.ts`) scans production roots for the transport filename
and my case files avoid that literal in importable positions.
