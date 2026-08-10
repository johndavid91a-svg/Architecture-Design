# Testing report

Run on 7 August 2026 against the working tree of `claude/repo-check-buk1x4`.

Everything below was executed, not reasoned about. Where a figure is a
measurement it says what it was measured against; where something does not work,
it says so.

---

## 1. Summary

| Suite | Command | Result |
|---|---|---|
| Unit and integration tests | `npm test` | **143 passed**, 15 files, 0 failed |
| Core type check | `npm run typecheck --workspace @adp/core` | Clean |
| Desktop type check | `npm run typecheck --workspace @adp/desktop` | Clean |
| Desktop build | `npm run build --workspace @adp/desktop` | Clean — main, preload, renderer (1,474 kB) |
| Generated-building scenarios | `node tools/scenarios.mjs` | **96 checks passed** across 6 buildings |
| Main-process import path | `node tools/test-main-import.mjs` | **11 checks passed** |
| End-to-end user journey in the running app | Electron under Xvfb | **18 steps passed**, no console errors |
| Worked Space Centre design | `node tools/space-centre-check.mjs` | **10 checks passed** |
| Planning limits persist and drive the report | `npx electron tools/test-planning-persistence.cjs` | **13 checks passed** |
| IFC reference buildings | `node tools/test-ifc-import.mjs` | 12 models imported, results below |
| DXF reference drawings | `node tools/test-dxf-import.mjs` | 3 drawings, results below |

---

## 2. Real buildings imported from IFC

Each of these is a published model of a real or fully-detailed building. The
**ground truth is the file's own declared data** — `Qto_SpaceBaseQuantities` for
areas, `IfcMaterialLayerSet` for wall thicknesses — so these are measurements
against the authoring tool's own figures, not against a recollection.

| Model | Schema | Floors | Rooms | Walls | Openings | Gross area | Time | Verdict |
|---|---|---|---|---|---|---|---|---|
| `AC20-FZK-Haus.ifc` | IFC4 | 2 | 7 | 13 | 16 | 2,249 sq ft | 425 ms | **PASS** — 0 issues |
| `ISSUE_005_haus.ifc` | IFC4 | 2 | 7 | 13 | 16 | 2,249 sq ft | 393 ms | **PASS** — 0 issues |
| `C20-Institute-Var-2.ifc` | IFC4 | 5 | 82 | 121 | 283 | 24,398 sq ft | 1,087 ms | **PASS** — 0 issues |
| `duplex.ifc` | IFC2X3 | 4 | 21 | 57 | 30 | 4,442 sq ft | 164 ms | **PASS** |
| `dental_clinic.ifc` | IFC2X3 | 3 | 269 | 1,068 | 291 | 71,746 sq ft | 1,420 ms | **PASS** — 2 walls fitted from geometry, reported |
| `Office_A_20110811.ifc` | IFC2X3 | 3 | 99 | 474 | 161 | 36,905 sq ft | 589 ms | **PASS** |
| `IfcOpenHouse_IFC4.ifc` | IFC4 | 1 | 0 | 4 | 1 | — | 22 ms | **PASS (reported)** — model has no `IfcSpace`; says so |
| `S_Office_Integrated Design Archi.ifc` | IFC2X3 | 6 | 0 | 140 | 47 | — | 1,182 ms | **PASS (reported)** — no `IfcSpace`; says so |
| `advanced_model.ifc` | IFC2X3 | 3 | 0 | 133 | 107 | — | 1,329 ms | **PASS (reported)** — no `IfcSpace`; says so |
| `schependomlaan.ifc` | IFC2X3 | — | 6 of ~100 | 841 | — | — | — | **PARTIAL** — see §5 |

"PASS (reported)" means the file genuinely contains no room entities. The importer
brings in the walls, states that floor and finish quantities are unavailable, and
does not invent rooms to fill the gap.

### Area accuracy against the file's own declared quantities

`AC20-FZK-Haus.ifc`, every room with a declared `Qto_SpaceBaseQuantities`:

