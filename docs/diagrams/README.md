# Diagrams

## Conventions

**Prefer text over binaries.** Mermaid renders natively in GitHub Markdown,
diffs line by line in review, and never goes stale in a way nobody can fix
because the original `.drawio` file was on someone's laptop. Reach for an image
only when the diagram genuinely cannot be expressed as text.

**Embed rather than link.** A diagram in a fenced ```mermaid block inside the
document it explains gets read. One behind a link does not.

**One diagram, one question.** A diagram that answers "what talks to what" and
"how does a request flow" at the same time answers neither well. Split it.

**Label the edges.** An unlabelled arrow between two boxes says two things are
related, which the reader already assumed. Say what crosses it — a protocol, a
payload, a direction of trust.

## Levels

Loosely following [C4](https://c4model.com/), which is worth adopting for the
vocabulary alone:

- **Context** — the system as one box, and everything it talks to. Suitable for
  people who will never read the code.
- **Container** — deployable units: services, databases, queues, front ends.
  The most useful level for most readers.
- **Component** — the inside of one container. Write these only where the
  internal structure is genuinely non-obvious.

Code-level diagrams are deliberately not included. They are generated more
reliably from the code than maintained by hand.

## If a binary is unavoidable

Commit the editable source alongside the export — `foo.drawio` next to
`foo.png` — so the next person can change it. An export with no source is a
diagram that will be wrong forever.
