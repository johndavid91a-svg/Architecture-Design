# Architecture Design

A desktop application that builds a measured digital twin of a real building,
lets AI redesign it at building, floor and room level without touching its
geometry, and turns the result into quantities, a bill of quantities and a cost
estimate with every price traceable to a source and a date.

It is not an image generator. Nothing it produces is a picture of a plausible
building; everything is derived from the dimensions of an actual one.

## Status

Working end to end: **109 unit tests** over the calculation engines and **34
end-to-end checks** driving the built application through every screen. What
exists is real and verified; what does not is listed plainly in
[`docs/DEVELOPMENT_PLAN.md`](docs/DEVELOPMENT_PLAN.md).

| Working now | Not yet built |
| --- | --- |
| Digital twin from manual measurements | Drawing import (DXF, IFC, raster recognition) |
| Architecture / design layer separation, enforced at runtime | AI Architect, Exterior Designer and Design Director call loops |
| Editable 2D plan: drag, resize, openings, undo/redo | Automated price connectors (blocked by network policy — see below) |
| 3D twin with materials, furniture, daylight and shadows | Cross-project supplier database |
| First-person walkthrough with wall collision | Quotation extraction from PDF and images |
| Theme engine applying finishes, lighting and furniture layouts | Site context modelling, PPTX export |
| AI Interior Designer with a validate-and-correct loop | Collaboration, VR/AR |
| Design options with cost comparison and line-level before/after | |
| Quantity takeoff with a derivation on every line | |
| Estimation with material, labour, wastage, transport, contingency | |
| Provenance-tracked pricing that never fabricates a figure | |
| CSV price-list import, price history and trends | |
| China landed-cost model and local-vs-import comparison | |
| Value engineering with honest quality trade-offs | |
| CDA / RDA regulation observations | |
| BOQ, CSV export and a full PDF report | |

## Quick start

```bash
npm install
npm test          # 109 tests over the calculation engines
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

**AI proposals are validated, not trusted.** A model asked to furnish a 3 m room
will specify a 3.6 m table — reliably, because it is reasoning about what the
room should feel like rather than whether the furniture fits. So every proposal
is checked against the real geometry, and a failure is fed back with the exact
measurements that failed rather than retried blindly. See
[`docs/AI_ARCHITECTURE.md`](docs/AI_ARCHITECTURE.md).

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
