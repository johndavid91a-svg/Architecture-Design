# Storey inspection

Every storey isolated and photographed, from above and from inside, using
`tools/walk-storeys.mjs` and `tools/ui-journey.mjs --inspect`.

This exists because every judgement about how the building looked had come from
one orbit view of the whole stack — and that is the view that hides everything.
At that distance a floor with no internal walls, a camera pointing at nothing,
and a room finished correctly all look identical.

**Four defects were found by looking, none of which any check had caught.**

## What the looking found

### 1. The camera never re-framed on an isolated storey — FIXED

Picking a floor hid the others and left the camera exactly where it was. Zoomed
in, the ground floor filled the frame with one wall; the third floor came back
**completely black**. Both storeys were rendering perfectly the whole time, off
to the side of the lens.

The failure mode is the dangerous kind: an empty black viewport looks exactly
like a broken renderer, and a wall filling the frame looks like a modelling
error. Neither was true.

Isolating a floor now re-frames on it. Orbit only — someone walking has put
themselves somewhere on purpose.

### 2. The mumty had no internal walls at all — FIXED

The water tank, the lift machine room, the bath and the store were **floor
patches on an open terrace**. The mumty had four walls, its shell, and nothing
else. The drawing shows all four rooms built, and from the terrace they are the
only thing standing on it — the elevation calls the mumty the building's crown.

4 walls to 28.

The doorways are deliberately NOT there. This model has not read the mumty's
door positions off the sheet, and the four invented to make the rooms enterable
all swung into the terrace furniture — a water tank room opening through a run
of planters. Inventing an opening so a check passes is the worst possible reason
to place a door.

### 3. Arriving at a stair faced the wall behind it — FIXED

"Go to stairs" faced a fixed direction per kind — out of a lift, up a stair — on
the assumption that every core sits the same way round. It does not. On the
upper floors that put the walker nose-first against a blank pier, one flat
surface filling the whole screen. It now turns to face the middle of the storey,
which always has something to look at.

### 4. The inspection tool ignored its own `--design` flag — FIXED

`walk-storeys.mjs` parsed `--design`, printed the path as though it had loaded
it, and photographed **seven storeys of bare architecture**. The status line read
"0 furniture item(s) from the design layer" in all 36 images.

A flag that is accepted and ignored is worse than one that does not exist: it
produced a complete, plausible, wrong answer. The only reason it was caught was
reading a status line in the corner of one photograph. It now refuses the flag
and exits non-zero.

## Storey by storey, as photographed

| Storey | Reads correctly | Notes |
|---|---|---|
| Ground | yes | Double-height hall, glazing both sides of the entrance, reception and waiting group. |
| Mezzanine | yes | The black area is the VOID, not a hole — 397 sq ft of floor with the rest open to the hall below, exactly as the sheet has it. |
| First — GIS | yes | 16 workstations back to back, map wall on the east, terrain model, manager's suite enclosed. |
| Second — Imagery | yes | Same bones as floor 1 with the globe and satellite plinths. |
| Third — Data centre | yes | 14 racks in two rows with a hot aisle, console facing the status wall, plant in the old kitchen. |
| Fourth — Executive | yes | Four suites at the corners, boardroom across the middle, lounge south of it. |
| Mumty — Sky garden | yes | Paved terrace, PV and condensers on the west strip, tea counter, lounge, planting to the east parapet. |

## Still open, and not guessable from here

- **The mumty's door positions.** On the sheet, unread.
- **The balcony dimension.** Labelled on four sheets, dimensioned on none.
  10'-6" x 4'-6" was measured off the line work.
- **Rates for six finishes.** See `procurement-open-items.md`.
- **The data centre's cooling and power load.** An MEP question.
- **The qibla bearing.** A sample for Islamabad, not surveyed on this plot.
- **`walk-storeys.mjs` photographs architecture only.** Installing a design
  means driving the app's designer channel, which `ui-journey.mjs` does; the two
  do not share it yet.
- **Sections A-A to D-D, the rear elevation and the structural grid sheets** are
  read but unused. They would confirm beam depths and column positions
  independently of the floor plans.
