# The digital twin

The twin is the master record of a real building. Everything else in the
application — the 2D plan, the 3D model, the quantity takeoff, the bill of
quantities, the cost — is a view of it or a computation over it.

## Two layers, and why they cannot be one

```
ARCHITECTURE LAYER                     DESIGN LAYER
measured, protected                    styled, freely changeable
─────────────────────                  ────────────────────────
site, plot boundary                    floor / wall / ceiling finishes
building footprint                     colours and materials
floors, levels, heights                furniture placement
rooms (polygons)                       lighting
walls (centreline + thickness)         ceiling treatment
doors, windows, openings               façade system
columns, beams                         signage
stairs, lifts                          landscaping
```

The design layer holds no room or wall geometry of its own. It references
architecture entities by id and attaches appearance and content to them.

Two things follow. Five design options over one building share one architecture,
so generating alternatives is cheap and comparing their costs is meaningful —
the quantities are identical and only the finishes differ. And a design
operation *structurally cannot* move a wall, because there is no wall geometry
in the design layer to move.

Furniture is the single exception: it is design-layer content that occupies real
space, so it carries a placement. That placement is validated against the
architecture rather than being free to overlap it.

## The integrity guard

Requirement: the AI must never change architectural geometry to make a design
prettier. If a room is 15 × 20 ft it stays 15 × 20 ft unless the user explicitly
authorises an architectural change.

TypeScript's `readonly` prevents honest mistakes. It does not survive the
serialise / mutate / deserialise round trip, which is the exact shape of every AI
call: the twin goes out as JSON and comes back as JSON. So the guard that
actually holds the line is a runtime one.

**Mechanism.** Before an operation, hash every dimension-bearing field of the
architecture layer. After it returns, hash again. Differ without an
authorisation, and the operation is rejected outright — the caller keeps the
pre-operation twin and the AI is told what it did wrong.

```
┌── withArchitecturalIntegrity ──────────────────────────────┐
│  fingerprint(before)                                       │
│         │                                                  │
│         ▼                                                  │
│    run operation  ─────────▶  { architecture, result }     │
│         │                                                  │
│         ▼                                                  │
│  fingerprint(after)                                        │
│         │                                                  │
│    before == after ? ──── yes ──▶ accept                   │
│         │                                                  │
│         no                                                 │
│         │                                                  │
│    authorisation present, and professional review          │
│    acknowledged?  ──── yes ──▶ accept                      │
│         │                                                  │
│         no ──▶ throw ArchitecturalIntegrityError           │
└────────────────────────────────────────────────────────────┘
```

**What is hashed.** Room boundary polygons in order, clear heights, wall start
and end points, thickness, height, function, load-bearing flag, every opening's
position, size, sill and emergency-exit flag, column positions and sizes, stair
geometry, floor levels and elevations, the building footprint and the plot
boundary.

**What is not hashed.** Room names, uses, purposes, provenance notes, and the
entire design layer. Renaming a room or applying marble flooring leaves the
fingerprint untouched, so legitimate design work passes cleanly.

**Quantisation.** Values are rounded to 0.1 mm before hashing. Without this, a
JSON round trip that turns 4572 into 4571.9999999999995 would read as an
unauthorised change and block a perfectly good design. 0.1 mm is far below any
construction tolerance, so a genuine change is never masked by it.

**Authorisation.** An `ArchitecturalChangeAuthorisation` names the project, what
the user was told they were approving, optionally the specific rooms and walls in
scope, who approved it and when — and carries
`professionalReviewAcknowledged`. A change authorised without that
acknowledgement is still refused. Scoping ids matters: an authorisation to move
the reception partition should not be spendable on relocating a structural
column.

## Dimension provenance

Every dimension carries how it was arrived at:

| Confidence | Meaning |
| --- | --- |
| `measured` | From a survey or a dimensioned drawing, entered by the user |
| `verified` | Read automatically and confirmed by the user |
| `extracted` | Read automatically and **not** yet confirmed |
| `inferred` | Filled in to close a gap, e.g. a wall implied by adjacent rooms |

`extracted` exists so drawing import can be honest. A vectoriser that reads
fifty dimensions off a scanned plan will read some of them wrong, and the
correct product behaviour is to surface those for verification rather than to
present them as measured. The 2D plan shows the confidence for the selected
room.

## Walls: centrelines, not polygons

A wall is a centreline plus a thickness. That is what drawings dimension, what
IFC stores, and what makes junctions resolvable; the polygon is derived for
rendering.

Room boundaries are **finished faces**, and wall centrelines sit outside them by
half a thickness. Putting the centreline on the room boundary instead would make
the inner half of every wall fall inside the room, and furniture pushed against a
wall would read as intersecting it. This was a real bug during the initial build.

Openings are positioned by distance along their host wall, measured from the
wall's start point to the opening's centre — not in world coordinates — so an
opening cannot drift off its wall when the wall is edited.

## Rooms: the polygon is authoritative

A room entered as "15 ft × 20 ft" becomes a four-point polygon of exactly
4572 × 6096 mm. Every derived area is computed from that polygon rather than
from the typed numbers, so a room and its takeoff can never disagree — including
after the user reshapes the room in the 2D editor.

## Versioning

Designs are immutable once saved. "Option B" in a cost comparison must still
mean what it meant when its cost was calculated. Each design records its origin:
manual, AI (with the instruction and the model id), theme-applied, imported or
duplicated. That is the audit trail behind any design in a client presentation.
