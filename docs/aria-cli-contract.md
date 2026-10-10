# Aria ⇄ Directioner-CLI contract boundary

This document is the narrative companion to
`common/src/directioner/aria-contract.ts`. The code is the source of truth for
the compatibility matrix; this file explains what was actually verified and what
is still missing.

Status: **partial and explicit**. No concept is claimed fully verified, because
the shared backend is not deployed and Aria has no wire contract yet.

## What Aria actually is (verified 2026-10-10)

- Repository: `aditya-munday/Aria` (GitHub, private).
- Language: **Python** (`aria-voice`, package `aria.core.*`), not Rust.
- Stage: **Stage 0** — a deterministic, headless voice pipeline over a WAV
  fixture with stubbed STT / reasoning / TTS, no audio hardware, no display, no
  provider keys.
- There is **no** network task/session/envelope contract, and **no**
  `aria-backend::contract` module or `docs/BACKEND-CONTRACT.md`. Those were a
  design proposal, not this repository.
- The `aria.core.intent.directioner_client` module that earlier documents
  describe was **removed**; `tests/security/test_stage0_security_boundary.py`
  asserts the module no longer exists and that no `execute_intent` symbol
  remains.

Aria's absolute rule, enforced by that same security test: Aria never executes
OS actions, imports no capability daemon, and constructs no `CapabilityKind`. It
may only produce draft proposals.

### Aria facts that are real

| Area | What exists |
| --- | --- |
| Pipeline events | `aria/core/pipeline/events.py` — in-process `PipelineEvent` hierarchy on an asyncio `EventBus` (wake / VAD / STT / LLM / TTS / state). Not a wire protocol. |
| Pipeline state | `aria/core/pipeline/state.py` — `PipelineState`, `AssistantMode`. Local only. |
| Memory | `aria/core/memory/schema.py` — SQLite: `conversation_history`, `user_facts`, `user_preferences`, `intent_audit_log`, with eviction bounds and a `clear_all_memory()` purge. |
| Intent audit | `intent_audit_log(intent_id, intent_type, risk_level, payload_json, confirmed_by_user, status)` — an audit row, not an authorizing object. |

## Where the shared contract actually lives

The shared network contract is in the backend repository
`aditya-munday/Directioner-Platform-Backend`:

- `src/contracts/aria.ts` — contract-version compatibility rule.
- `src/contracts/aria-envelope.ts` — the wire envelope.
- `src/modules/tasks/task.ts` — task status vocabulary and transitions.
- `src/modules/database/repositories/task-repository.ts` — tasks table with
  optimistic concurrency.
- `src/modules/approvals/approval.ts` — the approval object.
- `src/modules/auth/device.ts`, `session.ts` — device/session identity.
- `src/modules/security/authorize.ts` — tenant isolation.
- `src/modules/system-authority/operations.ts` — the OS-operation allowlist.

That repository marks its Aria fixtures as **BASELINE — requires reconciliation**
(`contracts/aria/README.md`), because no Aria wire contract existed when they
were authored. The CLI mirrors the *rules* and records the Aria side as
unverified.

## Compatibility matrix

| Concept | Aria actual | CLI actual | Required change | Verification | Source | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| identity (account/user) | none | `AccountId`/`UserId` types | both authenticate via backend; server-side principal | backend auth tests | Aria stage0 | BLOCKED |
| device registration | none | `DirectionerDevice` types | register per installation; id is never a token | `assertDeviceOwnership` tests | backend `auth/device.ts` | DESIGNED |
| session | in-process state only | `DirectionerSession` types | backend session; revocation validated server-side | session validator tests | backend `auth/session.ts` | BLOCKED |
| task | none | `DirectionerTask` + state machine | one shared logical task; CLI-origin metadata optional | tasks table + mapping | backend `tasks/task.ts` | IMPL/PARTIAL |
| task status vocabulary | none | `TaskState` | tested mapping; partial direction explicit | mapping tests | backend `tasks/task.ts` | IMPL/PARTIAL |
| events / streaming | in-process `PipelineEvent` | `TaskEvent` append-only + sequence | do not unify; shared stream is the backend journal | transport tests | Aria `pipeline/events.py` | DESIGNED |
| actions | none | tool/command event types | coordinated via task/events; OS holds authority | Aria security test | Aria security test | DESIGNED |
| approvals | audit boolean | `ApprovalRequest`/`ApprovalRecord` | shared approval object bound to one operation | transport approval tests | Aria `memory/schema.py` | IMPL/PARTIAL |
| results / verification | none | `OperationOutcome` + verdicts | never "done" on acknowledgement alone | verification tests | CLI platform-contract | IMPL/PARTIAL |
| cancellation | none | `cancelTask` + states | request ≠ proof stopped; define authoritative state | race tests | CLI reference transport | IMPL/PARTIAL |
| reconnection / sync | none | `syncEvents` queued-vs-done | resume by sequence cursor without replay | reconnect tests | CLI reference transport | IMPL/PARTIAL |
| audit references | audit rows | `CorrelationId`/`EventId` | one propagated correlation id across components | system-authority tests | backend `system-authority` | DESIGNED |
| wire envelope | none | mirror of backend gate | reconcile the baseline fixture against Aria's real contract | fixture test (not yet possible) | backend `contracts/aria/README.md` | BLOCKED |
| content retention | SQLite history + purge | `DataClassification` | metadata may sync; transcripts/audio must not | no transcript on `TaskEvent` | Aria `memory/schema.py` | DESIGNED |

Dispositions: `VERIFIED_IMPLEMENTED`, `IMPLEMENTED_BUT_PARTIALLY_VERIFIED`
(`IMPL/PARTIAL`), `DESIGNED`, `PLANNED`, `BLOCKED_BY_EXTERNAL_DEPENDENCY`
(`BLOCKED`). No row is `VERIFIED_IMPLEMENTED` because the backend is not
deployed.

## The rules this boundary encodes

1. **Text is never authority.** A transcript saying "yes", model text, a tool
   result, or a website parameter never authorizes anything.
2. **Aria is optional.** A task created directly in the CLI needs no Aria
   session, conversation id, voice connection, or website session.
3. **A device id is not an access token.** Ownership is resolved server-side
   from the verified principal.
4. **No invented wire fields.** The CLI does not call its own baseline
   Aria-compatible.

## How to regenerate the report

`ariaCompatibilityReport()` returns the machine-checkable summary
(`verifiedConcepts`, `blockedConcepts`, the full matrix). The test suite
`common/src/directioner/__tests__/aria-contract.test.ts` asserts the matrix is
complete and that nothing blocked is claimed implemented.
