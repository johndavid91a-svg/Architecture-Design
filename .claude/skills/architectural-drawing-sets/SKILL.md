---
name: architectural-drawing-sets
description: How a real architectural drawing set is organised, and how to turn one into a building model. Use when importing or interpreting PDF/DXF/IFC drawing sets, deciding which sheets are floor plans, mapping sheet names to storey levels, or debugging why an import produced the wrong number of floors. Covers sheet families, storey vocabulary (including South Asian terms like mumty and marla), garbled CAD fonts, and multi-scale sheets.
---

# Reading an architectural drawing set

## The mistake that costs the most

**A page is not a floor.** This is the single most damaging assumption available,
because it produces a complete, confident, wrong building instead of an error.

A real set of 56 sheets contained **nine** floor plans. The rest were a title
sheet, a drawing index, a 3D visualisation, a site plan, eight structural grid
sheets, eight opening plans, eight area-block plans, two elevations, four
sections, and details. Treating each page as a storey produced a 52-storey tower
stacked at 11 ft intervals from a 9-storey building.

Before anything else: **classify the sheets, then choose one family, then map
each chosen sheet to a storey.** Never `level: pageIndex`.

## Sheet families

A set is organised in families, each covering the same storeys. The title is
almost always the largest text on the sheet.

| Family | Title pattern | What it is | Use for the model? |
|---|---|---|---|
| Layout plan | `<STOREY> FLOOR LAYOUT PLAN` | Dimensioned general arrangement | Good |
| Working plan | `WORKING PLAN (<STOREY> FLOOR)` | The definitive construction plan, with room names | **Best** |
| Opening plan | `OPENING PLAN (<STOREY> FLOOR)` | Same plan, annotated with door/window types | Good for openings |
| Grid & beam | `GRID & BEAM LAYOUT PLAN (<STOREY>)` | Structural grid and beams | No — no rooms |
| Area block | `AREA BLOCK PLAN (<STOREY>)` | Single outline with a covered-area figure | No — one rectangle |
| Elevation | `FRONT/REAR/SIDE ELEVATION` | Vertical face | No — not a plan |
| Section | `SECTION AT A-A` | Vertical cut | No — not a plan |
| Detail | `(STAIR DETAIL)`, `KITCHEN SECTION` | Enlarged fragment | No |
| Schedule | `SCHEDULE OF OPENINGS` | Table | No |
| Index / title / 3D / site | — | Front matter | No |

**Prefer working plans.** They carry room names (`HALL`, `LOBBY`, `STAIRS`,
`LIFT`, `BALCONY`, `MACHINE ROOM`) which is what makes the imported rooms
meaningful rather than `Room 1 … Room 20`. Fall back to layout plans, then
opening plans.

Never mix families: a working plan and an area block plan of the same storey are
two drawings of one floor, and importing both creates a duplicate storey.

## Storey vocabulary and ordering

Storeys are named, not numbered, and the ordering is domain knowledge:

```
BASEMENT   -1     (also LOWER GROUND)
GROUND      0
MEZZANINE   1     a partial floor over the ground floor — often half its area
FIRST       2
SECOND      3
THIRD       4
FOURTH/4TH  5
MUMTY       6     South Asia: the small enclosure at the head of the stair
                  giving roof access. It is a real, small storey — not the roof.
ROOF        7     usually a plan of the roof itself, not habitable
```

Watch for:

- **`4TH` and `FOURTH`** both appear, sometimes in the same set.
- **Mumty** (also *mumty room*, *stair mumty*) is standard in Pakistan and India
  and is genuinely a storey, typically only a stair head and a machine room.
- **Mezzanine** usually covers only part of the floor below it. Its area is
  legitimately smaller, and a coverage check that expects full floor plates will
  read that as an error when it is not.
- **Top roof / upper roof** may exist above mumty on a tall plot.

## Garbled titles: a subset font with no ToUnicode map

A CAD exporter often embeds a subset font with a custom encoding and **no
`ToUnicode` CMap**. pdf.js then returns raw glyph codes, and a sheet title comes
out as mojibake while its neighbours read fine:

```
"7+,5')/225/$<2873/$1"   ->   "THIRD FLOOR LAYOUT PLAN"
```

