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