| Room | Imported | Declared | Error |
|---|---|---|---|
| Schlafzimmer | 22.1 m² | 22.1 m² | 0.0% |
| Bad | 12.5 m² | 12.5 m² | 0.0% |
| Buero | 13.0 m² | 13.0 m² | 0.0% |
| Wohnen | 26.0 m² | 26.0 m² | 0.0% |
| Küche | 16.3 m² | 16.3 m² | 0.0% |
| Galerie | 107.2 m² | 107.2 m² | 0.0% |
| Flur | 12.0 m² | 11.5 m² | **3.6%** |

**Mean absolute error 0.5%; six of seven rooms exact.** The outlier is `Flur`,
the hallway — an L-shaped space whose declared quantity is measured differently
from its boundary representation. This is disclosed rather than tuned away.

---

## 3. Generated buildings — Pakistani plot sizes

`node tools/scenarios.mjs`. Plot sizes are the real units: 1 marla = 225 sq ft,
1 kanal = 20 marla = 4,500 sq ft.

| Scenario | Plot | Storeys | Covered | FAR | Takeoff lines | Result |
|---|---|---|---|---|---|---|
| 5 marla house, Islamabad | 25 × 45 ft | 2 | 1,216 sq ft | 1.08 | 60 | **PASS** |
| 10 marla house, Rawalpindi | 35 × 65 ft | 2 | 2,488 sq ft | 1.09 | 80 | **PASS** |
| 1 kanal house, Lahore | 50 × 90 ft | 2 | 4,214 sq ft | 0.94 | 100 | **PASS** |
| Small plaza, Islamabad | 30 × 60 ft | 4 | 4,952 sq ft | 2.75 | 104 | **PASS** |
| Large plaza, Karachi | 60 × 100 ft | 8 | 26,383 sq ft | 4.40 | 248 | **PASS** |
| Single-storey shop, Rawalpindi | 20 × 40 ft | 1 | 480 sq ft | 0.60 | 9 | **PASS** |

Each scenario is checked on sixteen points, including:

- **Every entered dimension survives generation exactly.** A room entered as
  14 × 16 ft measures 14 × 16 ft in the twin, to within 1 mm². This is the
  property the entire product rests on.
- Covered area equals ground-floor area × storeys, computed independently here.
- FAR equals covered ÷ plot, computed independently here.
- Every opening fits inside its wall.
- A multi-storey building gets a staircase, and the staircase reaches every floor.
- No takeoff quantity is negative or non-finite, and every line records its derivation.
- **No regulation observation ever claims compliance.**

The FAR figures are outputs, not judgements. The application does not know CDA's
or RDA's limits and does not pretend to — see §6.

---

## 4. Drawing import (DXF)

| Drawing | Line work | Result | Verdict |
|---|---|---|---|
| `entities.dxf` | 188 segments | 41 rooms, 144 walls, 3,212 sq ft | **PASS** |
| `Ceco.NET-Architecture-Tm-53.dxf` | 7,341 segments | 87 walls, 1 room | **PARTIAL** — see §5 |
| `floorplan.dxf` | 1,044 segments | Refused: `IMPLAUSIBLE_SCALE` | **PASS (correct refusal)** |

`floorplan.dxf` declares `$INSUNITS = 4` (millimetres) and is 1,149 units across —
a building 1.15 m wide. Before this round it silently produced zero rooms; it now
refuses with the reason and the remedy. That is the correct outcome: a drawing at
the wrong scale produces a complete, plausible model of a building that is not the
one on the paper, and nothing downstream can detect it.

---

## 4a. The worked Space Centre design

`node tools/space-centre-check.mjs`. A four-storey public science centre, built by
the template and checked as a building rather than as data.

| Floor | Plate | Area | Rooms | Openings | Floor-to-floor |
|---|---|---|---|---|---|
| Ground — arrival, exhibition | 63.5 × 32.6 m | 18,066 sq ft | 12 | 46 | 7.2 m |
| First — galleries, planetarium | 63.5 × 32.6 m | 21,841 sq ft | 11 | 34 | 8.7 m |
| Second — mission control, laboratories | 63.5 × 28.6 m | 15,948 sq ft | 12 | 42 | 4.5 m |
| Third — auditorium, observatory, admin | 63.5 × 26.6 m | 14,832 sq ft | 12 | 45 | 4.2 m |

