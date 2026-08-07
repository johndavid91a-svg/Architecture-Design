# ADR-0003: Enforce geometry integrity at runtime, not only in the type system

- **Status:** Accepted
- **Date:** 2026-08-07
- **Deciders:** repository maintainers

## Context

The product's first non-negotiable requirement is that real architectural
dimensions are preserved. A design operation must never change geometry to make
a layout work: if a room is 15 × 20 ft, it stays 15 × 20 ft unless the user
explicitly authorises an architectural change.

This is the single most damaging failure the product can have. A design that
quietly widened a room by two feet invalidates every quantity derived from it,
and therefore the estimate the user is about to spend money against — while
looking entirely plausible on screen.

Marking the architecture types `readonly` prevents accidental mutation in code
we write. It does not survive a serialise / mutate / deserialise round trip, and
that is precisely the shape of every AI call: the twin goes out as JSON and
comes back as JSON, at which point `readonly` has been erased.

## Decision

Enforce the invariant at runtime with a geometry fingerprint.

Hash every dimension-bearing field of the architecture layer before an operation
and again after it. If the fingerprints differ and no
`ArchitecturalChangeAuthorisation` was supplied, throw and discard the result.
If an authorisation was supplied but `professionalReviewAcknowledged` is false,
still throw.

Quantise values to 0.1 mm before hashing, so floating-point noise from a JSON
round trip does not read as a geometry change.

Hash only geometry. Room names, uses, provenance notes and the entire design
layer are excluded, so legitimate design work passes cleanly.

## Options considered

### Option A — Runtime fingerprint (chosen)

Catches the mutation regardless of how it arrived: our code, an AI response, a
corrupted file, a future refactor. Costs one hash per operation over a structure
that is small relative to the AI call it guards.

### Option B — `readonly` types alone

Free, and adequate for code we control. Useless against the JSON round trip that
is the actual threat model. Rejected as insufficient rather than wrong.

### Option C — Deep-freeze the architecture object

Catches direct mutation and does nothing about a *replacement* object built from
parsed JSON, which is how an AI response arrives. Also imposes a permanent cost
on every read.

### Option D — Diff the two structures field by field

Equivalent in power to a fingerprint and considerably more code to keep correct
as the model grows. The fingerprint gets the same guarantee from one hash
function and one digest routine.

## Consequences

An unauthorised geometry change cannot reach the twin, and the failure is loud:
the operation is rejected and the caller keeps the pre-operation model. Silently
reverting was considered and rejected — it would leave the user with a design
whose visible intent no longer matches the model.

Every new dimension-bearing field must be added to the digest functions, or it
falls outside the guard. This is a real maintenance obligation and the reason the
digest functions live in one file with the invariant documented at the top.

The 0.1 mm quantisation means a change smaller than that is invisible to the
guard. That is intended: it is four orders of magnitude below any construction
tolerance.

Adding an authorisation is deliberately awkward — it requires naming what the
user was shown, who approved it and when, and acknowledging that architectural
changes need review by a qualified architect or engineer. Friction here is a
feature.

## References

- `packages/core/src/model/guard.ts`
- `packages/core/src/model/guard.test.ts` — eight tests, including the JSON
  round trip and the floating-point-noise case
- [DIGITAL_TWIN.md](../DIGITAL_TWIN.md)
