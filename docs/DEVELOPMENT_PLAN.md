# Development plan

Honest status against the nineteen phases. "Done" means implemented, tested and
exercised end to end — not sketched.

## Complete

**Phase 1 — Project foundation.** Monorepo, Electron shell with context
isolation and CSP, JSON persistence with schema versioning and path-traversal
refusal, project creation from manual measurements, unit system with exact
imperial conversion and a parser that refuses ambiguous input.

**Phase 2 — 2D architecture.** Editable plan: drag rooms and walls with 3-inch
snapping, resize rooms numerically, edit wall thickness and load-bearing flag,
add and remove doors and windows, undo and redo. Every edit routes through the
integrity guard with an authorisation minted from the user's own gesture, and a
refused edit states its reason rather than dying silently.

**Phase 3 — 3D digital twin.** Geometry extruded from the architecture layer on
every load: floor slabs, ceilings, walls built as the solid pieces between
openings, head and sill panels, glazing and door infill. Materials and furniture
come from the design layer, so switching design options re-skins the same
building instead of rebuilding it.

**Phase 4 — 3D navigation.** Orbit with drag and scroll; first-person walk with
WASD, mouse-look via pointer lock, run modifier, floor switching, and
capsule-versus-segment collision against wall centrelines.

**Phase 5 — Materials, furniture, lighting.** Catalogues with real dimensions,
wastage defaults, trades and PBR appearance. Themes assign finishes; furniture
is laid out automatically and rendered in 3D; lighting counts are sized to an
illuminance target per room use.

**Phase 6 — Theme engine.** Five themes as data, including Satellite Company and
GIS, each with palette, role-keyed materials, lighting character, signature
elements with rationale, and an `avoid` list. `themeToBrief` renders a theme as
the prose an agent receives.

**Phase 8 — AI Interior Designer.** Wired end to end: prompt carrying real
geometry → model call from the main process → JSON extraction → catalogue and
clearance validation → apply, or re-prompt with the failing measurements, up to
three rounds. Degrades cleanly with a clear message when no API key is set.

**Phase 11 — Quantity takeoff.** Every line carries its derivation. Quantities a
floor plan cannot supply are reported as gaps rather than approximated.

**Phase 12 — Construction estimation.** Material and labour separated, wastage
on procurement only, productivity coefficients as stated assumptions, transport,
equipment, contingency. Unpriced lines excluded with the total labelled
*at least*.

**Phase 13 (partial) — Pricing input.** CSV price-list import with column
inference, material matching, per-row problem reporting and a template to hand a
supplier. Manual quotation and wage entry. Price history and trend analysis that
refuses to claim a direction from too few points or too short a window.

**Phase 14 — China landed cost.** Full duty → sales tax → withholding cascade,
MOQ overhang, provisional-rate warnings, four-verdict local-vs-import comparison
that names local as the winner when it wins.

**Phase 15 — BOQ.** All thirteen required columns, gap rows preserved, CSV export
with assumptions and the professional-review notice, formula-injection guarding.

**Phase 16 — Value engineering.** Curated substitution rules with honest quality
and visual consequences, recommendation strength demoted in client-facing rooms,
target-saving solver that says plainly when specification alone cannot reach the
target. Only proposes a swap where both sides are actually priced.

**Phase 17 — Presentation and export.** Self-contained HTML report rendered to
PDF through Electron's own print pipeline, so the file cannot disagree with the
preview. Cover, captured plan and 3D views, design rationale, areas, cost
summary, option comparison, full BOQ with gaps, labour, regulation observations,
assumptions and the notice.

**Also complete, outside the numbered phases:**

- **Design options and comparison.** Multiple designs over one architecture,
  cost-compared, with a line-level before/after diff showing exactly which items
  account for a difference.
- **Regulation checker.** FAR, coverage, height, floors, setbacks and parking
  against user-entered CDA/RDA parameters. No `pass` verdict exists in the type;
  a check either raises an observation or stays silent, and silence is not
  compliance.
- **Daylight.** NOAA solar position with a time-of-day slider, solstice presets
  and real cast shadows.

## Partial

**Phase 7 / 9 / 10 — AI Architect, Exterior Designer, Design Director.** The
contracts, ground rules, director prompt builder and both validators exist. Only
the Interior Designer has its call loop wired. The Architect deliberately
remains unwired: its output changes geometry and must route through explicit
user approval, which is a UI flow rather than a prompt.

## Not started

| Phase | Notes |
| --- | --- |
| 13 — Automated price connectors | Framework, registry and provenance complete; import and manual entry work. Every configured source is blocked by this build environment's network policy, so no fetcher could be written or verified here. |
| 18 — Collaboration | Not started. |
| 19 — VR/AR | Not started. |

Also outstanding: drawing import (DXF, IFC, raster recognition — see
[GITHUB_INTEGRATION_PLAN.md](GITHUB_INTEGRATION_PLAN.md)), a cross-project
supplier database, quotation extraction from PDF and images, site context
modelling, and PPTX export.

## Suggested order

1. **IFC import via web-ifc.** The highest-value remaining input path and the one
   with least guesswork — IFC carries walls and spaces as entities.
2. **Price connectors, one source at a time.** Start with PBS or Brick Pakistan
   on a machine that can reach them, and get provenance, appending and staleness
   right against a live source before adding a second.
3. **AI Design Director and Exterior Designer.** The Interior loop is the
   template; the Director needs a task-execution runner over it.
4. **AI Architect with an approval flow.** The validators exist; what is missing
   is the UI that shows a proposed layout, gets explicit authorisation, and
   records it.
5. **Quotation extraction from PDF.** Parsing must run in the main process —
   supplier PDFs are untrusted input.

## Known limitations

- The manual-measurement layout arranges rooms in a strip with real partitions.
  Dimensions are exact from the first moment, but the arrangement is a starting
  point; the plan editor exists to move it onto the real building.
- Resizing a room moves its own walls but **refuses** when that would move a
  partition shared with an adjoining room, because moving it would silently
  change the neighbour's size without changing the neighbour's polygon. Move the
  partition itself instead.
- Wall finishes render per wall, not per face. Where two rooms share a wall the
  first room's finish wins in the 3D view; the takeoff still measures both rooms
  correctly, because it works from room perimeters rather than wall faces.
- Windows are placed by a default rule (one per ~4 m of external wall) and marked
  `inferred`. Only the first room's door is an emergency exit by default; real
  escape routes must be set by the user, because marking every door an exit would
  make the clearance validator unusable.
- The renderer bundle is 1.4 MB, dominated by Three.js. Fine for a desktop
  application; worth code-splitting if a web build is ever wanted.
- No SQLite yet. See [ARCHITECTURE.md](ARCHITECTURE.md) for when that changes.
