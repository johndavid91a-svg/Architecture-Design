/**
 * QUANTITY TAKEOFF.
 *
 * Requirement 26: "The quantities must come from the actual model wherever
 * possible."
 *
 * Every line this engine emits carries a `derivation` string naming the rule
 * and the elements it consumed. That is not decoration either: a quantity
 * surveyor's first question about any number is "where did that come from",
 * and an estimate that cannot answer it cannot be checked, defended, or
 * corrected. It is also how a user finds the one mis-measured room behind a
 * total that looks wrong.
 *
 * Where a quantity genuinely cannot be derived from geometry — reinforcement
 * steel needs a structural design, not a floor plan — the engine says so
 * explicitly rather than applying a rule of thumb and presenting the result as
 * a measured quantity.
 */

import { polygonArea, polygonPerimeter } from '../geometry.js';
import type { Floor, Opening, Room, Wall } from '../model/architecture.js';
import type { FloorId, MaterialId, RoomId } from '../model/ids.js';
import type { Design, FinishAssignment, RoomDesign } from '../model/design.js';
import { findMaterial } from '../catalogue/materials.js';
import type { PriceUnit } from '../pricing/price.js';
import { fromMm, fromMm2 } from '../units.js';

/** How a quantity was arrived at. Drives the confidence badge in the BOQ. */
export type QuantityBasis =
  /** Computed from twin geometry. The default and the goal. */
  | 'measured_from_model'
  /** Computed from geometry via a conventional coefficient (e.g. bags per cft of mortar). */
  | 'derived_with_coefficient'
  /** Counted from model elements (doors, windows, light fittings). */
  | 'counted_from_model'
  /** Entered by the user because the model cannot supply it. */
  | 'user_supplied'
  /** Cannot be determined without engineering input. Reported as a gap, never guessed. */
  | 'requires_engineering';

export interface QuantityLine {
  readonly key: string;
  readonly description: string;
  readonly materialId?: MaterialId;
  readonly unit: PriceUnit;
  /** Net quantity before wastage. */
  readonly quantity: number;
  readonly basis: QuantityBasis;
  /** Human-readable audit trail: which rule, which elements, which dimensions. */
  readonly derivation: string;
  readonly floorId?: FloorId;
  readonly roomId?: RoomId;
  /** Set when `basis` is `requires_engineering`; explains what input is missing. */
  readonly gap?: string;
}

export interface TakeoffResult {
  readonly lines: readonly QuantityLine[];
  /** Lines that could not be quantified. Surfaced prominently, not buried. */
  readonly gaps: readonly QuantityLine[];
  readonly summary: TakeoffSummary;
}

export interface TakeoffSummary {
  readonly grossFloorAreaSqft: number;
  readonly roomCount: number;
  readonly doorCount: number;
  readonly windowCount: number;
  readonly floorCount: number;
}

/** Openings are subtracted from wall finishes above this size. */
const OPENING_DEDUCTION_THRESHOLD_MM2 = 0.5 * 1_000_000; // 0.5 m²

/**
 * Standard trade practice: openings below roughly half a square metre are not
 * deducted from plaster and paint, because the labour of working around a small
 * opening offsets the material saved. Deducting them would understate the cost.
 */
function deductibleOpeningAreaMm2(openings: readonly Opening[]): number {
  return openings
    .map((o) => o.width * o.height)
    .filter((a) => a >= OPENING_DEDUCTION_THRESHOLD_MM2)
    .reduce((a, b) => a + b, 0);
}

function wallLength(w: Wall): number {
  return Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
}

/**
 * Internal wall face area bounding a room.
 *
 * Uses the room's own polygon perimeter rather than summing bounding walls.
 * Wall centrelines are shared between adjacent rooms, so summing them would
 * double-count every partition. The room polygon is the finished face, which is
 * exactly the surface being plastered, painted or clad.
 */
