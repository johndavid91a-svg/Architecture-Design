# Procurement engine

Status: the data model and the landed-cost machinery are implemented; the
supplier database, the alternatives search and the AI procurement assistant are
not. This document specifies them so the implementation has something to be
checked against.

## Multiple options, never one

Requirement 31: for every important material, offer alternatives rather than a
single choice.

```
Cement
  Economy   Brand X   PKR ?/bag   [price required]
  Standard  Brand Y   PKR ?/bag   [price required]
  Premium   Brand Z   PKR ?/bag   [price required]
```

The `Product` model already supports this — many products per material, each with
its own prices. What is missing is the UI for choosing between them and the
mapping from budget scenario to product, sketched as
`ScenarioProductChoice` in `estimate.ts`.

The comparison is meaningful because quantities are identical across scenarios:
same building, same takeoff, only the specification differs. That isolates the
effect of the choice.

## The alternatives query

"Find a cheaper alternative to this marble." "Find three local alternatives."
"Find a similar façade material under PKR X."

The assistant must return, for each candidate: product, specification, supplier,
source, price, required quantity, shipping, total cost, and an honest note on
quality difference. Two constraints:

**It may not invent a price.** If a candidate has no price on file, it is
returned as a candidate with a price gap, not with a plausible figure. The
procurement assistant is subject to the same rule as every other agent.

**It must state the quality difference.** "Premium Pakistani marble instead of
imported Italian" is a real saving and a real change. A recommendation that
mentions only the saving is a recommendation the user will regret at handover.

## Value engineering

`ValueEngineeringSuggestion` carries the current material, the alternative, the
quality impact, the visual impact, a recommendation strength
(`recommended` / `acceptable` / `last_resort`) and an **optional** saving.

The saving is optional on purpose. The agent proposes the substitution; the
estimation engine computes the saving from real prices afterwards. An agent
asserting a monetary saving is fabricating a price by another route, and it would
arrive wrapped in confident design rationale.

`last_resort` exists so the engine can offer a substitution it does not endorse —
grid ceiling instead of gypsum in a reception, say — flagged as such rather than
silently omitted or silently recommended.

## "Reduce this design's cost by 20%"

The intended algorithm:

1. Rank priced lines by contribution to total.
2. For each, find catalogue alternatives in the same material category with the
   same measurement basis.
3. Price the alternatives. Skip any that cannot be priced — do not estimate.
4. Compute the saving and assess quality and visual impact against the theme's
   stated identity and its `avoid` list.
5. Return an ordered set of substitutions reaching the target, or the closest
   achievable with an explicit statement of the shortfall.
6. **Never touch geometry.** Reducing cost by shrinking rooms is not value
   engineering; the guard would reject it in any case.

If the target is not reachable through specification alone, the correct output
says so and states what would have to change in scope. Quietly producing a 12%
saving against a 20% request is the failure mode to avoid.

## Supplier evaluation

Never on price alone. `Supplier` carries location, categories, rating, years
active, certifications, currency and last-checked date.

A supplier two months old, with no certifications and the lowest price, is a risk
the lowest price does not compensate for — particularly on an import, where a
short shipment cannot be topped up locally.

## Quotation upload

Planned: accept PDF, Excel, CSV, image or an invoice, extract product, quantity,
unit, price, supplier and date, and record each line as a Level 3 price.

Two requirements on the implementation:

- **Extraction is a proposal.** Every extracted line is shown for confirmation
  before it becomes a price record. An OCR misread of a decimal point is a 10×
  error in a cost the user will act on.
- **Parsing runs in the main process.** A supplier PDF is untrusted input and
  must never be parsed by code holding renderer privileges. See
  [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Price refresh

"Refresh market prices" runs the configured connectors and **appends** records.
It never overwrites. History is preserved, so the price-trend view is possible
and an estimate the user already approved keeps its basis.
