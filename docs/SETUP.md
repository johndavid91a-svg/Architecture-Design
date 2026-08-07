# Setup

## Requirements

- Node.js 20.19 or newer (22.x recommended; developed on 22.22)
- npm 10 or newer
- A GPU with WebGL 2 for the 3D view. Software rendering works but is slow.

Linux additionally needs the usual Electron runtime libraries: `libgtk-3-0`,
`libnss3`, `libasound2`, `libgbm1`.

## Install and run

```bash
git clone https://github.com/johndavid91a-svg/Architecture-Design.git
cd Architecture-Design
npm install          # also downloads the Electron binary (~100 MB)
npm run dev          # launches the app with hot reload
```

## Commands

| Command | Effect |
| --- | --- |
| `npm run dev` | Launch with hot reload |
| `npm test` | Run the engine tests (46, about one second) |
| `npm run typecheck` | Typecheck every package |
| `npm run build` | Build core, then main, preload and renderer |
| `npm run dist` | Build and package an unpacked application |
| `npm run test:watch --workspace @adp/core` | Tests in watch mode |

## Layout

```
packages/core/src/
├── units.ts              canonical millimetres, parsing, formatting
├── geometry.ts           area, perimeter, centroid, SAT overlap, distances
├── project.ts            project assembly, manual-measurement path
├── model/
│   ├── architecture.ts   PROTECTED layer
│   ├── design.ts         design layer
│   ├── guard.ts          geometry fingerprint and integrity guard
│   └── ids.ts            branded identifiers
├── catalogue/            materials, furniture
├── themes/theme.ts       theme engine
├── design/clearance.ts   space-aware validation, capacity
├── takeoff/takeoff.ts    quantity derivation
├── pricing/              source registry, price records, lookups
├── estimate/             labour model, cost build-up
├── sourcing/             landed cost, local-vs-import comparison
├── boq/boq.ts            bill of quantities, CSV
└── ai/contracts.ts       agent contracts and ground rules

packages/desktop/src/
├── main/                 window, IPC, storage
├── preload/              six-function context bridge
├── shared/ipc.ts         IPC contract
└── renderer/src/
    ├── App.tsx
    ├── state/price-book.ts
    └── views/            Setup, Plan, Walkthrough, Takeoff, Estimate,
                          Themes, Sources
```

## Where data lives

Projects are JSON documents under the Electron user-data directory:

- Linux — `~/.config/@adp/desktop/projects/`
- macOS — `~/Library/Application Support/@adp/desktop/projects/`
- Windows — `%APPDATA%\@adp\desktop\projects\`

The exact path is shown by the `appInfo` bridge call. Files are readable and
diffable on purpose.

## Running headless (CI)

Electron needs a display. Under CI:

```bash
xvfb-run -a --server-args="-screen 0 1600x1000x24" npx electron --no-sandbox <script>
```

`--no-sandbox` is required only when running as root, which is normal in
containers and should never be used on a developer machine.

## Conventions

- **Millimetres everywhere** inside `@adp/core`. Convert at the edges only.
- **The core takes no browser, Electron or filesystem dependency.** It must keep
  running under plain Node.
- **No fabricated prices.** If a figure cannot be sourced, return a gap. This is
  enforced by the `PriceLookup` union, so working around it requires effort —
  which is the point.
- **Third-party code lives behind an adapter.** The domain model never imports a
  vendor type.
- Tests target the product's claims, not line coverage.