function roomWallFaceAreaMm2(room: Room, walls: readonly Wall[]): { area: number; derivation: string } {
  const perimeter = polygonPerimeter(room.boundary);
  const gross = perimeter * room.clearHeight;

  const boundingWalls = walls.filter((w) => room.boundingWallIds.includes(w.id));
  const openings = boundingWalls.flatMap((w) => w.openings);
  const deduction = deductibleOpeningAreaMm2(openings);

  const derivation =
    `perimeter ${fromMm(perimeter, 'ft').toFixed(2)} ft x clear height ` +
    `${fromMm(room.clearHeight, 'ft').toFixed(2)} ft = ${fromMm2(gross, 'ft2').toFixed(2)} sq ft, ` +
    `less ${openings.length} opening(s) over 0.5 m² totalling ${fromMm2(deduction, 'ft2').toFixed(2)} sq ft`;

  return { area: Math.max(0, gross - deduction), derivation };
}


/**
 * The face area of ONE wall as it bounds a room.
 *
 * A finish naming a `wallId` is a feature wall, and it covers that wall and
 * nothing else. Measuring it over the whole room — which is what happened until
 * this existed — overstated a single feature wall by about 4.4x on the ground
 * floor hall, and left the base finish unreduced behind it. Wrong in both
 * directions at once, and both in the direction of a bigger bill.
 *
 * Only the run the wall SHARES with the room counts. A shell wall can run the
 * length of a building while the room touches a fraction of it.
 */
function oneWallFaceAreaMm2(
  room: Room,
  wall: Wall,
): { area: number; derivation: string } {
  const xs = room.boundary.map((p) => p.x);
  const ys = room.boundary.map((p) => p.y);
  const box = {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys),
  };
  const horizontal = Math.abs(wall.end.y - wall.start.y) < Math.abs(wall.end.x - wall.start.x);
  const [a, b, lo, hi] = horizontal
    ? [wall.start.x, wall.end.x, box.minX, box.maxX]
    : [wall.start.y, wall.end.y, box.minY, box.maxY];
  const run = Math.max(0, Math.min(Math.max(a, b), hi) - Math.max(Math.min(a, b), lo));
  const gross = run * room.clearHeight;
  const deduction = deductibleOpeningAreaMm2(wall.openings);
  return {
    area: Math.max(0, gross - deduction),
    derivation:
      `wall run shared with room ${fromMm(run, 'ft').toFixed(2)} ft x clear height ` +
      `${fromMm(room.clearHeight, 'ft').toFixed(2)} ft = ${fromMm2(gross, 'ft2').toFixed(2)} sq ft, ` +
      `less openings totalling ${fromMm2(deduction, 'ft2').toFixed(2)} sq ft`,
  };
}

function finishesFor(design: RoomDesign | undefined, surface: FinishAssignment['surface']): FinishAssignment[] {
  if (!design) return [];
  return design.finishes.filter((f) => f.surface === surface);
}

function priceUnitForArea(): PriceUnit {
  return 'sqft';
}

/**
 * Run the takeoff over one design applied to one architecture.
 *
 * The design is optional. Without it the engine still reports the shell
 * quantities that follow from geometry alone — floor area, wall area, opening
 * counts — which is what the user needs before any design exists.
 */