70,031 sq ft over four floors on a 90 × 60 m site: **37.8% ground coverage, FAR
1.20**, 259 takeoff lines. Ten checks pass, including the ones that catch the
mistakes a generated plan actually makes:

- Every room has a door onto circulation. A room nobody can enter is the most
  embarrassing thing a generated plan can contain.
- **No upper floor oversails the one below it.** A floor wider or deeper than its
  neighbour is a cantilever — an engineering decision with a cost, not something a
  room schedule should cause by accident. The plates step 32.6 → 28.6 → 26.6 m.
- The planetarium and the data centre have no windows: daylight ruins a projection
  dome and is a thermal load on a room full of servers.
- The authored 16 m dome measures 16 m after layout, to six decimal places. If the
  layout had quietly resized it to tidy the plate, every quantity from it is wrong.
- The stair and lift run the full height, and every floor has an escape door.

The regulation checker still reports `not_checkable` for this building, as it does
for every other, because no real CDA or RDA limit has been entered.

---

## 4b. The application, actually running

Electron was launched under a virtual display and driven through the journey a
user takes, capturing each screen. All 18 steps passed with no page errors. The
only console output was WebGL performance chatter from software rendering, which
is the test environment rather than the application.

| Step | Result |
|---|---|
| Setup screen offers attaching a drawing | PASS |
| Import panel states what it accepts | PASS |
| Switching back to entering measurements by hand | PASS |
| Setting the building to three storeys | PASS |
| Creating the digital twin | PASS |
| Opening 2D Plan, 3D, Design, Quantities, Estimate / BOQ, Sourcing, Regulation, Report | PASS (8 views) |
| One-click floor buttons present (3 found) | PASS |
| Switching to first-person walk | PASS |
| Changing floor in one click | PASS |
| 3D canvas rendering | PASS |

The captures were read, not just counted. The 2D plan draws rooms at true wall
thickness with names, feet-and-inch dimensions and areas, doors, windows and
emergency exits colour-coded, and edits locked behind the professional-review
acknowledgement. The 3D view draws three storeys with the stair core's treads
visible and the Islamabad sun position for the chosen date. Reading those images
is what turned up defect 13.

**Note on running as root.** Electron refuses to start as root without
`--no-sandbox`. That is Chromium's restriction, not an application fault, and it
does not affect a normal user account.

---

## 5. What does not work

Stated plainly, because these are the parts a user will hit.

**`Ceco.NET-Architecture-Tm-53.dxf` yields 1 room from 87 walls.** This is a villa
*site* plan: its layers are `wall low`, `wall high`, `topography`, `plants`,
`texture`, `equipment`. Layer filtering now removes 2,331 lines of landscape noise
and cut the spurious wall count from 512 to 87, but the remaining walls still do
not close into rooms — the drawing carries garden walls, level changes and curved
forms that the recogniser reads as building fabric. It reports honestly that walls
were recognised and rooms were not, and wall quantities remain available.

**`schependomlaan.ifc` yields 6 rooms of about 100.** Its spaces are defined by
boundary representations the geometry reader does not fully evaluate. Walls import
correctly (841 of them).

**PDF import requires calibration and there is no calibration UI yet.** The
importer detects that a PDF page carries no building scale and returns a blocking
`PDF_NEEDS_CALIBRATION` issue with the remedy. The two-point pick that would
resolve it is not built. Vector PDFs therefore cannot currently be imported end to
end; IFC and DXF can.

**Room-name matching on DXF is weak.** Text inside a face names the room, but a
drawing that puts names outside their rooms, or on a layer that is filtered out,
leaves rooms called "Room". `entities.dxf` shows this — it is a DXF feature-test
file rather than a real plan, and its "rooms" are hatch and text boxes. Its 41
rooms demonstrate that the topology now closes; they are not architectural
validation.

---

## 6. Regulatory figures — what is and is not asserted

Separated as three distinct categories, and the application keeps them separate:

**Actual regulatory requirements.** None are built in. Every planning limit —
setback, ground coverage, FAR, parking ratio — is entered by the user together
with its source, and the checker records that source in the report. This is not a
gap left by accident: the authority sites (CDA, RDA, LDA) are unreachable from the
build machine, and a limit quoted from memory would be indistinguishable to the
user from one quoted from the by-laws.

