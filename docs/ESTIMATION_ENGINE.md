# Estimation engine

Two stages: derive quantities from the model, then apply rates to them. They are
separate because they fail differently — a quantity can be wrong because the
model is wrong, a cost can be wrong because the price is stale — and mixing them
makes both unfixable.

## Stage 1 — Quantity takeoff

`packages/core/src/takeoff/takeoff.ts`

Every line carries a `derivation`: the rule and the dimensions it consumed. A
quantity surveyor's first question about any number is where it came from, and a
number that cannot answer cannot be checked, defended or corrected. It is also
how a user finds the one mis-measured room behind a total that looks wrong.

### Rules

| Quantity | Rule |
| --- | --- |
| Floor area | Room polygon area |
| Ceiling area | Room polygon area |
| Internal wall area | Room **perimeter** × clear height, less openings |
| Wall finish with height limit | As above, scaled by limit ÷ clear height |
| Skirting | Room perimeter less door and archway widths |
| Doors, windows | Counted from openings |
| Glazing area | Σ width × height over window openings |
| Window frame | Σ 2 × (width + height) over window openings |
| Masonry volume | (length × height − openings) × thickness, per wall |
| Light fittings | Σ counts from the design layer |

**Why wall area uses the room perimeter, not the sum of bounding walls.** Wall
centrelines are shared between adjacent rooms. Summing them double-counts every
partition. The room polygon is the finished face — exactly the surface being
plastered, painted or clad.

**Opening deduction threshold.** Openings below roughly 0.5 m² are not deducted
from plaster and paint. This is standard trade practice: the labour of working
around a small opening offsets the material saved, so deducting it understates
the cost.

### Quantities the engine refuses to guess

Reinforcement steel and foundation concrete are reported as gaps with
`basis: 'requires_engineering'` and a quantity of zero.

A floor plan does not contain the structural design — member sizes, spans, loads,
bar schedules. A kg-per-square-foot rule of thumb would produce a number that
looks identical to a measured one in the BOQ, and that is the problem. The gap
carries what input is needed instead.

### Quantity basis

| Basis | Meaning |
| --- | --- |
| `measured_from_model` | Computed from twin geometry |
| `derived_with_coefficient` | Geometry plus a conventional coefficient |
| `counted_from_model` | Counted elements |
| `user_supplied` | Entered because the model cannot supply it |
| `requires_engineering` | Cannot be determined; reported, never guessed |

## Stage 2 — Cost build-up

`packages/core/src/estimate/estimate.ts`

```
net quantity  (installed)
    × (1 + wastage)          → procurement quantity   ← what you buy
    × material rate          → MATERIAL COST

net quantity  (installed)
    × worker-days per unit   → worker-days per trade  ← what you install
    × daily wage rate        → LABOUR COST

MATERIAL + LABOUR
    + transport      (fraction of material, or explicit freight)
    + equipment      (fraction of labour: scaffolding, plant)
    = SUBTOTAL
    + contingency    (user-set: 5 / 10 / 15 / custom %)
    = TOTAL
```

**Wastage applies to material, never to labour.** You buy 330 sq ft of tile to
lay 300; nobody is paid to lay the 30 sq ft of offcuts. Getting this backwards
overstates labour by the wastage fraction on every finishing trade.

Default wastage encodes conventional trade allowances and is shown to the user
rather than applied invisibly: slab stone 15% (cuts worse, needs matching),
ceramic and porcelain tile 10%, gypsum 12%, paint 10%, cement 3%.

**Material and labour never merge.** Requirement 40, and the reason it matters
is that a composite rate hides which half moved when a total changes.

## Labour model

`packages/core/src/estimate/labour.ts` separates two things that are routinely
conflated:

**Productivity coefficients** — worker-days per unit, by trade. Physical and
organisational facts that vary by site and crew but not by market date. Shipped
as documented, editable assumptions, and every estimate that uses them lists them
on its assumptions page. Examples: one tile worker with a helper lays about
120 sq ft/day; slab stone about 80; plaster about 150 sq ft per mason-day; paint
about 250 sq ft per painter-day across primer and two coats.

**Wage rates** — what a mason costs per day in Rawalpindi this month. These are
prices. They are **not** shipped. They come from the price repository with a
source, a date and a confidence, or the labour line is reported as unpriced.

Conflating the two is how an estimating tool ends up quietly asserting a wage.

### Crew planning

Worker-days aggregate by trade, then divide into a suggested crew size and
duration. It is a resourcing estimate, not a programme: it assumes the work is
divisible and the crew continuously available, and says so.

## Completeness

The engine returns `complete: false` whenever any line is unpriced, along with
`completeness` (priced lines ÷ all lines) and the unpriced lines themselves. The
UI must not present `total` as final in that state — it shows **at least**.

Lines are unpriced when:

- no price is on file for the material
- every price on file is stale
- **no material is assigned to the quantity** — a bare masonry volume or a floor
  area before a finish is chosen. Costing these at zero made an empty estimate
  report 76% complete during the build; it is now a gap.
- a trade's wage rate is missing (worker-days still reported)
- the quantity requires engineering input

## Budget scenarios

`ECONOMY`, `STANDARD`, `PREMIUM`, `LUXURY`, `CUSTOM`. The scenario is passed to
the price resolver, which selects a different product for the same material. The
quantities are identical across scenarios — same building — so the comparison
isolates the effect of specification alone.

## Assumptions

Every estimate returns the assumption strings behind it: the productivity figures
used, the contingency, the transport and equipment fractions, and an explicit
statement when lines are excluded. These appear in the UI and in the CSV export.
An estimate whose assumptions are not visible cannot be argued with, and an
estimate that cannot be argued with is not useful to a quantity surveyor.
