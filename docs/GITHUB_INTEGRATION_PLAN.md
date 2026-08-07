# Open-source integration plan

Requirement 58 is the operative constraint: do not download dozens of
repositories to satisfy a checklist. Find the strongest ones, integrate only
where they add real value, keep them organised, preserve licences.

What follows is a short list evaluated against that. Anything not listed was
either redundant with something here or not worth its integration cost.

## Currently integrated

| Component | Licence | Why |
| --- | --- | --- |
| [three.js](https://github.com/mrdoob/three.js) | MIT | The 3D twin, walkthrough and collision. Mature, huge ecosystem, no viable alternative at this scale. Used directly rather than through a wrapper — the scene is generated from the twin, not authored, so a declarative layer would add indirection without saving code. |
| [React](https://github.com/facebook/react) | MIT | Renderer UI. |
| [Electron](https://github.com/electron/electron) | MIT | Desktop shell. Chosen over Tauri for WebGL maturity and because Node in the main process is where drawing parsing and price connectors will live. |
| [electron-vite](https://github.com/alex8088/electron-vite) | MIT | Main/preload/renderer build. |
| [Vitest](https://github.com/vitest-dev/vitest) | MIT | Engine tests. |

Deliberately absent: a geometry library. The operations needed — polygon area,
perimeter, centroid, point-in-polygon, SAT overlap, point-to-segment distance —
are a few hundred lines, and they sit between the drawing and the invoice. A
third-party library would introduce its own floating-point conventions there
without saving meaningful work. Implemented in `packages/core/src/geometry.ts`
and unit-tested.

## Evaluated and planned

### Drawing and BIM import

**[web-ifc](https://github.com/ThatOpen/engine_web-ifc)** — MPL-2.0. Part of the
That Open Company (formerly IFC.js) stack. Reads and writes IFC at near-native
speed via WebAssembly, runs entirely client-side with no cloud service. The
strongest option for IFC by a clear margin.

*Recommended.* MPL-2.0 is file-level copyleft: modifications to web-ifc's own
files must be published, but linking it into a proprietary application is fine.
Keep it unmodified in a dedicated adapter module and there is no obligation
beyond attribution.

*Integration:* map IFC entities to the architecture layer —
`IfcWall`/`IfcWallStandardCase` → `Wall`, `IfcSpace` → `Room`, `IfcDoor` and
`IfcWindow` → `Opening`, `IfcBuildingStorey` → `Floor`. IFC works in metres;
convert once at the adapter boundary. Imported dimensions get
`confidence: 'verified'` where the IFC is dimensioned, `'extracted'` where
inferred.

**[web-ifc-viewer](https://github.com/ThatOpen/web-ifc-viewer)** — MPL-2.0.
*Not recommended.* It is a viewer, and this application does not view an IFC
file — it ingests one into a twin it then owns. Adopting the viewer would mean
maintaining two 3D pipelines.

**[xeokit-bim-viewer](https://github.com/xeokit/xeokit-bim-viewer)** — AGPL-3.0
with a commercial option. Technically strong, particularly on large federated
models with double-precision coordinates. *Not recommended for now:* AGPL is
incompatible with commercial distribution without buying a licence, and the
capability it adds beyond three.js plus web-ifc is not needed at this scale.

**DXF** — evaluate `dxf-parser` (MIT) for entity extraction. DXF is a drawing
format, not a building model: it gives lines and text, not walls and rooms.
Extraction is therefore a heuristic problem (parallel line pairs → walls, closed
regions → rooms, dimension text → measurements), and everything it produces must
land as `extracted` and be routed through user verification. DWG is not directly
readable; convert to DXF or IFC first.

### Raster floor-plan recognition

**[CubiCasa5K](https://github.com/CubiCasa/CubiCasa5k)** — dataset and model,
5,000 annotated plans with SVG vector annotations, using the architecture from
*Raster-to-Vector: Revisiting Floorplan Transformation*. The best-known public
dataset in this space.

*Recommended as a research baseline, not as a shipped dependency.* Two reasons.
The published work is a research codebase, not a maintained library — independent
efforts such as [FloorPlanAnalyzer](https://github.com/mageaustralia/FloorPlanAnalyzer)
report that the CubiCasa5K method "shows the most promise but still requires
refinement". And the dataset is predominantly Scandinavian residential plans,
which transfers poorly to Pakistani commercial drawing conventions.

*Approach:* treat raster recognition as a proposal generator whose output is
always `extracted` and always verified by the user, dimension by dimension. A
recognition pipeline that silently produces a wrong wall is worse than no
pipeline, because the error propagates into every quantity and every cost. Check
the licence terms of the dataset and the pretrained weights separately before
shipping either.

Related work worth reading rather than depending on: the
[room-boundary-guided attention](https://arxiv.org/pdf/1908.11025) multi-task
network, and graph-neural-network line-segment parsing.

### Quantity takeoff and estimation

Surveyed; nothing recommended for integration. The open-source projects in this
space are either tied to a specific BIM authoring tool, encode a national
schedule of rates that does not apply here, or are abandoned. The takeoff and
estimation engines are the product's core value and are implemented directly,
where their rules can be documented, tested and defended line by line.

### Assets

Furniture and material libraries are a licensing problem before they are a
technical one. Any 3D asset shipped in a commercial product needs a licence
permitting redistribution — CC0 or an explicit commercial licence. Candidates
worth evaluating carefully: Poly Haven (CC0) for PBR materials, and CC0 model
sets for furniture. The catalogue currently uses dimensioned placeholder
geometry, which is sufficient for clearance validation and capacity estimation —
the parts that affect the numbers.

## Rules for adding a dependency

1. **Licence first.** MIT, Apache-2.0, BSD and MPL-2.0 are fine. AGPL is not,
   without a commercial licence. Record the licence in this document.
2. **Isolate it.** Third-party integration lives behind an adapter module. The
   domain model never imports a vendor type.
3. **The core stays pure.** `@adp/core` takes no dependency that assumes a
   browser, Electron or a filesystem.
4. **Preserve attribution.** Licence text ships with the application.
5. **Justify it in writing.** A dependency that cannot be justified in a
   paragraph here should be a few hundred lines of our own code instead.
