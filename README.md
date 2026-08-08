# Architecture Design

A desktop application that builds a measured digital twin of a real building,
lets AI redesign it at building, floor and room level without touching its
geometry, and turns the result into quantities, a bill of quantities and a cost
estimate with every price traceable to a source and a date.

It is not an image generator. Nothing it produces is a picture of a plausible
building; everything is derived from the dimensions of an actual one.

## Status

Working end to end: **127 unit tests** over the calculation engines, **96 checks**
across six generated buildings on real Pakistani plot sizes, and an **18-step
journey** driving the built application through every screen. The IFC importer is
validated against **12 published reference buildings**, with imported room areas
within **0.5% mean** of each file's own declared quantities.

What exists is real and verified; what does not is listed plainly in
[`FINAL_VALIDATION.md`](FINAL_VALIDATION.md) §4 and
[`docs/DEVELOPMENT_PLAN.md`](docs/DEVELOPMENT_PLAN.md).

| Working now | Not yet built |
| --- | --- |
| Digital twin from manual measurements | PDF scale calibration UI (IFC and DXF work end to end) |
| Drawing import from IFC and DXF, layer-aware, validated against real buildings | Raster (scanned) drawing recognition |
| Vertical circulation: stair and lift cores as real rooms, in the takeoff | Curved-wall recognition in DXF |
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
npm test          # 127 tests over the calculation engines
npm run dev       # launch the desktop app
```

Node 20.19+ required. Full instructions in [`docs/SETUP.md`](docs/SETUP.md).

### A desktop icon instead of a command

Double-click one file in this folder. No terminal, nothing to remember:

| You are on | Double-click |
| --- | --- |
| Windows | **`Install Desktop Icon.bat`** |
| macOS or Linux | **`Install Desktop Icon.command`** |

It installs the dependencies, builds a standalone application, and puts
**Architecture Design** on your desktop and in your applications menu. The first
run takes a few minutes because it downloads Electron; after that it is seconds.
The only prerequisite is [Node.js](https://nodejs.org) 20.19 or later — it says
so plainly and stops if it is missing.

If packaging fails for any reason, it does not give up: the icon it creates
starts the project directly instead. Slower to open, but it works.

The same thing from a terminal, if you prefer:

```bash
node tools/setup-desktop.mjs   # everything, in one go
```

or step by step:

```bash
npm run dist          # build a real installable application
npm run desktop-icon  # put it on the desktop and in the applications menu
```

`npm run dist` writes an installer for whatever machine you run it on into
`packages/desktop/release/` — `.exe` on Windows, `.dmg` on macOS, `AppImage` and
`.deb` on Linux. On Windows the installer creates the desktop and Start-menu
shortcuts itself.

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
| [RESOURCES_AND_SOURCES.md](RESOURCES_AND_SOURCES.md) | Every library and reference building used, with licences and why |
| [TESTING_REPORT.md](TESTING_REPORT.md) | What was run, what it measured, and every defect found and fixed |
| [FINAL_VALIDATION.md](FINAL_VALIDATION.md) | Readiness checklist, known limitations, and what access is still needed |

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
