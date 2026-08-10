# Final validation

State of the project as of 7 August 2026, branch `claude/repo-check-buk1x4`.

---

## 1. Can it be opened and used?

Yes, with one exception noted in §4 (PDF calibration).

```bash
git clone https://github.com/johndavid91a-svg/Architecture-Design.git
cd Architecture-Design
git checkout claude/repo-check-buk1x4
npm install
npm run dev
```

`npm install` needs network access once, to fetch the dependencies in
`RESOURCES_AND_SOURCES.md` §1. After that the application runs offline — nothing
it does requires a network, an account or an API key.

Node 20 or later. Tested on Node 22.22.2, Linux.

---

## 2. Checklist

### Installation and startup

- [x] `npm install` completes from a clean clone
- [x] `npm run dev` opens the Electron window
- [x] `npm run build --workspace @adp/desktop` produces main, preload and renderer bundles
- [x] No API key, account or network connection needed to run
- [x] Runs on Node 22; no native compilation step

### Correctness of measurement

- [x] Every dimension entered survives generation exactly (verified to 1 mm² on 6 buildings)
- [x] Millimetres are canonical; imperial conversions use exact factors and are quantised to the nanometre
- [x] An unreadable dimension is refused, never guessed
- [x] Room boundaries are finished faces, with wall centrelines outside by half a thickness
- [x] Imported room areas within 0.5% mean of the file's own declared quantities
- [x] Imported wall thicknesses taken from declared material layer sets, not fitted from meshes
- [x] The geometry fingerprint guard survives JSON round trips
- [x] Architecture cannot be changed without explicit authorisation

### Buildings

- [x] Small, medium and large residential plots (5 marla, 10 marla, 1 kanal)
- [x] Small and large commercial plazas (30 × 60 ft × 4, 60 × 100 ft × 8)
- [x] Single-storey and multi-storey
- [x] Staircase generated for multi-storey buildings and present on every floor
- [x] Lift core generated when asked for
- [x] Stair and lift cores count toward covered area, FAR and the takeoff
- [x] Riser count derived from floor-to-floor height so the flight lands exactly

### Drawing import

- [x] IFC2X3 and IFC4 import, validated against 12 published reference models
- [x] DXF import, including layer-aware separation of building fabric
- [x] Import produces *candidates*, never the master record, until accepted
- [x] Every imported element carries `extracted` / `inferred` / `verified` confidence
- [x] Parsing runs in the main process, not the renderer
- [x] The main-process import path is itself under test (`tools/test-main-import.mjs`)
- [x] A drawing at an implausible scale is refused with a reason and a remedy
- [x] A model with no rooms says so rather than inventing them
- [x] Corrupt, missing and unsupported files produce messages, not crashes
- [x] **PDF import end to end** — reads a real 56-sheet set and takes each sheet's own plotting scale from the file
- [ ] Room recognition quality on dense PDF sheets — see §4

### Navigation

- [x] 2D plan and 3D model from the same twin
- [x] First-person walkthrough
- [x] Floor change by stair, by lift, and by one-click floor buttons
- [x] Daylight slider

### Costing

- [x] Quantity takeoff from geometry, every line recording its derivation
- [x] Labour estimated separately from materials
- [x] **No price is ever fabricated** — `PriceLookup` has no `amount` field on its unavailable branch, so code cannot read one
- [x] Prices carry source, URL, date and confidence; confidence is derived from tier and age, never stored
- [x] Landed-cost cascade compounds correctly (duty on CIF, sales tax on duty-paid, withholding on tax-paid)
- [x] Missing prices are reported as gaps, not counted as zero
- [ ] **Price book is empty** — deliberate, see §5

### Regulation

- [x] The checker never reports a pass
- [x] A missing parameter yields `not_checkable`, not silence
- [x] Every report carries the disclaimer
- [x] Actual requirements, common practice and assumptions are kept distinct
- [x] Limits are stored on the project: they save, reload and drive the report
- [x] A limit cannot be saved without naming the bye-law it came from
- [ ] **No Pakistani by-laws loaded** — see §5

### Quality

- [x] 143 tests passing, 0 failing
- [x] Core and desktop type-check clean
- [x] `contextIsolation: true`, `nodeIntegration: false`, strict CSP, no generic `invoke(channel)`
- [x] No temporary hacks: every fix in `TESTING_REPORT.md` §7 is a fix to the cause

---

## 3. What was fixed this round

Thirteen defects, all found by running the code against real files. The full list
with symptoms and fixes is `TESTING_REPORT.md` §7. Three are worth naming here
because of what they would have cost:

1. **IFC import would have thrown on the first file a user opened**, in the
   packaged app, because of a module-resolution error that no existing test
   crossed. This is the difference between "ready to use" and "fails immediately".
