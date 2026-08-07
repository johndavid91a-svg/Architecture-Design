# Resources and sources

Everything brought into this project from outside it, with where it came from and
why it was chosen. Two categories are kept apart deliberately:

- **Integrated** — shipped as part of the application.
- **Test only** — downloaded to validate the application against real buildings,
  never shipped and never committed to this repository.

Nothing in this file is a price. Prices have their own provenance rules, described
in `docs/LOCAL_PRICING_SOURCES.md`, and none are bundled.

---

## 1. Integrated libraries

| Library | Version | Source | Licence | Purpose | Why this one |
|---|---|---|---|---|---|
| `web-ifc` | 0.0.77 | https://github.com/ThatOpen/engine_web-ifc | MPL-2.0 | Reads IFC2X3 and IFC4 models | The only maintained IFC reader that runs in-process without a native toolchain. It is WebAssembly, so it works identically on Windows, macOS and Linux with no build step for the user. MPL-2.0 is file-level copyleft, which does not reach our own source. |
| `dxf-parser` | 1.1.2 | https://github.com/bjnortier/dxf | MIT | Parses DXF into entities | Pure JavaScript, no AutoCAD dependency, handles the entity set architectural drawings actually use (LINE, LWPOLYLINE, POLYLINE, ARC, INSERT, TEXT, MTEXT). |
| `pdfjs-dist` | 6.2.108 | https://github.com/mozilla/pdf.js | Apache-2.0 | Extracts vector line work and text from PDF | Mozilla's reader is the reference implementation. Its operator-list API exposes the path construction operators, which is what a drawing import needs — a rasteriser would be useless here. |
| `three` | 0.171.0 | https://github.com/mrdoob/three.js | MIT | 3D view and first-person walkthrough | Mature, and its scene graph maps cleanly onto a building of floors, rooms and walls. |
| `react`, `react-dom` | 18.3.1 | https://github.com/facebook/react | MIT | Renderer UI | — |
| `electron` | 33.3.1 | https://github.com/electron/electron | MIT | Desktop shell | The application must read files from disk and run WebAssembly from the filesystem; both need a real desktop process. |
| `electron-vite`, `vite`, `@vitejs/plugin-react` | — | https://github.com/alex8088/electron-vite | MIT | Build tooling | — |
| `typescript` | 5.6.3 | https://github.com/microsoft/TypeScript | Apache-2.0 | — | — |
| `vitest` | 2.1.9 | https://github.com/vitest-dev/vitest | MIT | Test runner | — |

**Deliberately not added.** A geometry kernel (`opencascade.js`), a constraint
solver, and a room-recognition library were all considered and rejected. Each is
tens of megabytes and would have replaced code that is a few hundred lines and
whose failure modes we need to understand precisely. The recogniser in
`packages/core/src/import/recognise.ts` is our own for that reason: when it gets
a room wrong, that is a bug we can find.

---

## 2. Reference buildings used for validation (test only)

These were cloned to `/home/user/samples/` on the test machine. **They are not part
of this repository** — they are large, they carry their own licences, and they are
inputs to testing rather than product code. Anyone re-running the validation should
clone them to the same place.

| Collection | Source | Commit | Contents | Licence | Why |
|---|---|---|---|---|---|
| buildingSMART Sample-Test-Files | https://github.com/buildingSMART/Sample-Test-Files | `cecf656` | IFC2X3 and IFC4 models from the standards body itself | Per repository terms, published for implementer testing | These are the reference files the IFC standard is validated against. If our importer disagrees with one, our importer is wrong. |
| IfcOpenShell files | https://github.com/IfcOpenShell/files | `9fc2267` | Real project models, including complete buildings | Per repository terms | Real buildings with real irregularities, not idealised test cases. |
| engine_web-ifc test files | https://github.com/ThatOpen/engine_web-ifc | `2b01358` | `tests/ifcfiles/public/` — a broad IFC corpus | MPL-2.0 | Where `AC20-FZK-Haus`, `duplex` and `dental_clinic` come from. Includes files that are known to be awkward. |
| bjnortier/dxf test resources | https://github.com/bjnortier/dxf | `cb571d1` | `test/resources/` — 67 DXF files including architectural plans | MIT | The DXF corpus, including `Ceco.NET-Architecture-Tm-53.dxf`, a complete villa drawing with landscaping. |
| three-dxf | https://github.com/gdsestimating/three-dxf | `20e14cb` | Further DXF samples | MIT | Additional drawing conventions. |

315 IFC files and 67 DXF files were available in total; the twelve buildings listed
in `TESTING_REPORT.md` were worked through in detail.

### Why these are good ground truth

An IFC file states its own answers. `Qto_SpaceBaseQuantities` carries the area the
authoring tool computed for each space; `IfcMaterialLayerSet` carries each wall's
declared thickness; `IfcWallStandardCase` carries a declared axis centreline. So
the importer can be checked against the file's own figures rather than against a
recollection of what the building looks like. Every measurement error in
`TESTING_REPORT.md` was found that way, and it is the reason the errors found were
real ones.

---

## 3. Standards and published guidance consulted

| Source | URL | Used for |
|---|---|---|
| AIA CAD Layer Guidelines (`A-WALL`, `A-FURN`, `A-ANNO`, `A-EQPM`, …) | https://www.nationalcadstandard.org/ | The layer-name classification in `recognise.ts` that separates building fabric from planting, furniture and annotation. |
| ISO 13567 — organisation of CAD layers | https://www.iso.org/standard/40352.html | Same. |
| IFC4 ADD2 TC1 specification | https://standards.buildingsmart.org/IFC/RELEASE/IFC4/ADD2_TC1/HTML/ | Entity and quantity semantics used by the IFC importer. |
| DXF reference (R2018) | https://help.autodesk.com/view/ACD/2018/ENU/?guid=GUID-235B22E0-A567-4CF6-92D3-38A2306D73F3 | Group codes, `$INSUNITS`, entity structure. |

### Regulatory sources — access still required

The application never asserts a planning limit it has not been given. Limits are
entered by the user with a source, and where none is entered the checker reports
`not_checkable` rather than a pass. That design decision was forced by the network
policy on this machine, which blocks the Pakistani authority sites:

| Authority | Site | Status from this machine |
|---|---|---|
| Capital Development Authority (Islamabad) | https://www.cda.gov.pk/ | Blocked |
| Rawalpindi Development Authority | https://rda.gop.pk/ | Blocked |
| Lahore Development Authority | https://lda.gop.pk/ | Blocked |
| Pakistan Engineering Council | https://www.pec.org.pk/ | Blocked |

**What is needed to close this gap** is listed in `FINAL_VALIDATION.md` §5. It is
the CDA and RDA building by-laws as published documents — setbacks, ground
coverage, FAR and parking ratios by plot category. Until those are loaded, every
regulatory figure in the application is one the user typed in and attributed.

---

## 4. Pricing sources — none bundled

No price ships with this application. `docs/adr/0002-ship-an-empty-price-book.md` records
why: a rate with no source, no date and no confidence level is worse than no rate,
because it is quoted with the same confidence as a real one. The price book starts
empty, and `PriceLookup` makes an unavailable price structurally incapable of
carrying an amount — there is no `amount` field on that branch of the union, so
code cannot read a fabricated one.

Suppliers whose published rates would be the right first sources are listed in
`docs/LOCAL_PRICING_SOURCES.md`. All were unreachable from this machine.
