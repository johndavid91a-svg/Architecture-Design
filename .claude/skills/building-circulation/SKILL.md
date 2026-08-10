---
name: building-circulation
description: Stairs, lifts, entrances and how a person moves through a building model. Use when a walkthrough cannot change floor, when an imported building has no vertical circulation, when the entrance is not findable in 3D, or when adding wayfinding, lift rides or floor isolation to a 3D view. Covers what a drawing import does and does not give you, honest inference of missing cores, and the rendering rules that make circulation legible.
---

# Circulation: getting into a building and around it

## What a drawing import actually gives you

| Element | IFC | DXF | PDF |
|---|---|---|---|
| Walls | Real entities | Inferred from line pairs | Inferred from line pairs |
| Rooms | `IfcSpace` | Traced faces | Traced faces |
| Doors | `IfcDoor` | Gaps in walls | Gaps in walls |
| **Stairs** | `IfcStair` | **Almost never** | **Almost never** |
| **Lifts** | Sometimes | **No** | **No** |
| **Which door is the entrance** | No | No | No |

The last three rows are the whole problem. A stair on a plan is a run of parallel
tread lines that **breaks every face around it**, so the recogniser usually
cannot close a room there and the word `STAIR` never lands inside a polygon. A
lift is a rectangle with a cross in it — indistinguishable from a duct. And no
format marks a door as *the way in*.

The consequence, if you do nothing: a nine-storey building imports with **no way
to get between its floors**. The walkthrough cannot change storey, the takeoff
misses a lift shaft's masonry on every floor, and nothing errors. That is the
worst failure mode this codebase has — a complete, confident, wrong model.

## Inferring what is missing, honestly

It is legitimate to add a stair and a lift to a multi-storey building that has
neither. It is **not** legitimate to let the user think they came off the
drawing. Both halves are required:

1. **Fit it to real space.** The core strip must be clear of rooms on **every**
   storey, not just the one you looked at. A lift shaft that lands on an office
   two floors up is not a lift shaft. Compare by bounding box, not exact polygon:
   a bounding box is never smaller than the room, so a position you accept is
   genuinely clear. Refusing a few L-shaped nooks is a far better failure than
   dropping a shaft through somebody's office.
2. **Prefer the centre.** A core belongs near the middle of the plan; that is
   also where it keeps travel distances shortest.
3. **Fall back visibly.** If nothing inside is free, abut the footprint and say
   `inside: false` so the caller can tell the user their staircase is hanging off
   the side of the building.
4. **Declare it.** Provenance `inferred` on every element, a `review`-severity
   issue (not `info`), and a remedy that tells them to drag it onto the real core.

Never do this for a single-storey building: a stair to nowhere is worse than no
stair.

## Finding the entrance

- Entrance level is the **lowest storey at or above ground**. A basement door is
  a car-park ramp, not the way a person arrives.
- A door in a wall marked `exterior` is an entrance.
- **If no wall declares itself exterior** — the normal case for a PDF import,
  where every wall is just a line — use doors within ~1 m of the footprint edge,
  and record that in `basis` so the UI can say which rule was used.
- Sort **widest first, emergency exits last**. On every real plan the main
  entrance is the widest opening in the front elevation.
- The **inward normal** is the one whose dot product with (plan centre − door) is
  positive. Getting the sign wrong drops the walker on the pavement.
- Scene Z is −plan Y. A plan inward vector `(ix, iy)` becomes yaw
  `atan2(ix, −iy)`. Flip that and the walker faces the door they just came
  through.

## Making circulation visible in 3D

The user complaint that drove this: *"while walking I can't see the stairs from
which I can move up and down, nor can I see the lift."*

- **Signs draw through walls.** `depthTest: false`, `depthWrite: false`, high
  `renderOrder`. This is deliberate, not a bug. In a real building you find the
  sign by walking; in a model you are trying to understand a plan, and seeing
  that the lift is behind that wall is the thing you came for.
- **Show only the current storey's signs.** Nine floors of through-wall labels is
  a wall of text. Entrance signs are the exception — keep them on whenever the
  entrance storey is visible.
- **A sign edge-on is a line.** Pair every sign with something that reads from
  above: a coloured mat on the ground at the entrance, a beacon column at a core.
- **Colour by kind**, consistently with the 2D plan: green stairs, blue lift,
  amber entrance, red exit.

## The lift must actually work

Two bugs to avoid, both of which look fine in a still screenshot:

1. **One car per storey.** Building the car inside each floor's group gives nine
   solid cars in a nine-storey shaft, none of them moving. **The car belongs to
   the shaft, not the storey.** Group landings within ~2 m of each other across
   floors into one shaft, build one car, park it at the lowest landing.
2. **Teleporting between floors.** Snapping makes the lift indistinguishable
   from a cheat key, and hides the thing a lift study is *for*: the time it
   takes. Ride it — doors ~1.1 s each way, car at ~1.2 m/s, ease in and out
   (a linear ramp is the one thing that reads as fake). Change the floor index
   **when the doors open**, not when the button was pressed. Disable WASD while
   travelling: a passenger is a passenger.

Build the car as a plate, a roof, three panels and a lamp — leave the fourth side
open. A closed box reads as a block; an open one reads as something you step
into. The lamp is also how you tell from outside which floor the car is on.

## Floor isolation

"Show me one floor at a time" is one function, not three: floor visibility, sign
visibility and lift-car visibility must all agree, or you get a `LIFT` sign
floating over a hidden storey. Watch for animation loops that reset
`group.visible = true` every frame — route them through the same function.

## Checklist

- [ ] Multi-storey import has a stair and a lift on **every** storey.
- [ ] The addition is reported at `review` severity with `inferred` provenance.
- [ ] `transportPoints` returns a landing per storey per core.
- [ ] The entrance faces the right way — walk through it and end up inside.
- [ ] One lift car per shaft, and it moves.
- [ ] Ride timing is wall-clock, not accumulated `dt` (a clamped `dt` makes
      duration depend on frame rate).
- [ ] Isolating a floor hides its neighbours' signs and cars too.