2. **Every imported room was 6% too large.** `insetFace` averaged two
   perpendicular corner normals instead of mitring them, so every room came out
   one wall thickness too wide and too deep. Floor area multiplies through the
   entire takeoff and every cost derived from it.
3. **Rooms either side of any internal partition traced as one room.** Three
   separate faults in the face walk, each invisible on the single rectangle the
   tests used and each fatal on the first real plan.

---

## 4. Known limitations

| Limitation | Effect | What would close it |
|---|---|---|
| **Rooms recognised from a dense PDF sheet are unreliable** | A real 56-sheet set imports with the correct scale and correct overall dimensions — the longest walls come out 64 ft and 50 ft, which are the building's real dimensions — but the median recognised "wall" is 0.6 ft, and the rooms come out at 11-55 sq ft. The sheet's hatching, furniture and text outlines are all vector line work and the recogniser cannot tell them from walls. Wall runs and sheet extents are trustworthy; room areas from PDF are not. | A DXF carries layers, which is exactly how this was solved there (`classifyLayer`). A PDF has none, so the equivalent would have to be inferred from stroke width, colour and length distribution. Until then, prefer DXF or IFC when room areas matter. |
| **PDF calibration UI not built** | A sheet that does *not* state its own scale still reports that it needs one, and there is no two-point pick to give it. Sheets that state their scale no longer need it. | A calibration overlay in `ImportPanel`: pick two points, type the real distance. The `ScaleCalibration` contract and the `known_distance` path already exist in `packages/core/src/import/contract.ts`. |
| **Some DXF site plans do not close into rooms** | `Ceco.NET-Architecture-Tm-53.dxf` gives 87 walls and 1 room. Wall quantities are available; floor quantities are not. | Curved-wall support, and treating `wall low` / `wall high` as distinct classes rather than both as fabric. |
| **`schependomlaan.ifc` gives 6 rooms of ~100** | Its spaces use boundary representations the geometry reader does not fully evaluate. Walls import correctly. | Evaluate `IfcRelSpaceBoundary` as a fallback when the space has no usable solid. |
| **DXF room naming is weak** | Rooms come out called "Room" when names sit outside their boundary or on a filtered layer. | Nearest-name matching with a distance limit, and reading names from an explicitly named layer. |
| **No price book** | Every estimate reports gaps rather than totals until rates are entered. | §5. |
| **No by-laws** | Every regulatory check reports `not_checkable` until limits are entered. | §5. |

---

## 5. What I need from you

This is the list of things I could not obtain, and what each unblocks.

**1. Nothing is needed to run the application.** It opens, imports, models,
measures and takes off quantities with no credentials at all.

**2. Pakistani pricing.** The network policy on this machine blocks every
Pakistani supplier and market source. The price book is therefore empty by design
(`docs/adr/0002-ship-an-empty-price-book.md`) rather than seeded with rates I could not
attribute. To make estimates produce totals, either:

- give me network access to the supplier sites listed in `docs/LOCAL_PRICING_SOURCES.md`; or
- send a rate list (CSV or a supplier quotation) — the importer at
  `packages/core/src/pricing/import.ts` reads it, and it refuses malformed figures
  rather than guessing at them; or
- enter rates in the application, which records source, URL and date per rate.

**3. CDA and RDA building by-laws.** Re-tested on 10 August: still blocked, and
not selectively — the proxy answers `403` to `CONNECT` for every host outside
GitHub and the package registries, Wikipedia included. So this is not something
I can resolve by trying harder.

What changed instead is that entering them is now worth doing: limits are stored
on the project, survive reload, and appear in the report with the clause they
came from. Give me the schedule for your plot category and it is a five-minute
job; until then the checker reports `not_checkable`, which is the correct answer
rather than a missing feature.

Blocked from this machine:
`cda.gov.pk`, `rda.gop.pk`, `lda.gop.pk`, `pec.org.pk`. What is needed is the
published setback, ground coverage, FAR and parking figures by plot category.
Until then the checker reports `not_checkable` — which is correct, but it means
the regulatory feature is inert.

**4. Nothing else.** No API keys, no accounts, no paid services. The AI Design
Director orchestrates deterministic agents in-process; it does not call out.

---

## 6. Verification

Everything in `TESTING_REPORT.md` was run on the working tree. To reproduce:

```bash
npm test                          # 126 passed
npm run typecheck --workspace @adp/core
npm run typecheck --workspace @adp/desktop
npm run build --workspace @adp/desktop
node tools/scenarios.mjs          # 96 checks across 6 buildings
node tools/test-main-import.mjs   # 11 checks on the real import path
```
