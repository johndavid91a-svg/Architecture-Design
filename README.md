# Architecture Design

A home for this project's architecture: the decisions behind it, the shape of the
system, and the diagrams that explain it.

## Layout

```
docs/
├── adr/            Architecture Decision Records — why we chose what we chose
├── architecture/   System overviews, component docs, data flows
└── diagrams/       Source files and exports for diagrams
```

## Architecture Decision Records

An ADR captures a single significant decision: the context that forced it, the
option chosen, and the consequences accepted. They are immutable — when a
decision changes, write a new ADR that supersedes the old one rather than
editing history.

To add one:

1. Copy `docs/adr/template.md` to `docs/adr/NNNN-short-title.md`, where `NNNN`
   is the next number in sequence.
2. Fill it in and set the status to `Proposed`.
3. Once agreed, change the status to `Accepted` and add it to
   [`docs/adr/README.md`](docs/adr/README.md).

Start with [ADR-0001](docs/adr/0001-record-architecture-decisions.md), which
records the decision to keep ADRs at all.

## Diagrams

Prefer diagrams that live in version control as text — [Mermaid](https://mermaid.js.org/)
renders natively on GitHub and diffs cleanly. See
[`docs/diagrams/README.md`](docs/diagrams/README.md) for conventions.

## Where to start

If you are new to the system, read
[`docs/architecture/system-overview.md`](docs/architecture/system-overview.md)
first, then skim the accepted ADRs in order.
