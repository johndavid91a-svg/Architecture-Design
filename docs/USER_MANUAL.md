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
Plan editing to match the real building is not yet implemented — see the
development plan.

## 2 — 2D Plan

Walls are drawn at true thickness. Doors are amber, windows blue, emergency exits
red. The grid is 1 m.

Click a room to select it. The panel shows its use, area, clear height, the
confidence of its dimensions, and **what fits here** — furniture and occupancy
capacity computed from the real area at conventional densities, with the density
stated so you can disagree with it.

## 3 — 3D Walkthrough

**Orbit** — drag to rotate, scroll to zoom.

**Walk** — click to capture the mouse, then <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd>
<kbd>D</kbd> or the arrow keys to move, <kbd>Shift</kbd> to run, <kbd>Esc</kbd> to
release the mouse. Eye height is 1,650 mm. Walls are solid — you cannot walk
through them. Switch floors from the panel.

The 3D model is generated from the same dimensions as the plan every time it
loads. There is no separate 3D file that can fall out of step.

## 4 — Quantities

Every line shows its **derivation**: the rule and the dimensions behind it. Use
it. A total that looks wrong is almost always one room measured wrong, and the
derivation column is how you find it.

**Consolidate by material** merges lines across rooms for procurement.

Some quantities are reported as gaps: reinforcement steel and foundation
concrete cannot come from a floor plan, because they depend on the structural
design. They are shown as gaps rather than approximated, because a rule-of-thumb
figure would look identical to a measured one in your BOQ.

## 5 — Estimate / BOQ

On first use nothing is costed, because no prices are on file. That is the
starting state, not an error.

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

## 6 — Themes

A theme is a specification: palette, role-keyed materials, lighting character,
signature elements with the reasoning behind them, and — most usefully — what to
avoid. **Show AI brief** displays the exact prose the design agents will receive.

## 7 — Price Sources

Every source the application is built to draw from, with its tier, what it is
legitimately good for, and its caveats. Read the caveats. FBR property valuation
in particular is *not* construction cost, and the two must never be summed.

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