export function computeTakeoff(floors: readonly Floor[], design?: Design): TakeoffResult {
  const lines: QuantityLine[] = [];
  const gaps: QuantityLine[] = [];

  let grossFloorAreaMm2 = 0;
  let doorCount = 0;
  let windowCount = 0;
  let roomCount = 0;

  const designByFloor = new Map(design?.floors.map((f) => [f.floorId, f]) ?? []);

  for (const floor of floors) {
    const floorDesign = designByFloor.get(floor.id);
    const designByRoom = new Map(floorDesign?.rooms.map((r) => [r.roomId, r]) ?? []);

    for (const room of floor.rooms) {
      roomCount++;
      const areaMm2 = polygonArea(room.boundary);
      grossFloorAreaMm2 += areaMm2;
      const areaSqft = fromMm2(areaMm2, 'ft2');
      const roomDesign = designByRoom.get(room.id);

      // ---- Floor finish -------------------------------------------------
      const floorFinishes = finishesFor(roomDesign, 'floor');
      if (floorFinishes.length === 0) {
        lines.push({
          key: `floor_area:${room.id}`,
          description: `${room.name} — floor area (no finish selected)`,
          unit: 'sqft',
          quantity: areaSqft,
          basis: 'measured_from_model',
          derivation: `polygon area of ${room.boundary.length}-point room boundary`,
          floorId: floor.id,
          roomId: room.id,
        });
      }
      for (const finish of floorFinishes) {
        const material = findMaterial(finish.materialId);
        lines.push({
          key: `floor_finish:${room.id}:${finish.materialId}`,
          description: `${room.name} — ${material?.name ?? 'floor finish'}`,
          materialId: finish.materialId,
          unit: material?.takeoffUnit ?? priceUnitForArea(),
          quantity: areaSqft,
          basis: 'measured_from_model',
          derivation: `polygon area of room boundary = ${areaSqft.toFixed(2)} sq ft`,
          floorId: floor.id,
          roomId: room.id,
        });
      }

      // ---- Wall finishes ------------------------------------------------
      const wall = roomWallFaceAreaMm2(room, floor.walls);
      const wallSqft = fromMm2(wall.area, 'ft2');
      const wallFinishes = finishesFor(roomDesign, 'wall_internal');
      if (wallFinishes.length === 0) {
        lines.push({
          key: `wall_area:${room.id}`,
          description: `${room.name} — internal wall area (no finish selected)`,
          unit: 'sqft',
          quantity: wallSqft,
          basis: 'measured_from_model',
          derivation: wall.derivation,
          floorId: floor.id,
          roomId: room.id,
        });
      }
      // A FEATURE WALL IS ONE WALL, AND WHAT IS BEHIND IT IS NOT ALSO FINISHED.
      //
      // Each finish naming a `wallId` takes that wall's own face. What remains
      // of the room is then shared out among the finishes that name no wall: a
      // dado takes its height fraction of it and the full-height finish takes
      // what the dados leave. Before this, every finish was measured over the
      // whole room at full height — so a room with a feature wall and a dado
      // was billed roughly three times its own wall area.
      const featureFinishes = wallFinishes.filter((f) => f.wallId);
      const roomWideFinishes = wallFinishes.filter((f) => !f.wallId);

      let claimedSqft = 0;
      for (const finish of featureFinishes) {
        const namedWall = floor.walls.find((w) => w.id === finish.wallId);
        if (!namedWall) continue;
        const face = oneWallFaceAreaMm2(room, namedWall);
        const material = findMaterial(finish.materialId);
        const factor = finish.heightLimit ? Math.min(1, finish.heightLimit / room.clearHeight) : 1;
        const qty = fromMm2(face.area, 'ft2') * factor;
        claimedSqft += qty;
        lines.push({
          key: `wall_finish:${room.id}:${finish.materialId}:${finish.wallId}`,
          description: `${room.name} — ${material?.name ?? 'wall finish'} (feature wall)`,
          materialId: finish.materialId,
          unit: material?.takeoffUnit ?? priceUnitForArea(),
          quantity: qty,
          basis: 'measured_from_model',
          derivation: `${face.derivation}; one named wall, not the room`,
          floorId: floor.id,
          roomId: room.id,
        });
      }

      const remainingSqft = Math.max(0, wallSqft - claimedSqft);
      // Dados first, then whatever height they leave for the full-height finish.
      const dadoFraction = roomWideFinishes
        .filter((f) => f.heightLimit)
        .reduce((sum, f) => sum + Math.min(1, f.heightLimit! / room.clearHeight), 0);

      for (const finish of roomWideFinishes) {
        const material = findMaterial(finish.materialId);
        const factor = finish.heightLimit
          ? Math.min(1, finish.heightLimit / room.clearHeight)
          : Math.max(0, 1 - dadoFraction);
        const qty = remainingSqft * factor;
        lines.push({
          key: `wall_finish:${room.id}:${finish.materialId}:${finish.heightLimit ?? 'full'}`,
          description: `${room.name} — ${material?.name ?? 'wall finish'}${
            finish.heightLimit ? ` (to ${fromMm(finish.heightLimit, 'ft').toFixed(2)} ft)` : ''
          }`,
          materialId: finish.materialId,
          unit: material?.takeoffUnit ?? priceUnitForArea(),
          quantity: qty,
          basis: 'measured_from_model',
          derivation:
            `${wall.derivation}` +
            (claimedSqft > 0 ? `; less ${claimedSqft.toFixed(2)} sq ft of feature wall` : '') +
            (finish.heightLimit
              ? `; to height limit (factor ${factor.toFixed(3)})`
              : dadoFraction > 0
                ? `; above dado (factor ${factor.toFixed(3)})`
                : ''),
          floorId: floor.id,
          roomId: room.id,
        });
      }

      // ---- Ceiling ------------------------------------------------------
      if (roomDesign && roomDesign.ceiling.kind !== 'none' && roomDesign.ceiling.materialId) {
        const material = findMaterial(roomDesign.ceiling.materialId);
        lines.push({
          key: `ceiling:${room.id}`,
          description: `${room.name} — ${material?.name ?? 'ceiling'}`,
          materialId: roomDesign.ceiling.materialId,
          unit: material?.takeoffUnit ?? 'sqft',
          quantity: areaSqft,
          basis: 'measured_from_model',
          derivation: `ceiling area equals room polygon area = ${areaSqft.toFixed(2)} sq ft`,
          floorId: floor.id,
          roomId: room.id,
        });
      }

      // ---- Skirting -----------------------------------------------------
      const skirtingFinishes = finishesFor(roomDesign, 'skirting');
      if (skirtingFinishes.length > 0) {
        const doorWidths = floor.walls
          .filter((w) => room.boundingWallIds.includes(w.id))
          .flatMap((w) => w.openings)
          .filter((o) => o.kind === 'door' || o.kind === 'archway')
          .reduce((sum, o) => sum + o.width, 0);
        const netMm = Math.max(0, polygonPerimeter(room.boundary) - doorWidths);
        for (const finish of skirtingFinishes) {
          const material = findMaterial(finish.materialId);
          lines.push({
            key: `skirting:${room.id}:${finish.materialId}`,
            description: `${room.name} — ${material?.name ?? 'skirting'}`,
            materialId: finish.materialId,
            unit: 'rft',
            quantity: fromMm(netMm, 'ft'),
            basis: 'measured_from_model',
            derivation: `room perimeter less door openings (${fromMm(doorWidths, 'ft').toFixed(2)} ft deducted)`,
            floorId: floor.id,
            roomId: room.id,
          });
        }
      }

      // ---- Lighting and electrical --------------------------------------
      if (roomDesign) {
        const fittings = roomDesign.lighting.reduce((n, l) => n + l.count, 0);
        if (fittings > 0) {
          lines.push({
            key: `lighting:${room.id}`,
            description: `${room.name} — light fittings`,
            materialId: 'mat_light_fitting' as MaterialId,
            unit: 'each',
            quantity: fittings,
            basis: 'counted_from_model',
            derivation: `sum of ${roomDesign.lighting.length} lighting assignment(s) in the design layer`,
            floorId: floor.id,
            roomId: room.id,
          });
        }
      }
    }

    // ---- Openings, counted once per floor --------------------------------
    for (const w of floor.walls) {
      for (const o of w.openings) {
        if (o.kind === 'door' || o.kind === 'archway') doorCount++;
        if (o.kind === 'window') windowCount++;
      }
    }

    const floorDoors = floor.walls.flatMap((w) => w.openings).filter((o) => o.kind === 'door');
    if (floorDoors.length > 0) {
      lines.push({
        key: `doors:${floor.id}`,
        description: `${floor.name} — doors`,
        materialId: 'mat_door_flush' as MaterialId,
        unit: 'each',
        quantity: floorDoors.length,
        basis: 'counted_from_model',
        derivation: `count of door openings across ${floor.walls.length} walls`,
        floorId: floor.id,
      });
    }

    const floorWindows = floor.walls.flatMap((w) => w.openings).filter((o) => o.kind === 'window');
    if (floorWindows.length > 0) {
      const glassMm2 = floorWindows.reduce((sum, o) => sum + o.width * o.height, 0);
      const perimeterMm = floorWindows.reduce((sum, o) => sum + 2 * (o.width + o.height), 0);
      lines.push({
        key: `glazing:${floor.id}`,
        description: `${floor.name} — window glazing`,
        materialId: 'mat_glass_glazing' as MaterialId,
        unit: 'sqft',
        quantity: fromMm2(glassMm2, 'ft2'),
        basis: 'measured_from_model',
        derivation: `sum of width x height over ${floorWindows.length} window opening(s)`,
        floorId: floor.id,
      });
      lines.push({
        key: `window_frame:${floor.id}`,
        description: `${floor.name} — window frame section`,
        materialId: 'mat_aluminium_section' as MaterialId,
        unit: 'rft',
        quantity: fromMm(perimeterMm, 'ft'),
        basis: 'measured_from_model',
        derivation: `sum of 2 x (width + height) over ${floorWindows.length} window opening(s)`,
        floorId: floor.id,
      });
    }

    // ---- Masonry ---------------------------------------------------------
    for (const w of floor.walls) {
      const len = wallLength(w);
      const gross = len * w.height;
      const openingArea = w.openings.reduce((s, o) => s + o.width * o.height, 0);
      const netAreaMm2 = Math.max(0, gross - openingArea);
      const volumeMm3 = netAreaMm2 * w.thickness;
      lines.push({
        key: `masonry:${w.id}`,
        description: `Wall ${w.id.slice(-6)} — masonry (${w.function}, ${fromMm(w.thickness, 'in').toFixed(1)} in)`,
        unit: 'cft',
        quantity: volumeMm3 / 28_316_846_592, // mm³ per ft³
        basis: 'measured_from_model',
        derivation:
          `length ${fromMm(len, 'ft').toFixed(2)} ft x height ${fromMm(w.height, 'ft').toFixed(2)} ft ` +
          `less openings, x thickness ${fromMm(w.thickness, 'in').toFixed(1)} in`,
        floorId: floor.id,
      });
    }
  }

  // ---- Quantities that geometry cannot supply ----------------------------
  gaps.push({
    key: 'rebar',
    description: 'Steel reinforcement',
    materialId: 'mat_steel_rebar' as MaterialId,
    unit: 'kg',
    quantity: 0,
    basis: 'requires_engineering',
    derivation: 'not derivable from a floor plan',
    gap:
      'Reinforcement quantity depends on the structural design (member sizes, spans, loads, bar ' +
      'schedules), which a floor plan does not contain. Enter a quantity from the structural ' +
      'drawings or a bar bending schedule.',
  });
  gaps.push({
    key: 'foundation_concrete',
    description: 'Foundation and substructure concrete',
    unit: 'cft',
    quantity: 0,
    basis: 'requires_engineering',
    derivation: 'not derivable from a floor plan',
    gap:
      'Foundation volume depends on soil bearing capacity and the structural design. Enter from ' +
      'the structural drawings.',
  });

  return {
    lines,
    gaps,
    summary: {
      grossFloorAreaSqft: fromMm2(grossFloorAreaMm2, 'ft2'),
      roomCount,
      doorCount,
      windowCount,
      floorCount: floors.length,
    },
  };
}

/** Merge lines that share a material and unit, for the summary BOQ view. */
export function consolidate(lines: readonly QuantityLine[]): QuantityLine[] {
  const buckets = new Map<string, QuantityLine>();
  for (const line of lines) {
    if (!line.materialId) continue;
    const key = `${line.materialId}:${line.unit}`;
    const existing = buckets.get(key);
    if (existing) {
      buckets.set(key, {
        ...existing,
        quantity: existing.quantity + line.quantity,
        description: findMaterial(line.materialId)?.name ?? existing.description,
        derivation: `consolidated from multiple locations`,
        roomId: undefined,
        floorId: undefined,
      });
    } else {
      buckets.set(key, { ...line, key });
    }
  }
  return [...buckets.values()];
}