This is a constant offset — here every character is 29 below its real code point.
**Do not hardcode the offset.** Recover it by searching for the shift that turns
the string into recognisable architectural vocabulary (`FLOOR`, `PLAN`, `LAYOUT`,
`SECTION`, `ELEVATION`, `BASEMENT`, `GROUND`, `MEZZANINE`, `MUMTY`), and accept
the result only if it does. A shift that produces nothing recognisable must be
rejected, not applied hopefully — a mis-shifted title silently mislabels a
storey.

Spaces frequently do not survive the shift, so match on letters only.

## Scale

A CAD-plotted PDF usually records its own plotting scale in a `/VP` viewport
dictionary — the `/C` factor inside the `/X` number format, in real-world units
per point. That is what the plotter wrote down and is far better than a printed
"1:100" note, which describes the original plot and is wrong the moment anyone
re-plots to another sheet size.

Three traps, all silent:

1. **`/C` is not the first `/C`.** `/Measure` holds `/A` (area) and `/D` first,
   both equal to 1. Read from inside `/X`.
2. **A sheet-wide viewport** covering the whole media box describes the
   title-block border, not the drawing. Measured: 1:56.6 where the drawing was
   1:34 — a 66% error. Discard any viewport covering ~the entire page.
3. **Sheets with two scales** — a key plan beside a main drawing, a section stack
   at three factors. One number cannot describe such a sheet; refuse it and say
   why rather than picking one.

Real sets are plotted *fit to page*, so recorded scales are values like 1:25.8,
1:33.9, 1:117.5. **Never snap to a standard ratio** and never assume one scale
for the whole document.

## What a PDF cannot give you

A DXF carries layers, so planting, furniture, dimensions and annotation can be
separated from building fabric by name (see `classifyLayer`). **A PDF has no
layers.** Every stroke is just a stroke, so hatching, furniture, dimension lines
and text outlines all look like walls to a pair-parallel-lines recogniser.

Measured on a real sheet: the longest recognised walls were 64 ft and 50 ft — the
building's true dimensions — but the *median* recognised wall was 0.6 ft, and
rooms came out at 11–55 sq ft. **Wall runs and overall extents from a PDF are
usable. Room areas are not.** Say so rather than shipping the numbers quietly.

If room areas matter, ask for the DXF or IFC export of the same project.

## Order of work when an import looks wrong

1. Dump the largest text on every page — that is the sheet title. One command
   tells you what the set actually contains.
2. Classify into families. Count how many sheets are floor plans.
3. Check the storey mapping, including the awkward ones (mezzanine, mumty, 4TH).
4. Only then look at geometry quality.

Steps 1–3 take minutes and catch the errors that produce a confidently wrong
building. Step 4 is where the hard, slow work is.


## The drawing checks your work — use it

A real set states its own covered area. This one carries a sheet headed
`SCHEDULE OF COV. AREA`:

```
PLOT SIZE & AREA           =  40'x45' (1800 sft)
BASEMENT FLOOR COV. AREA   =  1717.34 Sft
GROUND  … MEZZANINE … 4TH  =  1717.34 Sft each
MUMTY FLOOR COV. AREA      =   458.56 Sft
TOTAL COV. AREA            = 12845.94 Sft
```

**Read it, and compare it against what you traced.** It is the only ground truth
a PDF import has, and it is worth more than any internal plausibility check. On
this set the recogniser produced 21–976 sq ft for storeys stated at 1,717.34 —
wrong by up to a factor of eighty — and every other check passed, because the
model was internally consistent and consistently wrong.

Two rules:

- **Pair the label to the figure by position, not by reading order.** `LABEL`,
  `=` and `1717.34 Sft` arrive as three separate text runs, and PDF reading order
  is whatever the exporter emitted. A two-column schedule interleaves and silently
  attaches the wrong number to a storey.
- **Allow a real gap.** Covered area is measured to the *outside* of the external
  wall and includes shafts; a sum of traced room polygons is measured to the
  *inside* faces. 10–20% apart is normal. A factor of two is not a measurement.

Also on the same sheet family: `AREA BLOCK PLAN (<STOREY>)` states one covered
area per storey, so a set gives you the figure twice over.

## Hatching will destroy a floor plate, quietly

