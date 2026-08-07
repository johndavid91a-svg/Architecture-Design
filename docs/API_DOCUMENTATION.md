# API — `@adp/core`

Pure TypeScript. No Electron, no DOM. Every number a user sees passes through
here.

```ts
import { createProject, computeTakeoff, estimate /* … */ } from '@adp/core';
```

## Units

```ts
toMm(value, 'ft' | 'in' | 'm' | 'cm' | 'mm'): Millimetres   // quantised to 1 nm
fromMm(mm, unit): number
toMm2 / fromMm2 / toMm3 / fromMm3

parseLength(input: string, defaultUnit = 'ft'): Millimetres | null
formatLength(mm, unit, { imperialInches?: boolean }): string
```

`parseLength` returns `null` rather than guessing. Callers must handle it — a
silent wrong guess corrupts the twin and everything derived from it.

## Geometry

```ts
polygonArea(polygon): SquareMillimetres        // shoelace, absolute
signedArea(polygon): SquareMillimetres         // sign gives winding
polygonPerimeter(polygon): Millimetres
centroid(polygon): Point2
boundsOf(points): Bounds
pointInPolygon(point, polygon): boolean
distancePointToSegment(p, a, b): Millimetres
rectCorners(rect: OrientedRect): Point2[]
rectsOverlap(a, b): boolean                    // separating-axis test
rectInsidePolygon(rect, polygon): boolean
rectangleBoundary(origin, width, depth): Point2[]
```

## Project

```ts
createProject(spec: ProjectSpec, nowIso: string): Project
buildFloorFromRooms(spec: FloorSpec, buildingId): Floor
allFloors(project): readonly Floor[]           // level order
findRoom(project, roomId): { floor, room } | undefined
activeDesign(project): Design | undefined
```

## Integrity guard

```ts
fingerprintArchitecture(arch): GeometryFingerprint

withArchitecturalIntegrity<T>(
  arch,
  operation: () => { architecture: ArchitectureLayer; result: T },
  authorisation?: ArchitecturalChangeAuthorisation,
): { architecture: ArchitectureLayer; result: T }
// throws ArchitecturalIntegrityError on an unauthorised geometry change

assertGeometryUnchanged(before, after): void
```

Route every AI design operation through `withArchitecturalIntegrity`. See
[DIGITAL_TWIN.md](DIGITAL_TWIN.md).

## Clearance

```ts
validatePlacements(room, furniture, walls, rules?): ClearanceViolation[]
hasBlockingViolations(violations): boolean
violationsToCorrectionBrief(violations): string   // feed back to the agent
estimateCapacity(room, areaSqft): CapacityEstimate
DEFAULT_CLEARANCE: ClearanceRules
```

Violations carry `measured: { actualMm, requiredMm }` where a distance failed, so
re-prompting can be specific.

## Takeoff

```ts
computeTakeoff(floors: readonly Floor[], design?: Design): TakeoffResult
consolidate(lines): QuantityLine[]
```

`TakeoffResult.lines` carry a `derivation` string; `TakeoffResult.gaps` carry
quantities that require engineering input.

## Pricing

```ts
selectBestPrice(records, now, requestedProductId?): PriceLookup
confidenceOf(record, now): 'HIGH' | 'MEDIUM' | 'LOW'
isStale(record, now): boolean
ageInDays(record, now): number
unavailable(productId, reason, staleRecords?): PriceLookup
convert(amount, from, to, rates): { ok: true; amount; rate } | { ok: false }

PAKISTAN_SOURCES, CHINA_SOURCES, allKnownSources(), findSource(id)
STALENESS_DAYS, SOURCE_TIER_ORDER
```

`PriceLookup` is a discriminated union. There is no `amount` on the unavailable
branch, by design.

## Estimation

```ts
estimate(
  quantities: readonly QuantityLine[],
  resolvePrice: (materialId, scenario) => PriceLookup,
  resolveLabour: (trade) => LabourRateLookup,
  settings?: EstimateSettings,
): EstimateResult

totalCaveat(result): string        // display beside the total
DEFAULT_SETTINGS, DEFAULT_PRODUCTIVITY_MAPPING
PRODUCTIVITY, findProductivity(key), planCrew(workerDaysByTrade, targetDays?)
```

Check `result.complete` before presenting `result.total` as final.

## Sourcing

```ts
computeLandedCost(input: ImportInput): LandedCostOutcome
compareSourcing(params): SourcingComparison
```

`ImportInput` requires a `DutySchedule` carrying its PCT code, source URL, read
date and `provisional` flag. There are no default rates.

## BOQ

```ts
buildBoq(result: EstimateResult): BoqRow[]
boqToCsv(rows, result): string
reportSections(result, caveat): EstimateReportSections
BOQ_COLUMNS, BOQ_HEADERS, PROFESSIONAL_REVIEW_NOTICE
```

`boqToCsv` neutralises leading `=`, `+`, `-` and `@` so a spreadsheet cannot be
made to treat a BOQ cell as a formula.

## Catalogue and themes

```ts
BASE_MATERIALS, findMaterial(id), TRADE_LABELS
FURNITURE, findFurniture(key), furnitureForStyle(style)
THEMES, findTheme(id), themesByFamily(family), themeToBrief(theme)
```

## AI contracts

```ts
AGENT_GROUND_RULES: string     // shared system-prompt fragment

DesignRequest, DirectorPlan, DirectorTask
InteriorProposal, ExteriorProposal, ArchitecturalProposal
DesignOption, ValueEngineeringSuggestion, BrandContext
```

`ArchitecturalProposal.requiresProfessionalReview` is the literal `true`, so it
cannot be omitted at a call site.

---

## Desktop bridge — `window.desktop`

```ts
saveProject(project): Promise<ProjectSummary>
loadProject(id): Promise<Project | null>
listProjects(): Promise<ProjectSummary[]>
exportCsv({ suggestedName, contents }): Promise<ExportResult>
exportJson({ suggestedName, contents }): Promise<ExportResult>
appInfo(): Promise<AppInfo>
```

Six functions, deliberately. There is no generic `invoke(channel, payload)`,
because that would hand the renderer the whole main process and undo context
isolation.
