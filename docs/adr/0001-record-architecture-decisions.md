# ADR-0001: Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-08-07
- **Deciders:** repository maintainers

## Context

Architectural decisions get made in chat threads, calls, and review comments.
The decision survives in the code, but the reasoning does not. Months later
someone asks "why is it built this way?" and the honest answer is that nobody
remembers — so the choice either gets cargo-culted forward or reversed without
knowing what it was protecting against.

The expensive part is not the decision. It is re-deriving the constraints that
produced it.

## Decision

We will record significant architectural decisions as Architecture Decision
Records, stored as Markdown in `docs/adr/` and reviewed through the same
process as code.

A decision is significant enough for an ADR if reversing it would be
disruptive — anything that touches a public interface, a data model, a
dependency the system is hard to remove, a security or privacy boundary, or a
deployment topology.

ADRs are append-only. Superseding a decision means writing a new ADR and
marking the old one `Superseded by ADR-NNNN`, never rewriting it.

## Options considered

### Option A — ADRs in the repository (chosen)

Lives beside the code, versions with it, and is reviewed in pull requests where
the relevant people already are. Plain Markdown, so there is no tooling to keep
alive. The cost is discipline: nothing forces an ADR to be written.

### Option B — A wiki or shared document store

Easier to write and link, and friendlier to non-engineers. But it drifts from
the code, has no review gate, and access tends to decay as tools get replaced.

### Option C — No formal record

Zero overhead, and adequate for a small team that never changes. It fails on
exactly the case the record exists for: someone new asking why, after the
people who know have moved on.

## Consequences

Decisions become reviewable artifacts, and onboarding gains a chronological
narrative of how the system reached its current shape. Revisiting a decision
starts from written constraints rather than reconstruction.

In exchange, every significant change carries a small writing cost, and the
record is only as good as the habit. An ADR set that stops being updated is
worse than none, because it looks authoritative while being stale — so treat a
missing ADR on a significant change as review feedback.

## References

- Michael Nygard, [Documenting Architecture Decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
