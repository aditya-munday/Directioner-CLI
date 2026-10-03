# Directioner client-contract completeness audit

State as of commit `23ae1944f` on `rebrand/beyonders-full`. This is a factual
inventory of what exists in the tree — not a roadmap and not a claim that the
hosted Directioner backend has been started. It does not.

## 1. The contract itself

`common/src/directioner/platform-contract.ts` (575 lines) is the provider-neutral
interface (`DirectionerClient`). It is **declared, not implemented**: there is no
HTTP client and nothing in the file connects to anything. That is intentional —
the hosted backend is explicitly out of scope.

Contract surface, by section:

| Area | Declared | Notes |
| --- | --- | --- |
| Identity / session | `authenticate`, `pollDeviceAuthorization`, `registerDevice`, `getAccount`, `getSession`, `logout`, `isDeviceActive` | device-authorization flow; no pasted secrets |
| Entitlements | `getEntitlements` | cache, never authority |
| Model service | `requestModelService` | capability request; client never names a provider |
| Tasks | `createTask`, `sendTaskInput`, `getTask`, `getTaskEvents`, `cancelTask` | monotonic `sequence` journal |
| Approvals | `submitApproval` | decision-only; a client cannot create an approval |
| Sync | `syncEvents` | `queued` is never reported as `done` |

Supporting types: the `DirectionerErrorCode` taxonomy + `recoveryForError` /
`classifyError`; `TaskState`; `TaskEventType`; `DataClassification`;
`OperationOutcome<T>`; `SyncState`.

## 2. Executable check of the contract

Because there is no backend, the contract's properties are exercised by a
test-only reference transport under `common/src/directioner/testing/`:

- `reference-transport.ts` implements **every** `DirectionerClient` method.
- `reference-transport.test.ts` proves the properties the real adapter must also
  satisfy: explicit lifecycle transitions (invalid ones rejected as
  `TASK_STATE_INVALID`), append-only monotonic events, idempotent approval
  decisions that cannot be forged or widened, and a sync path that reports
  `queued` rather than `done` when the cloud is unreachable.

Current result: **33 pass / 0 fail** across the two contract test files.

## 3. What the client-contract suite does NOT prove

Passing these tests does **not** prove model intelligence or agent quality. It
proves transport, error taxonomy, retry classification, streaming
normalization, and provider-neutrality. Real agent-quality evaluation requires a
real or explicitly configured provider (see the provider-coverage notes) and is
tracked separately.

## 4. Gaps toward §17 (contract completeness)

Honest remaining gaps, none of which require the hosted backend:

1. **No production adapter.** By design: the backend does not exist. The
   reference transport is the only implementation and is test-only (enforced by
   an isolation test).
2. **Provider-coverage matrix** for the client transport is exercised with a
   deterministic mock (scenarios A–Q) and the native Anthropic path; it does not
   yet drive *real* provider processes for every configured provider.
3. **Agent-quality evaluation** is not wired to a capable provider in CI.
4. **Performance instrumentation** is not yet measured for the provider path.

Items 2–4 are the remaining Run-3 engineering work; none claims to be complete.
