# Architecture

## Shape of the system

```
┌──────────────────────────── Electron ────────────────────────────┐
│                                                                  │
│  MAIN PROCESS                          RENDERER PROCESS          │
│  ┌────────────────────┐                ┌──────────────────────┐  │
│  │ window lifecycle   │                │ React UI             │  │
│  │ project storage    │◀── preload ───▶│  ├ 2D plan (canvas)  │  │
│  │ file dialogs       │    bridge      │  ├ 3D (Three.js)     │  │
│  │ price connectors * │   6 functions  │  ├ takeoff / BOQ     │  │
│  │ AI calls *         │                │  └ themes / sources  │  │
│  └─────────┬──────────┘                └──────────┬───────────┘  │
│            │                                      │              │
│            └──────────────┬───────────────────────┘              │
│                           ▼                                      │
│                    ┌──────────────┐                              │
│                    │  @adp/core   │  pure TypeScript             │
│                    │              │  no Electron, no DOM         │
│                    └──────────────┘                              │
└──────────────────────────────────────────────────────────────────┘
                                                    * not yet implemented
```

## Why the core is a separate, dependency-free package

`@adp/core` holds the domain model and every calculation: geometry, quantity
takeoff, estimation, pricing rules, landed cost, clearance validation, theme
definitions and the AI contracts. It imports nothing from Electron, the DOM or
React.

Three things follow from that, and each was the reason:

**The engines are testable without a browser.** 46 tests run in under a second
under plain Node. Testing a cost calculation through a rendered UI is slow
enough that it stops happening, and the numbers are the part that must be right.

**The same code runs on both sides of the IPC boundary.** The renderer computes
a takeoff for display; the main process will compute the same takeoff when it
generates a report. If those were separate implementations they would drift, and
the drift would surface as a PDF that disagrees with the screen.

**Validation can run on AI output before it reaches the twin.** The clearance
validator and the geometry fingerprint are core functions, so an agent proposal
is checked in the same process that produced it, with no round trip.

## Process model and security

The renderer runs with `nodeIntegration: false` and `contextIsolation: true`. It
reaches the filesystem only through six named functions on the preload bridge —
save, load, list, export CSV, export JSON, app info. There is deliberately no
generic `invoke(channel, payload)` escape hatch, because that hands the renderer
the whole main process and undoes the isolation.

This matters more here than in a typical desktop app. The product's roadmap
involves parsing untrusted input: uploaded DWG and IFC files, supplier PDFs,
scraped supplier pages, AI responses. None of that should ever be parsed by code
holding Node privileges. The parsing work belongs in the main process behind a
narrow interface, or in a worker, and the architecture is set up now so that
adding it later does not require re-securing the app.

The renderer also carries a strict Content-Security-Policy that permits no
remote scripts, styles or connections. Every network call the product makes
belongs in the main process, where it can be logged and attributed to a named
price source — which is a requirement of the pricing model, not only of security.

## Data flow

```
manual measurements ─┐
drawing import (later)┼─▶ ARCHITECTURE LAYER ──┬──▶ 2D plan
                     ─┘   (walls, rooms,       │
                          openings, heights)   ├──▶ 3D twin + walkthrough
                                               │
                                               ├──▶ quantity takeoff
                                               │         │
                     DESIGN LAYER ─────────────┘         ▼
                     (finishes, furniture,          estimation ◀── price book
                      lighting, façade)                  │         (provenance)
                              ▲                          ▼
                              │                    BOQ + report
                        AI proposals
                     (validated, never
                      written directly)
```

The architecture layer is the single source of truth. The 2D view, the 3D view
and the takeoff are three renderings of the same numbers rather than three
models that must be kept in step. That is the whole point of a digital twin, and
it is why the 3D geometry is extruded fresh from the twin on every load instead
of being stored.

## Persistence

One JSON document per project under the Electron user-data directory, with a
schema version. JSON rather than a database at this stage because the twin is
the user's record of a real building: a readable file they can copy, diff, back
up and email is worth more than query performance they do not yet need. Opening
a document written by a newer schema fails loudly rather than dropping the
fields it does not recognise.

SQLite becomes worthwhile when price history and a cross-project supplier
database grow past what is sensible to hold in memory. The storage interface in
`packages/desktop/src/main/storage.ts` is four functions wide so that swap does
not reach the renderer.

## Unit discipline

One canonical internal unit — the millimetre — with conversion only at the
edges. Imperial factors are exact by definition (25.4 mm to the inch), and
`toMm` quantises to the nanometre to kill floating-point artefacts before they
reach a fingerprint, a derivation string or a dimension the user reads back.
Three.js works in metres, so the 3D view converts once at its boundary and
nowhere else.

## Testing posture

The tests target the claims the product makes, not line coverage:

- `units.test.ts` — dimensions survive round trips; unreadable input is refused
- `guard.test.ts` — geometry cannot be changed by a design operation, including
  through the JSON round trip an AI call makes
- `takeoff.test.ts` — quantities match the typed dimensions; gaps stay gaps
- `price.test.ts` — a missing price has no readable amount; stale is not fresh
- `estimate.test.ts` — unpriced lines are excluded and the total says so
- `landed-cost.test.ts` — duty, tax and withholding cascade rather than stacking
- `clearance.test.ts` — furniture that does not fit is rejected with measurements

Two real defects were caught by these during the initial build: the clearance
validator measured distance to rectangle *corners* rather than edges, reporting
ample clearance across a fully blocked doorway; and the estimator counted a
quantity line with no material assigned as priced at zero, making an empty
estimate report 76% complete.