**Common architectural practice.** Where the application must choose a number to
proceed, it uses a documented practice default and labels it: 3.0 m default clear
height on an imported plan, 114 mm for a wall drawn as a single line, 2,100 mm
door height, 900 mm window sill. Every one appears in the issues list as an
assumption.

**Assumptions.** Marked in the model itself. Imported geometry carries
`extracted`, `inferred` or `verified` confidence per element, and the plan view
shows it per room.

The checker has one hard rule, tested: **it never reports a pass.** It reports
`exceeds_limit`, `near_limit` or `not_checkable`. Silence means nothing was
detected, not that the building complies.

---

## 7. Defects found and fixed this round

Every one was found by running the code against real files, not by reading it.

| # | Defect | How it showed | Fix |
|---|---|---|---|
| 1 | **IFC import would throw on first use in the packaged app.** `webIfcDirectory()` called `require.resolve('web-ifc/package.json')`; web-ifc publishes an `exports` map that does not include `./package.json`, so this raises `ERR_PACKAGE_PATH_NOT_EXPORTED`. | Every test harness hardcoded a relative wasm path, so no test crossed the real wiring. Found by writing a harness that drives the main-process entry point. | Resolve through `web-ifc/web-ifc.wasm`, which the exports map does expose. Added `tools/test-main-import.mjs` so the user's first click is on a tested path. |
| 2 | **The building outline was reported as a room.** `findFaces` documented that it discarded the outer face by area sign, but `polygonArea` returns an absolute value, so the test never fired. A one-room drawing produced two rooms of identical area — doubling floor area and every quantity derived from it. | New recogniser test. | Filter on `signedArea > 0`. |
| 3 | **The face walk turned the wrong way at every T-junction.** It took the next edge counter-clockwise from the reverse edge; tracing bounded faces counter-clockwise requires the next edge clockwise. On a plain rectangle every node has two edges and both rules agree, which is why it was invisible. With three edges the walk passes straight through the junction, so two rooms either side of a partition trace as one. | Two-room fixture with a shared partition returned 1 room. | Step to the previous entry in the bearing-sorted list. |
| 4 | **Half-edge bearings were not normalised.** `atan2` returns (−π, π] and the reverse edge added π, putting the two directions on different scales. A node with three or more edges then sorted into an order that is not a rotation of the true cyclic order. | Same fixture. | Normalise every bearing into [0, 2π). |
| 5 | **T-junctions had no graph node.** Welding moved a partition's end onto a wall but never cut the wall there, leaving the partition a dangling spur. | Same fixture: a correct 7-wall graph still traced 1 room. | Added `splitAtJunctions`, cutting walls at T- and X-junctions. Quantity-neutral. |
| 6 | **Room boundaries were inset by half the intended distance.** `insetFace` averaged the two edge normals at a corner; at a right angle they are perpendicular, so the mean carries the corner only half as far along each axis. Every imported room came out one wall thickness too wide and too deep — **6% too much floor area on a typical bedroom, on every room in every import.** | Two-room fixture measured 15.6 m² where the drawing states 14.71 m². | Replaced with a proper mitre join, with a mitre limit so sharp slivers do not spike. |
| 7 | **A test band wide enough to hide defect 6.** The single-room test asserted an area between 20 and 24 m² where the fixture's own geometry states 19.61 m². The under-inset produced 20.67 m² and passed. | Found while fixing 6. | Both room tests now assert the fixture's stated finished-face area to two decimal places. |
| 8 | **Walls interrupted at every door never closed a room.** Most CAD plans stop wall lines either side of an opening. Measured across a real 43 × 33 m villa plan: 331 collinear wall pairs with sub-4 m gaps, clustered at 750–999 mm and 1750–1999 mm — single and double doors. | `tools/wall-gap-probe.mjs`, written to test the hypothesis. | Added `bridgeOpenings`, rejoining collinear runs across opening-sized gaps. Quantity-neutral: the bridged span is read straight back as an opening and the takeoff deducts openings from masonry. `entities.dxf` went 13 → 41 rooms. |
| 9 | **Landscape line work was being read as walls.** A villa drawing put trees, contours and paving on their own layers; fed in undifferentiated, a contour paired with a paving joint into a plausible 43 m wall. | Inspected the file's layer table after the room count stayed low. | Layer classification following the AIA CAD Layer Guidelines and ISO 13567, in several languages. Removed 2,331 noise lines and cut spurious walls 512 → 87. Unknown layer names are kept, never discarded. |
| 10 | **A drawing at the wrong scale was measured rather than refused.** | `floorplan.dxf` produced zero rooms with no explanation. | Plausibility check on the drawing extent, refusing below 3 m across with the reason and the remedy. |
| 11 | **"No rooms found" gave no reason.** | Ceco and floorplan both reported it, for completely different causes. | The face walk now reports why faces were rejected, and `NO_ROOMS` names the cause and gives the matching remedy. |
| 12 | **A file with no extension had its whole path quoted back as its file type.** `/etc/hostname` reported `Unsupported file type "./etc/hostname"`. | Error-handling checks in the main-process harness. | Take the extension from the file name, and say plainly when there is none. |
| 17 | **Planning limits were lost on every tab change.** They lived in the Regulation screen's own `useState`, so anything entered evaporated the moment the user looked at anything else, and never reached a saved file. This — not the checker — is why the regulatory feature was inert: nobody enters a bye-law schedule twice. | Found by asking why the feature stays unusable even for someone holding the bye-laws. | Planning parameters moved onto the `Project`, so they save, reload, and appear in the report beside the observations they produced. Saving now requires naming the bye-law they came from, on the same principle the price book runs on. |
| 14 | **The 3D presentation animations ran at a speed that depended on frame rate.** The cinematic clock accumulated the per-frame `dt`, which is deliberately clamped at 0.05 s so a stalled frame cannot teleport a walker through a wall. Right for movement, wrong for a timed animation: on a machine rendering at 10 fps a 3-second sequence took three times as long and never appeared to finish. | The assemble animation failed to settle within its own duration during the end-to-end run. | Read the wall clock directly instead of accumulating clamped steps. |
| 15 | **Stair and lift cores were placed outside the building.** They were positioned past the far corner of the widest floor at y = 0, which reads as an annex hanging off the corner rather than a core. | Visible in the 3D capture of the Space Centre. | Place the core on the circulation spine, centred on the corridor and abutting its end wall — where a real core goes, and where the corridor's escape door already leads. |
| 16 | **Room labels collided in small rooms.** A lift shaft is 1.5 m across; three centred lines of text landed on top of the staircase beside it. | Visible in the 2D capture. | Measure the name against the room and drop to name-only, then to nothing, rather than smearing. |
| 13 | **Inch fractions were never reduced.** The plan showed a staircase as `3' 11 2/8"` and a lift as `0' 6/8"` where an architect writes `11 1/4"` and `3/4"`. | Reading the 2D plan capture from the end-to-end journey run. | Reduce the fraction to lowest terms in `formatLength`. |

Defects 2–8 all had the same character: the code was correct on the one-room
rectangle every test used, and wrong on the first drawing with an internal
partition — which is to say, on every real building.

---

## 8. How to re-run all of it

```bash
npm install
npm test                                    # 126 unit and integration tests
npm run typecheck --workspace @adp/core
npm run typecheck --workspace @adp/desktop
npm run build --workspace @adp/desktop
node tools/scenarios.mjs                    # 6 generated buildings, 96 checks
node tools/test-main-import.mjs             # the real main-process import path
```

The reference-building harnesses need the sample repositories from
`RESOURCES_AND_SOURCES.md` §2 cloned to `/home/user/samples/`:

```bash
node tools/test-ifc-import.mjs /home/user/samples/wifc/tests/ifcfiles/public/AC20-FZK-Haus.ifc
node tools/space-truth.mjs     /home/user/samples/wifc/tests/ifcfiles/public/AC20-FZK-Haus.ifc
node tools/test-dxf-import.mjs /home/user/samples/dxf-bjnortier/test/resources/entities.dxf
```
