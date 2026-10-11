# The privileged-operation boundary

How a privileged remediation is authorized on the CLI side, and why it refuses
far more often than it agrees. Implemented in
`common/src/directioner/operation-boundary.ts`.

## 1. The rule

Text is never authority. A model, a repository file, an MCP server, or a tool
result can **request** an operation. None of them can **authorize** one.

An operation runs only when all of the following hold:

1. It is well-formed (validated against a per-action argument shape).
2. An `OperationApproval` **object** is present.
3. The approval's `operationId` equals the request's.
4. The approval's `fingerprint` equals the request's canonical fingerprint.
5. The approval's `scope` equals the request's scope.
6. The approval is not expired (an unparseable expiry fails closed).
7. A separate `ConsentDecision` is present, `granted`, and from `user` or
   `policy` — never `timeout`, never a tool result.

Every other path is a named denial and the executor is never reached.

## 2. Why a fingerprint

The fingerprint is the canonical, deterministic identity of an operation:

```
operationFingerprint({ program, action, args })
  = [program, action, ...args].map(p => `${p.length}:${p}`).join('|')
```

Length-prefixing means argument boundaries cannot be confused: `['a','b']`,
`['ab']`, and `['a|b']` all produce different fingerprints. The authorization
system computes the same string for the operation it approves. Equality is the
binding check.

This is what stops a confused deputy: an approval the user granted for
"restart nginx" cannot authorize "restart sshd" or "disable nginx", because the
fingerprint differs. Tests cover exactly that replay.

## 3. Allowed operations

| Action | Program | Arguments |
| ------ | ------- | --------- |
| `service.restart` | `/usr/bin/systemctl` | one unit name (`*.service|socket|target|timer`) |
| `service.start` | `/usr/bin/systemctl` | one unit name |
| `service.stop` | `/usr/bin/systemctl` | one unit name |
| `module.load` | `/usr/sbin/modprobe` | one module name |
| `module.unload` | `/usr/sbin/modprobe` | `-r` then one module name |
| `module.unload` | `/usr/sbin/rmmod` | one module name |
| `kernel.parameter.set` | `/usr/bin/sysctl` | one `key=value` |

Arguments are passed to `spawn` as an array with no shell; the per-action shape
constrains meaning, and the coarse gate rejects control characters and absurd
length.

## 4. Honest verification

A completed operation returns `verificationRequired`: the diagnostic probes
that would confirm the effect (e.g. re-run `service.status` and expect
`activeState=active`). It never returns a success claim. `compareVerification`
compares a before/after pair and returns:

- `confirmed` — both sides readable and the expected finding is gone;
- `not_confirmed` — the expected finding is still present;
- `inconclusive` — either side was unreadable.

"Inconclusive" is not "confirmed". Absence of evidence is not evidence of
success.

## 5. What is not implemented

The executor. On Directioner-OS it is backed by `ai-capabilityd`; today there is
no such broker. The client boundary is real and tested against a fake executor;
it holds no privilege itself and cannot perform any of the operations above.
This is deliberate: the safe state before the broker exists is to refuse.

## 6. Tests

`common/src/directioner/__tests__/operation-boundary.test.ts` — 27 cases:
validation (arity, program/action pairing, argument shapes), the authority and
binding matrix (no approval, missing/wrong fingerprint, wrong scope, expired,
forged, non-user consent, explicit denial), execution honesty, fingerprint
canonicalization, and verification comparison.
