---
name: drawing-annotation
description: How to read the text on an architectural drawing — room names, tags, dimensions, levels, grid bubbles — and turn it into model data. Use when naming imported rooms, deciding what a string on a sheet means, debugging why spaces imported as "Room", or extending the space-name vocabulary. Covers the Pakistani/South Asian drawing vocabulary (HALL, MUMTY, DRAWING ROOM, WUDU), label-to-space assignment, and the strings that must never become names.
---

# Reading the writing on a drawing

A plan tells you what its spaces are. It writes `HALL` in the middle of the hall,
`KITCHEN` in the kitchen, `W.C.` in the lavatory. Losing that is throwing away
the most useful thing on the sheet.

## The failure this exists to prevent

A user imported a real 56-sheet set and got a floor of spaces every one of which
was called **"Room"**. Their reaction was the correct one: *"there are no rooms,
it's only a hall — there's a kitchen — you have written Room."*

Two separate defects produced that, and both are easy to reintroduce:

1. **A label counted only if its insertion point fell strictly inside the traced
   polygon.** Traced faces are inset by half a wall thickness, labels sit near
   walls, and a space traced in fragments has its one label inside only one
   fragment. Real names that were plainly on the sheet were dropped.
2. **Anything unlabelled was called "Room."** That is a name which appears on no
   drawing and is indistinguishable from one that was read. It converts *"we
   could not read this"* into *"this space is called Room"*, which is a lie the
   user cannot detect.

**Rule: never invent a name.** An unnamed space is called `Unnamed space`, and the
count of named-versus-unnamed is reported as an import issue. A user who sees
"11 of 30 spaces took their name from the sheet" knows exactly where they stand.
A user who sees thirty rooms called "Room" does not.

## Assigning labels to spaces

The assignment is **competitive**, so do it for all spaces at once, never one at
a time:

1. **Inside wins.** A label whose point falls inside a space belongs to that
   space. If a space holds several strings, take the one with the largest text —
   a plan writes the name larger than the area note beneath it.
2. **Nearby, but only if unclaimed.** A space with no label of its own may take
   the nearest label that *no space contains*, within 2 m of its boundary. The
   "unclaimed" condition is what stops a space stealing its neighbour's name.
3. **Otherwise, say nothing.** `Unnamed space`, `use: other`, and the provenance
   note records that the drawing wrote no name there.

The 2 m budget is chosen against the geometry: it covers the inset and a
fragmented trace, and it is shorter than the width of a corridor, so it cannot
reach across one into the next room.

**Scale both.** The label arrives in page points; the boundary is in millimetres.
Applying `toMmScale` to one and not the other puts every label outside every
room, and the symptom — *everything is called "Room"* — looks identical to having
no text at all.

## Strings that are not names

A commercial sheet is dense with plausible-looking strings sitting inside rooms.
Every one of these must be rejected before it can become a space name:

| Kind | Examples | Pattern |
|---|---|---|
| Dimensions | `6000 x 4000`, `12'-6"`, `3.65 m` | digits, quotes, ×, unit suffix |
| Door/window tags | `D1`, `W-04`, `V3`, `DW2` | `^[DWV]{1,2}[-\s]?\d{1,3}[a-z]?$` |
| Grid bubbles | `A`, `7` | a single character |
| Levels / spot heights | `+3.60`, `FFL 0.00`, `-1.20` | optional `FFL/SFL/FL`, signed number |
| Sheet furniture | `SCALE 1:100`, `DRAWN BY`, `REV`, `NTS`, `NORTH` | keyword list |
| Sheet titles | `GROUND FLOOR PLAN`, `SECTION A-A`, `LEGEND` | keyword list |
| Anything with no letters | `—`, `1:100` | no `[A-Za-z]` |

A space called `D1` is worse than a space called nothing.

## The vocabulary that matters here

This app is for Pakistan and India. A generic Western room list reads almost none
of the following, and each one carries a different use, finish and cost:

| On the drawing | What it is | `RoomUse` |
|---|---|---|
| `HALL`, `MAIN HALL` | The main open space — often the *whole* floor plate of a plaza | `open_office` |
| `DRAWING ROOM` | Formal sitting room. **Not** a studio, **not** a bedroom | `living` |
| `TV LOUNGE` | Family sitting room | `living` |
| `MUMTY` | Stair head enclosure giving roof access. A real storey | `stair` |
| `ZEENA` | Staircase | `stair` |
| `WUDU` | Ablution area beside a prayer room | `toilet` |
| `W.C.`, `BATH`, `POWDER` | Lavatory | `toilet` |
| `SERVANT ROOM`, `QUARTER` | Staff accommodation | `bedroom` |
| `DRESS`, `DRESSING` | Dressing room | `store` |
| `PANTRY`, `CROCKERY` | Serving store | `pantry` |
| `PORCH`, `PORTICO` | Covered arrival | `lobby` |
| `SHOPS`, `GENERAL STORE` | Retail | `retail` |
| `GEN. SET`, `WATER TANK`, `PUMP` | Services | `plant` |
| `CAR PORCH`, `RAMP` | Parking | `parking` |
| `DINNING` | Common misspelling of dining — match it | `dining` |

### Ordering is load-bearing

The patterns are tested in order and the first match wins, so the table must run
most-specific first:

- `DRAWING ROOM` **before** any pattern containing `ROOM`, or every sitting room
  becomes a bedroom.
- `SERVANT ROOM` and `STORE ROOM` **before** `ROOM`.
- `MUMTY` and `STAIR` **before** anything else, because those words appear inside
  other names.
- `LOWER GROUND` before `GROUND` (that one lives in the sheet classifier, same
  principle).

Getting the order wrong mislabels spaces **silently**. Test the order explicitly;
do not assume it.

## Where the text comes from

- **DXF**: text is a `TEXT`/`MTEXT` entity on its own layer, with a real height.
  This is by far the most reliable source. If room names matter, ask for the DXF.
- **PDF**: text arrives from pdf.js as positioned runs. Two hazards — a subset
  font with no `ToUnicode` map returns raw glyph codes (see
  `architectural-drawing-sets` for the Caesar-shift recovery), and CAD exporters
  frequently emit one run per character, so *collapse whitespace before matching*.
- **Scanned PDF**: there is no text at all. Say so; do not OCR silently.

## Checklist before claiming the reader works

- [ ] Run it against a real set and **count** how many spaces were named.
- [ ] Look at the names, not the count — `D1` and `+3.60` passing the filter is a
      pass on count and a failure in fact.
- [ ] Check that no space took a name that belongs to the space next door.
- [ ] Check the unnamed ones really are unnamed on the sheet.
- [ ] Confirm nothing is called "Room".
