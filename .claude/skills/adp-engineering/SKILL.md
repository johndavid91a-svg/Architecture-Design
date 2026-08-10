---
name: adp-engineering
description: The non-negotiable rules of the Architecture Design codebase — dimensions are never altered, prices and limits are never invented, refusing beats guessing, and a feature is not done until it has been run against a real file. Use when adding or changing anything in packages/core or packages/desktop, reviewing a change, deciding how to handle missing data, or writing tests for this repo.
---

# How this codebase is built

## The four rules

### 1. Dimensions are sacred

The architecture layer — walls, rooms, heights, openings — is separate from the
design layer, and a design operation that alters geometry is **rejected at
runtime**, not discouraged in a prompt. A room entered as 15 × 20 ft is stored as
exactly 4572 × 6096 mm and every quantity is computed from that polygon.

- Millimetres are canonical. Imperial conversions use exact factors and are
  quantised to the nanometre (`toMm`).
- A layout engine places rooms; it never resizes one to make a plate tidy. If a
  coherent plan is wanted, the *brief* has to be coherent.
- There is a test asserting an authored 16 m dome still measures 16 m after
  layout. Add its equivalent whenever you write a generator.

### 2. Never invent a number

A figure with no provenance is worse than no figure, because it is quoted with
the same confidence as a real one.

- `PriceLookup` has **no `amount` field** on its unavailable branch, so code
  physically cannot read a fabricated price.
- Planning limits cannot be saved without naming the bye-law they came from.
- The regulation checker has **no pass verdict**. It reports `exceeds_limit`,
  `near_limit` or `not_checkable`. Silence means "nothing detected", never
  "compliant".
- The price book ships empty on purpose (`docs/adr/0002-ship-an-empty-price-book.md`).

### 3. Refuse rather than guess

A wrong scale produces a complete, plausible model of the wrong building, and
nothing downstream can detect it. So:

- An unreadable dimension is rejected, not interpreted.
- An uncalibrated PDF gets `toMmScale: 0` — obviously broken — never the
  tempting default of `1.0`.
- A drawing whose extent implies a building under 3 m across is refused with
  the reason and the remedy.
- Every refusal carries a `remedy`. "No rooms found" is useless; "the wall
  centrelines leave gaps, close them in the plan editor" is not.

Imported elements carry `extracted` / `inferred` / `verified` confidence, and
that survives into the model. Only a file that *declares* a wall earns
`verified`.

### 4. A feature is not done until it has been run against a real file

Every serious bug in this repo's history was found by running real input, and
several were invisible to a full green test suite:

- `insetFace` averaged two perpendicular corner normals instead of mitring them:
  every imported room came out 6% too large. Tests passed.
- The face walk turned the wrong way at T-junctions, so rooms either side of a
  partition traced as one. Invisible on the single rectangle every test used.
- `destroy()` was called on the pdf.js document proxy, where it does not exist.
  It threw from a `finally`, so **PDF import could not succeed on any
  platform** — and no test touched the module, so a dead feature looked healthy.
- The packaged app resolved `web-ifc/package.json`, which its `exports` map does
  not expose. IFC import would have thrown on the first file a user opened.

Consequences for how you work here:

- **Test the wiring, not just the logic.** The bugs above lived in the seams —
  packaging, module resolution, cleanup paths. `tools/test-main-import.mjs`
  exists because every other harness bypassed the real entry point.
- **Verify a new test has teeth.** Reintroduce the bug and watch it fail.
- **Read the output, do not just count passes.** Two defects were found by
  looking at a screenshot after every assertion had gone green.
- **Beware a band wide enough to hide the bug.** One test asserted an area
  between 20 and 24 m² where the fixture's own geometry states 19.61. Assert the
  fixture's stated truth, not a plausible range.

## Ground truth

Prefer input that states its own answers, and check against those:

- IFC: `Qto_SpaceBaseQuantities` for areas, `IfcMaterialLayerSet` for wall
  thickness, declared `Axis` for centrelines. Imported areas land within 0.5%
  mean of the file's own figures.
- PDF: the `/VP` `/Measure` viewport factor is the scale the plotter recorded.
- Never validate against a recollection of what a building looks like.

## Where things live

```
packages/core      Pure TypeScript. No Electron, no DOM. Every number a user
                   sees passes through here.
  model/           The twin: architecture layer, design layer, integrity guard
  import/          IFC, DXF, PDF -> candidates (never the master record)
  layout/          Room placement; never alters a dimension
  templates/       Worked buildings, e.g. the Space Centre
  takeoff/ estimate/ pricing/ regulation/
packages/desktop   Electron main, preload, renderer
tools/             Harnesses that drive real files and the real app
```

Security posture: `contextIsolation: true`, `nodeIntegration: false`, strict CSP,
a narrow typed preload bridge, and **all parsing in the main process** — a
drawing is untrusted input.

## Verification suite

```bash
npm test                                   # unit and integration
npm run typecheck --workspace @adp/core
npm run typecheck --workspace @adp/desktop
node tools/scenarios.mjs                   # generated buildings, Pakistani plots
node tools/space-centre-check.mjs          # the worked design
node tools/test-main-import.mjs            # the real main-process import path
npx electron tools/test-planning-persistence.cjs
```

Run the lot before claiming anything is done, and say plainly what was not run.
