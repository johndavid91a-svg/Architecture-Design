# Development plan

Honest status against the nineteen phases. "Done" means implemented and tested,
not sketched.

## Complete

**Phase 1 — Project foundation.** Monorepo, Electron shell with context
isolation and CSP, JSON persistence with schema versioning, project creation from
manual measurements, unit system with exact imperial conversion and a parser that
refuses ambiguous input.

**Phase 3 (partial) — 3D digital twin.** Geometry extruded from the twin on
every load: floor slabs from room polygons, ceilings, walls built as the solid
pieces between openings, head and sill panels, glazing and door infill.

**Phase 4 — 3D navigation.** Orbit with drag and scroll; first-person walk with
WASD, mouse-look via pointer lock, run modifier, floor switching, and
capsule-versus-segment collision against wall centrelines — cheap, non-tunnelling
and computed from twin data rather than render geometry.

**Phase 6 — Theme engine.** Five themes as data, including Satellite Company and
GIS, each with palette, role-keyed materials, lighting character, signature
elements with rationale, and an `avoid` list. `themeToBrief` renders a theme as
the prose an agent receives.

**Phase 11 — Quantity takeoff.** Every line carries its derivation. Quantities a
floor plan cannot supply are reported as gaps rather than approximated.

**Phase 12 — Construction estimation.** Material and labour separated, wastage on
procurement only, productivity coefficients as stated assumptions, transport,
equipment, contingency. Unpriced lines excluded from the total with the total
labelled *at least*.

**Phase 14 — China landed cost.** The full duty → sales tax → withholding
cascade, MOQ overhang, provisional-rate warnings, four-verdict local-vs-import
comparison that names local as the winner when it wins.

**Phase 15 — BOQ.** All thirteen required columns, gap rows preserved, CSV export
with assumptions and the professional-review notice, and formula-injection
guarding on every cell.

## Partial

**Phase 2 — 2D architecture.** The plan renders correctly with true wall
thickness, openings colour-coded by kind, room labels with dimensions and area,
click selection, capacity estimation and a 1 m grid. It is **read-only**. Editing
— drag walls, add and move openings, snapping, layers, measurement tool — is the
next substantial piece of work, and it is what turns the manual-measurement path
from "close enough to start" into "matches the building".

**Phase 5 — Materials, furniture, lighting.** The catalogues exist with real
dimensions, wastage defaults, trades and PBR appearance hints, and drive the
takeoff and the clearance validator. They are not yet rendered in 3D and there is
no placement UI.

## Not started

| Phase | Notes |
| --- | --- |
| 7–10 — AI Architect, Interior, Exterior, Design Director | Contracts, ground rules and both validators are in place; the model calls are not wired. Deliberate ordering — see [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md). |
| 13 — Local Pakistan pricing connectors | Framework and registry complete. Every source is blocked by this build environment's network policy, so no connector could be written or verified here. |
| 16 — Value engineering | Specified in [PROCUREMENT_ENGINE.md](PROCUREMENT_ENGINE.md). |
| 17 — Presentation and export | CSV works. PDF, PPTX and image export not started. |
| 18 — Collaboration | Not started. |
| 19 — VR/AR | Not started. |

Also outstanding: drawing import (DXF, IFC, raster recognition — see
[GITHUB_INTEGRATION_PLAN.md](GITHUB_INTEGRATION_PLAN.md)), the CDA/RDA regulation
checker, daylight simulation, site context, supplier database, price history UI,
design versioning UI, before/after comparison, and multi-option generation.

## Suggested order

1. **2D editing.** Everything downstream is only as good as the twin, and the
   twin is currently only as good as what can be typed into a room table.
2. **AI Interior Designer, one room at a time.** The validators are built and the
   blast radius is small. It proves the propose → validate → correct loop end to
   end before the Design Director orchestrates anything.
3. **Price connectors, one source.** PBS or Brick Pakistan. Start with one and
   get the provenance, appending and staleness behaviour right against a live
   source.
4. **IFC import via web-ifc.** The highest-value import path, and the one with
   the least guesswork — IFC carries walls and spaces as entities, so nothing has
   to be inferred.
5. **Materials and furniture in 3D.** Turns the walkthrough from a shell into a
   design review tool.
6. **Presentation export.**

## Known limitations

- The manual-measurement layout arranges rooms in a strip with real partitions.
  Dimensions are exact from the first moment, but the arrangement is a starting
  point, not a plan. It needs the 2D editor to become a real building.
- Windows are placed by a default rule (one per ~4 m of external wall) and marked
  `inferred`. Only the first room's door is treated as an emergency exit by
  default; real escape routes must be set by the user, because marking every door
  an exit would make the clearance validator unusable.
- The renderer bundle is 1.2 MB, dominated by Three.js. Fine for a desktop
  application; worth code-splitting if a web build is ever wanted.
- No SQLite yet. See [ARCHITECTURE.md](ARCHITECTURE.md) for when that changes.
