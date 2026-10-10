# Aria <-> Directioner-CLI contract boundary

This document is the narrative companion to
`common/src/directioner/aria-contract.ts`. The code is the source of truth for
the compatibility matrix; this file explains what was verified and what was
wrong in the earlier revision.

## Correction

An earlier revision of this boundary concluded that Aria had **no wire
contract**, and mirrored the backend's `src/contracts/aria.ts` baseline
(`{contractVersion:"1.0.0", requestId, kind, payload}`). Both halves of that were
wrong:

- It inspected only Aria's **default branch**, whose tip is a Python "Stage 0"
  voice pipeline (`aria/core/**`). That lineage is real, but it is not Aria's
  native product.
- Aria's native lineage is Rust, on `stage-2-native-desktop` and
  `feature/phase-4-conversational-ai` (`crates/aria-backend/src/contract.rs`).
  There Aria **does** define a network contract.
- The baseline it mirrored was itself authored without Aria and has been removed
  from the backend. Aria has never spoken that shape.

## Aria's real contract (verified 2026-10-09)

Repository `aditya-munday/Aria`, branch `feature/phase-4-conversational-ai`:

| Rule | Value |
| --- | --- |
| Path prefix | `/v1` (not `/api/v1`) |
| Version field | `contract_version` is the **integer** `1` |
| Version mismatch | hard error, never a silent downgrade |
| Capabilities | `GET /v1/capabilities`; accents are objects `{tag}` |
| Chat | `POST /v1/chat` -> `{contract_version, text, route?}` |
| Chat stream | `POST /v1/chat/stream`; incremental NDJSON deltas; `is_final` ends the stream |
| Error body | flat `{contract_version, code, message}` |
| Auth | `Authorization: Bearer <user session token>`; the token is never a provider key |
| Delegation | a `RouteDto {capability, requires_confirmation}` hint; the `DirectionerGateway` port's only production impl is `NotIntegrated` |

The backend mirrors this contract at `src/modules/aria/contract.ts` and serves
it at `/v1` (`src/modules/aria/routes.ts`).

## What the CLI does with it

`aria-contract.ts` gates on the integer version, recognises the capabilities,
chat, and error shapes, and reconstructs a chat stream. A stream with no final
event is treated as incomplete, mirroring Aria's own rule that an unfinished
stream is an error rather than a short reply.

## Compatibility matrix

The matrix in the module is restated against Aria's real contract. Dispositions:
`VERIFIED_IMPLEMENTED`, `IMPLEMENTED_BUT_PARTIALLY_VERIFIED`,
`DESIGNED`, `PLANNED`, `BLOCKED_BY_EXTERNAL_DEPENDENCY`. No row is
`VERIFIED_IMPLEMENTED` because the backend is not deployed end-to-end.

## The rules this boundary encodes

1. **Text is never authority.** A transcript, model text, tool result, or route
   hint never authorizes anything.
2. **Aria is optional.** A task created directly in the CLI needs no Aria
   session, conversation id, voice connection, or website session.
3. **A device id is not an access token.** Ownership is resolved server-side
   from the verified principal.
4. **No invented wire fields.** The CLI gates on Aria's real integer version and
   endpoint shapes, not on the removed baseline envelope.

## How to regenerate the report

`ariaCompatibilityReport()` returns the machine-checkable summary
(`verifiedConcepts`, `blockedConcepts`, the full matrix).
`common/src/directioner/__tests__/aria-contract.test.ts` asserts the matrix is
complete, that nothing blocked is claimed implemented, and that the fabricated
envelope is refused.
