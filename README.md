# Architecture Design

A desktop application that builds a measured digital twin of a real building,
lets AI redesign it at building, floor and room level without touching its
geometry, and turns the result into quantities, a bill of quantities and a cost
estimate with every price traceable to a source and a date.

It is not an image generator. Nothing it produces is a picture of a plausible
building; everything is derived from the dimensions of an actual one.

## Status

Foundation, running end to end. What exists is real and tested; what does not
exist is listed plainly in [`docs/DEVELOPMENT_PLAN.md`](docs/DEVELOPMENT_PLAN.md).

| Working now | Not yet built |
| --- | --- |
| Digital twin from manual measurements | Drawing import (DXF, IFC, raster recognition) |
| Architecture / design layer separation, enforced at runtime | AI agent calls (contracts and validators are in place) |
| 2D plan with true wall thickness, openings, room selection | 2D editing — the plan is currently read-only |
| 3D model extruded from the twin, orbit and first-person walkthrough with collision | Materials and furniture in 3D, daylight simulation |
| Quantity takeoff with a derivation on every line | Multi-option design generation, before/after |
| Estimation with material, labour, wastage, transport, contingency | Presentation export (PDF, PPTX) |
| Provenance-tracked pricing that never fabricates a figure | Price connectors, supplier database, price history UI |
| China landed-cost model and local-vs-import comparison | Regulation checker (CDA / RDA) |
| BOQ generation and CSV export | Value engineering, procurement assistant |

## Quick start

```bash
npm install
npm test          # 46 tests over the calculation engines
npm run dev       # launch the desktop app
```

Node 20.19+ required. Full instructions in [`docs/SETUP.md`](docs/SETUP.md).

## The three decisions that shape everything else

**Dimensions are sacred.** The base architecture — walls, rooms, heights,
openings — is a separate layer from the design, and a design operation that
alters geometry is rejected at runtime, not merely discouraged in a prompt. A
room entered as 15 × 20 ft is stored as a polygon of exactly 4572 × 6096 mm and
every derived quantity is computed from that polygon. See
[`docs/DIGITAL_TWIN.md`](docs/DIGITAL_TWIN.md).

**Prices are never invented.** The application ships with an empty price book,
deliberately. A price that cannot be sourced is reported as a gap with a remedy,
the line stays visible in the BOQ, and the project total is presented as a floor
rather than a total. The type system enforces this: a failed price lookup has no
numeric field to read. See [`docs/PRICING_ENGINE.md`](docs/PRICING_ENGINE.md).

**Estimates say what they do not know.** Every quantity carries the rule that
produced it. Every price carries its source, URL, retrieval date and a
confidence that decays with age. Quantities that a floor plan genuinely cannot
supply — reinforcement steel, foundation volume — are reported as gaps requiring
engineering input rather than filled in with a rule of thumb.

## Documentation

| Document | What it covers |
| --- | --- |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System structure, package layout, process model |
| [DIGITAL_TWIN.md](docs/DIGITAL_TWIN.md) | The twin, the two layers, and how the integrity guard works |
| [DATA_MODEL.md](docs/DATA_MODEL.md) | Entities and their relationships |
| [ESTIMATION_ENGINE.md](docs/ESTIMATION_ENGINE.md) | Takeoff rules, labour model, cost build-up |
| [PRICING_ENGINE.md](docs/PRICING_ENGINE.md) | Source hierarchy, confidence, staleness, the no-fabrication rule |
| [LOCAL_PRICING_SOURCES.md](docs/LOCAL_PRICING_SOURCES.md) | Islamabad / Rawalpindi sources, what each is good for |
| [CHINA_IMPORT.md](docs/CHINA_IMPORT.md) | Landed-cost cascade and local-vs-import comparison |
| [PROCUREMENT_ENGINE.md](docs/PROCUREMENT_ENGINE.md) | Supplier model, alternatives, value engineering |
| [AI_ARCHITECTURE.md](docs/AI_ARCHITECTURE.md) | Design Director, agent contracts, validation loop |
| [GITHUB_INTEGRATION_PLAN.md](docs/GITHUB_INTEGRATION_PLAN.md) | Open-source components evaluated, with licences |
| [DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md) | Phases, what is done, what is next |
| [SETUP.md](docs/SETUP.md) | Development environment |
| [USER_MANUAL.md](docs/USER_MANUAL.md) | Using the application |
| [API_DOCUMENTATION.md](docs/API_DOCUMENTATION.md) | `@adp/core` public surface |
| [adr/](docs/adr/) | Architecture decision records |

## Layout

```
packages/
├── core/       Domain model and calculation engines. Pure TypeScript, no
│               Electron or DOM. Every number a user sees passes through here.
└── desktop/    Electron main, preload and React renderer.
```

## Professional review

This is a design and estimation aid. It is not a certified quantity survey, a
structural design, an MEP design, a fire-safety assessment or a regulatory
approval, and it does not replace a licensed architect, structural engineer, MEP
engineer or quantity surveyor. Every export carries this notice.
