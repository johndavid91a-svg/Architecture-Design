# User manual

## What this application does

It builds a measured model of a real building, shows it in 2D and 3D, derives
the quantities of material and labour the building needs, and costs them against
prices you supply or fetch — with every figure traceable to where it came from.

## What it will not do

It will not invent a price. If a rate is not on file, the line stays in your bill
of quantities marked as a gap and stays out of the total, and the total is
labelled *at least*. This is deliberate, and it is the most important thing to
understand before using it: a smaller number that looks complete is worse than a
larger number that admits what is missing.

## 1 — Project

Enter the building's real measurements.

- **City** selects the regulatory reference: Islamabad → CDA, Rawalpindi → RDA.
- **Clear height** is floor to ceiling, not floor to floor.
- **Rooms** accept `15`, `15ft`, `15'`, `15' 6"`, `4572mm` or `4.5m`. Unsuffixed
  numbers are read as feet. A dimension the application cannot read turns the
  field red and blocks creation — it will not guess, because a misread dimension
  corrupts every quantity and cost downstream of it.
- Area updates live as you type, so a typo is visible before you commit to it.

**Create digital twin** builds the 2D plan, the 3D model and the takeoff.

Rooms are laid out in a strip with real partitions between them. The
*dimensions* are exact from that moment; the *arrangement* is a starting point.
Move it onto the real building in the 2D plan, which is editable.

## 2 — 2D Plan

Walls are drawn at true thickness. Doors are amber, windows blue, emergency exits
red. The grid is 1 m.

Click a room or a wall to select it. A selected room shows its use, area, clear
height, dimension confidence, and **what fits here** — furniture and occupancy
capacity from the real area at conventional densities, with the density stated so
you can disagree with it.

### Editing

Editing is locked until you tick the acknowledgement in the top-left panel.
Changing a wall in the model is not the same as changing it on site, and the tool
will not let you forget that.

Once unlocked:

- **Drag** a room or wall to move it. Snaps to 3 in.
- **Resize** a room by typing new dimensions. Its walls move with it.
- **Wall panel** sets thickness, the load-bearing flag, and adds or removes doors
  and windows.
- **Undo / Redo** for every change.

Some edits are refused, and the reason appears bottom-left. These are not bugs:

- *Widening a room whose side is a partition shared with the next room.* Moving
  it would change the neighbour's size without changing the neighbour's outline,
  and the two would disagree from then on. Move the partition itself instead.
- *Shortening a wall past a door it carries.* The door would end up off the wall.
  Move or delete the opening first.
- *Deleting a load-bearing wall.* That is a structural decision, not a plan edit.
- *Overlapping two openings on one wall.* Unbuildable, and it double-deducts from
  the masonry quantity.

## 3 — 3D Walkthrough

**Orbit** — drag to rotate, scroll to zoom.

**Walk** — click to capture the mouse, then <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd>
<kbd>D</kbd> or the arrow keys to move, <kbd>Shift</kbd> to run, <kbd>Esc</kbd> to
release the mouse. Eye height is 1,650 mm. Walls are solid — you cannot walk
through them. Switch floors from the panel.

The 3D model is generated from the same dimensions as the plan every time it
loads. There is no separate 3D file that can fall out of step.

## 4 — Design

**Apply a theme** is instant and needs no API key. It assigns finishes from the
theme's materials, sizes lighting to an illuminance target for each room's use,
and lays out furniture — through the same clearance validator that AI proposals
face. Anything that could not be placed is listed rather than forced in.

Apply as a **new option** to keep the previous design for comparison, or to the
**current design** to overwrite it.

**AI Interior Designer** needs an Anthropic API key. Set `ANTHROPIC_API_KEY` or
save one in the panel; it is written to your user-data directory and never into a
project file, because project files get copied and emailed.

Pick a room, type an instruction, and run it. The transcript shows every round:
the proposal is validated against the real room, and if the furniture does not
fit or a material id does not exist, the model is re-prompted with the exact
measurements that failed. After three failed rounds nothing is applied and your
previous design is untouched — that is the intended outcome, not an error.

## 5 — Options

Every option shares one architecture, so a cost difference between two of them is
entirely the effect of specification. Use, duplicate or delete any option. The
**before / after** picker shows exactly which lines account for the difference
between two designs, largest first.

## 6 — Quantities

Every line shows its **derivation**: the rule and the dimensions behind it. Use
it. A total that looks wrong is almost always one room measured wrong, and the
derivation column is how you find it.

**Consolidate by material** merges lines across rooms for procurement.

