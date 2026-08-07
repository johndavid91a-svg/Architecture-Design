# Data model

All identifiers are branded string types, so a `RoomId` cannot be passed where a
`WallId` is expected. All lengths are millimetres.

## Entity relationships

```
Project
 ├── ArchitectureLayer          PROTECTED — see DIGITAL_TWIN.md
 │    └── Site
 │         ├── ProjectLocation  city, country, authority (CDA/RDA/…), lat/long
 │         ├── plotBoundary     Point2[]
 │         └── Building[]
 │              ├── footprint   Point2[]
 │              └── Floor[]     level, floorToFloor, clearHeight, elevation, purpose
 │                   ├── Room[]     boundary: Point2[], use, clearHeight, provenance
 │                   ├── Wall[]     start, end, thickness, height, function,
 │                   │    │         loadBearing, provenance
 │                   │    └── Opening[]  kind, distanceAlongWall, width, height,
 │                   │                   sillHeight, isEmergencyExit
 │                   ├── Column[]
 │                   └── Stair[]
 │
 └── Design[]                   FREELY CHANGEABLE
      ├── DesignOrigin          manual | ai | theme_applied | imported | duplicated
      ├── themeId?
      ├── FloorDesign[]
      │    └── RoomDesign[]
      │         ├── FinishAssignment[]   surface, materialId, wallId?, heightLimit?
      │         ├── CeilingTreatment     kind, materialId?, dropHeight?
      │         ├── LightingAssignment[] kind, count, watts, colour temperature
      │         └── FurniturePlacement[] catalogueKey, position, rotation, size
      └── ExteriorDesign        facadeSystem, finishes, lighting, signage, landscaping
```

Note that `RoomDesign` references `roomId` and holds no geometry. That is what
makes the two-layer separation structural rather than conventional.

## Catalogue

```
Material          id, name, category, basis (area|length|volume|count|mass),
                  takeoffUnit, defaultWastage, appearance, trades[]
   │
   └── Product    materialId, brand, specification, supplierId, priceUnit,
                  origin (PK|CN|AE|TR|IT|DE), MOQ, leadTime
        │
        └── PriceRecord   amount, currency, unit, sourceId, sourceTier,
                          sourceUrl, retrievedAt, verifiedAt, location,
                          specification, minimumQuantity, supersedesPriceId

Supplier          name, location, country, categories[], rating, yearsActive,
                  certifications[], currency, lastCheckedAt

FurnitureItem     key, name, category, width, depth, height, clearanceFront,
                  styles[], placeholderColor
```

**Material vs Product.** A material is a design-layer concept ("Statuario
marble, honed"). A product is the procurable thing a price attaches to
("Statuario marble slab 18 mm, Supplier X"). Keeping them apart is what lets the
procurement assistant answer "find three alternatives to this marble": the design
keeps referring to the same material while the product underneath changes.

**Product vs Price.** A product carries no price. Prices are separate records
with their own provenance and history, so one product can hold a supplier
quotation, a market listing and an official statistic simultaneously, each with
its own date and confidence.

## Pricing

```
PriceSource       id, name, tier, url, covers, caveats, cadence, region, connector
SourceTier        LEVEL_1_OFFICIAL | LEVEL_2_MARKET
                  | LEVEL_3_SUPPLIER_QUOTE | LEVEL_4_ESTIMATE
PriceLookup       discriminated union — available: true | false
ExchangeRate      from, to, rate, retrievedAt, sourceName, sourceUrl
LabourRate        trade, amount, currency, unit, location, source…, dates
```

## Derived — computed, never stored

```
QuantityLine      key, description, materialId?, unit, quantity, basis,
                  derivation, floorId?, roomId?, gap?
TakeoffResult     lines[], gaps[], summary
EstimateLine      netQuantity, wastageFraction, procurementQuantity,
                  materialRate?, materialCost?, materialConfidence?,
                  materialSourceUrl?, labourCost?, labourBreakdown[],
                  transport?, subtotal?, unpriced?
EstimateResult    totals, complete, completeness, unpricedLines[],
                  workerDaysByTrade, assumptions[], lowestConfidence
BoqRow            the 13 required columns
LandedCostBreakdown   the full duty/tax cascade
```

These are recomputed from the twin on every change rather than persisted.
Persisting a takeoff would create a second source of truth that can disagree with
the model, which is the failure the digital twin exists to prevent.

## Theme

```
Theme    id, name, family, identity, palette, materials (by role),
         ceilingKind, lighting, facadeSystem, signatureElements[],
         furnitureStyle, landscaping, avoid
```

Material preferences are keyed by **role** (`primaryFloor`, `featureWall`,
`ceiling`) rather than by product, so a theme survives catalogue changes and
carries no price.

## Persistence

One JSON document per project:

```json
{ "schemaVersion": 1, "savedAt": "ISO-8601", "project": { … } }
```

Opening a document with a higher `schemaVersion` fails loudly rather than
silently dropping unrecognised fields.

## Identifier prefixes

`prj_` project · `sit_` site · `bld_` building · `flr_` floor · `rm_` room ·
`wal_` wall · `opn_` opening · `dsg_` design · `ver_` version · `prc_` price ·
`lab_` labour rate · `fur_` furniture · `src_` source