The covered-area block on this set is filled with 45° hatching: ~50 parallel
diagonals, each **46 ft long, 9 in apart**, running clean across the plate. Every
one paired into a 10-inch "wall". The face tracer then found the triangles
between them, so a 1,717 sq ft floor came back as eight slivers totalling 186.
Nothing errored.

- **A length threshold cannot catch it.** Those hatch lines are longer than any
  wall in the building.
- **A stroke-weight filter cannot catch it either** — measured across every
  weight on the sheet, the best any threshold recovered was 15% of the stated
  area.
- **Regularity is what separates them.** A wall is a *pair* of parallel lines a
  wall-thickness apart; occasionally four for a cavity. A hatch is a *family* of
  six or more at a constant pitch, each many times longer than the gap to its
  neighbour. Require both the family size and the length-to-pitch ratio (≥8), or
  you will delete a row of real partitions.
- **Allow a missing line.** A hatch region clipped by the plate edge, or two
  hatched areas overlapping, leaves gaps that are whole multiples of the pitch.
  Insisting on strictly equal consecutive gaps splits the family in two and lets
  both halves through.

## What a dense PDF plan can and cannot give you

Measured against this file, honestly:

| Thing | Result |
|---|---|
| Page count, sheet classification | **Correct** — 56 sheets, every family right |
| Storey names and order | **Correct** — Basement → Mumty → Top Roof |
| Per-page plotting scale from `/Measure` | **Correct** — 1:33–1:36, consistent across plans |
| The drawing's stated areas | **Correct** — read straight off the schedule |
| Room polygons and their areas | **Wrong** — 1–57% of stated. Do not cost from them |

Say this. An import that hands over a storey stack, correct names and the
architect's own figures, while stating plainly that the traced room areas are
unusable, is worth far more than one that quietly reports 21 sq ft as a floor.


## Getting rid of what is not the building

Measured on the working plans of the real set: **~2,400 segments per sheet, of
which roughly 30 are walls.** Four rules, in this order, take the wall count from
about 850 per storey to about 280. None of them is a threshold on length; every
one keys on something the drawing itself says.

1. **Crop to the measurement viewport.** `/VP` gives a `/BBox` alongside the
   `/Measure` factor, and that box *is* the drawing — everything outside it is
   the frame, the title block and the consultant's address. **Inset the box by
   about 1%, do not pad it**: the frame is ruled on the viewport boundary, and
   kept, it pairs into a 62 ft rectangle of "wall" enclosing the whole building.
   Cropping also stops title-block cells closing as rooms — an imported floor
   came back with spaces named `DHA` and `N.T.S`.
2. **Drop hatch families** (see above).
3. **Drop line work off the plan's own axes.** Find the dominant direction by
   *length-weighted* histogram folded into [0°, 90°); if ≥70% of length lies
   within a few degrees of one direction and its perpendicular, the plan is
   orthogonal, and anything else is poché, a section arrow, a break line or a
   leader. This is what catches the hatch *inside* walls, which the family rule
   cannot: a 9-inch wall filled with diagonals has a length-to-pitch ratio of
   about three, where an area fill has sixty.
4. **Drop unpaired lines with a measurement written along them.** A wall does not
   have `25'-2"` printed on it. Apply to unpaired lines only, so a recognised
   pair can never be deleted.

### The ordering trap

**Run the hatch rule before the axis rule.** The axes are elected by line length,
and an area fill carries more line length than the building under it — so on raw
line work the vote elects the hatch's own 45° as the plan's axis and throws away
every wall. Getting this backwards turned a passing fixture into `floor: null`.
Order is the whole safeguard, and it deserves a test of its own.

### What still does not work

Even with all four, the face tracer does not close the rooms of a dense
commercial plan. On the set measured here the storeys come out at 0–70% of their
stated covered area. The remaining causes are ordinary drawing conventions that
survive every rule above — grid and centre lines drawn as separate dashes rather
than with a PDF dash pattern (so `mergeCollinear` welds them into convincing
40 ft "walls" straight across a hall), and corners where paired centrelines stop
short of meeting.

**So do not promise room areas from a PDF.** Promise the storey stack, the storey
names, the wall run, and the drawing's own stated areas — and let the
covered-area cross-check refuse the rest out loud.