Some quantities are reported as gaps: reinforcement steel and foundation
concrete cannot come from a floor plan, because they depend on the structural
design. They are shown as gaps rather than approximated, because a rule-of-thumb
figure would look identical to a measured one in your BOQ.

## 7 — Estimate / BOQ

On first use nothing is costed, because no prices are on file. That is the
starting state, not an error.

### Importing a price list

**Choose a CSV price list** parses a supplier's file, infers the columns, and
matches each description to a catalogue material. Every row is shown with its
match confidence and any problems found — and **nothing is recorded until you
press the button**. A misread decimal point is a 10× error in a figure you will
act on, and it is invisible once it is a number in a table. Rows it cannot read
cleanly are flagged, never guessed at.

**Download a template** gives you a file to send a supplier so the next list
imports without corrections.

### Recording a price

- **Supplier quotation (Level 3)** — a quotation you are looking at. Recorded as
  verified today, and it outranks every published average, because it is what you
  will actually pay.
- **My own estimate (Level 4)** — anything from memory. Permanently reported at
  LOW confidence. The distinction is what stops a guess reading like research
  three months later.

Always fill in **brand / grade**. A rate without a grade cannot be compared
against a quotation that states one.

Wage rates are entered the same way. Worker-days are already known from the
model — only the money is missing, and an unpriced trade still shows its effort.

### Reading the result

- **At least** rather than **Total** means lines are excluded. The true cost is
  higher.
- **GAP** on a row means it could not be priced. Hover for what to do about it.
- **HIGH / MEDIUM / LOW** is derived from the source tier and the age of the
  figure. It decays on its own: a quotation past its validity window stops
  counting, and stale prices are excluded rather than silently reused.
- **Contingency** and **budget scenario** are yours to set. Contingency is always
  shown separately, never folded in.

**Export BOQ as CSV** writes all thirteen columns plus totals, completeness, the
assumptions and the professional-review notice.

## 8 — Sourcing

**Local versus imported** computes a real landed cost. Enter the ex-works price,
quantity, exchange rate and the duty rates for your PCT code. Nothing is
pre-filled: duty rates are code-specific and change with each Finance Act, so a
rate baked into the application would be wrong within months and wrong invisibly.

The breakdown shows the cascade — duties on CIF, sales tax on the duty-paid
value, withholding on the tax-paid value. Enter your local price for the same
quantity and the verdict is computed. When local wins, it says so.

**Value engineering** finds cheaper substitutions, but only where both the
current material and the alternative are actually priced. Each suggestion states
what is lost in quality and in appearance, and a swap that is sensible in a store
room is demoted when it lands in a reception. Set a target saving and it will
tell you plainly if specification alone cannot reach it.

## 9 — Regulation

Enter the parameters for your plot from the applicable CDA or RDA bye-laws — the
view links to them. Nothing is pre-filled, because bye-laws vary by sector, plot
category, land use and zone.

There is no "pass" in this view. A check either raises an observation or stays
silent, and silence means "nothing detected against the figures you entered", not
"compliant". Parameters you leave blank are listed under **Not checked**.

## 10 — Themes

A theme is a specification: palette, role-keyed materials, lighting character,
signature elements with the reasoning behind them, and — most usefully — what to
avoid. **Show AI brief** displays the exact prose the design agents will receive.

## 11 — Price Sources

Every source the application is built to draw from, with its tier, what it is
legitimately good for, and its caveats. Read the caveats. FBR property valuation
in particular is *not* construction cost, and the two must never be summed.

## Report

**Preview** renders the document; **Export PDF** writes the same document through
the same engine, so the file cannot disagree with what you saw. It includes the
cover with the headline figure and its caveat, captured plan and 3D views, design
rationale, areas, the cost summary, option comparison, the full bill of
quantities with its gaps, labour, optional regulation observations, the
assumptions, and the professional-review notice.

If the estimate is incomplete the report says so on the cover and shows the total
as *at least*. A report that hid that would be the most dangerous thing this
application could produce.

## Saving

**Save project** writes a JSON document to your user-data directory. It is
readable, diffable and yours; copy it, back it up, send it to a colleague.

## Before you rely on any of this

This is a design and estimation aid. It is not a certified quantity survey, a
structural design, an MEP design, a fire-safety assessment or a regulatory
approval, and it does not replace a licensed architect, structural engineer, MEP
engineer or quantity surveyor.

Quantities come from your model and the stated assumptions. Prices carry the
source, date and confidence shown against each line — verify them before
committing funds. Any regulatory observation is an indication only and confers no
approval.
