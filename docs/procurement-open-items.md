# Materials that need a quotation

Six finishes the concept boards call for are now real catalogue lines and are
being **measured**. None of them is **priced**, and this note says exactly why,
what was searched, and who can quote.

Nothing below is a rate. No figure here has been entered into the price book.

## What was searched, and what came back

Three searches were run for Islamabad / Rawalpindi rates on 11 August 2026. The
result was the same each time: **no published, citable Pakistani rate exists for
any of these six.** What is published is either an international range, an
Indian rate, or a commodity price in a different unit.

| Material | What is published | Source | Why it is not a rate |
|---|---|---|---|
| Walnut veneered panelling | PKR 800–4,000 **per sheet** for wooden wall panels generally | [OLX Pakistan](https://www.olx.com.pk/items/q-wood-paneling), [Alibaba product insights](https://www.alibaba.com/product-insights/wooden-wall-panels-price-pakistan.html) | Per sheet, not per sq ft; not walnut-specific; classified listings, not a supply-and-fix rate |
| Vertical timber slat screen | — | — | Nothing found. Fabricated joinery, quoted per job |
| Brushed stainless panel | 304 sheet sold **per kilogram**, tracking nickel, revised weekly | [MWPBNP](https://blog.mwpbnp.com/304-stainless-steel-prices-in-pakistan/), [Kamran Steel](https://kamransteel.com/steel-prices-in-pakistan/) | A per-sq-ft rate needs a stated gauge and a fixing rate on top |
| Gold-finish metal trim | — | — | Nothing found. Specialist trim, quoted per job |
| Leather wall upholstery | — | — | Nothing found. Upholstery, quoted per job |
| PTFE / PVC fibre tensile membrane | PVC US$200–500/m²; PTFE US$400–1,000/m². India PVC ₹300–450/sq ft | [temembrane.com](https://temembrane.com/how-much-does-tensile-membrane-structure-cost-and-what-is-the-price-range-for-budgetary-purposes/), [Derflex](https://www.derflex.com/architectural-membrane-fabric.html) | International and Indian, not Pakistani. A range four-fold wide is not a rate |

## Pakistani suppliers who can quote

Found by the same searches. None has published a rate; all sell into this market.

- **Tensile membrane** — [URVA Tensile, Lahore](https://urvatensile.com/) ·
  [Pine Structures](https://pinestructures.com/) ·
  [Habib Tarpal](https://www.habibtarpal.com/pvc-tarpal/pvc-tensile-shade-structure)
- **Stainless sheet** — [Al Haram Engineering, Lahore](https://alharamengineering.com/best-stainless-steel-plates/) ·
  [NAAS Pakistan](https://naaspak.com/products/stainless-steel/stainless-steel-sheet.html) ·
  [Kamran Steel](https://kamransteel.com/steel-prices-in-pakistan/)
- **Walnut, slats, gold trim, leather** — no national supplier found. These are
  joinery and upholstery trades bought locally on quotation.

## Quantities to quote against

From the model, per ground-floor concept. The tensile membrane is the same in
all three because the roof does not change with the lobby.

| Concept | Material | Quantity | Unit |
|---|---|---|---|
| 1 — Geo-Spatial Lounge | Walnut veneered panelling | see caveat | sq ft |
| 2 — Futuristic GIS Hub | Brushed stainless panel | see caveat | sq ft |
| 3 — Earth Observation | Leather wall upholstery | see caveat | sq ft |
| all three | PTFE / PVC tensile membrane | **770** | sq ft |

### The caveat, and it is a real one

**The three feature-wall quantities are wrong today and must not be sent to a
supplier.** The takeoff reports 2,494.9 sq ft for each, which is the ground
hall's *entire* wall area. The feature is one wall — the north — at 566 sq ft.
The figure is overstated about **4.4x**.

The cause is known and is in the application, not in this design:
`computeTakeoff` reads `FinishAssignment.heightLimit` but never reads
`FinishAssignment.wallId`, so a finish restricted to one wall is measured over
every wall of the room, and the base finish is not reduced by it either. Until
that is fixed, any BOQ carrying a feature wall is quantitatively wrong in both
directions.

The membrane's 770 sq ft is sound: it is a ceiling area, not a wall, and no
`wallId` is involved.

## What to do next

1. Fix `wallId` in `computeTakeoff`, and add a "from height X up" primitive so
   paint above a dado stops being billed behind the tile.
2. Re-run these quantities.
3. Send them to the suppliers above and import the replies through the app's
   quotation import as **Level 3 — supplier quote**, which is the highest tier
   below an official published rate.

Until step 3, these six lines carry a quantity and no rate, and any total that
includes them is visibly incomplete rather than quietly wrong.
