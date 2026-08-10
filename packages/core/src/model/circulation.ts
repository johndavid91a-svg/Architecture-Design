/**
 * VERTICAL CIRCULATION — stairs and lifts.
 *
 * A multi-floor building needs a way to get between floors, and the model needs
 * to know where it is for three separate reasons: the walkthrough lets you use
 * it, the takeoff counts its treads and its shaft walls, and the regulation
 * checker cares that it exists at all.
 *
 * Stairs are generated from the floor-to-floor height rather than drawn, because
 * the riser count follows from it: you cannot choose the number of risers
 * independently of the height they have to climb. Riser and tread are then
 * checked against comfortable limits and reported when they fall outside, rather
 * than silently producing a staircase nobody could walk up.
 */

import { polygonArea, rectangleBoundary } from '../geometry.js';
import type { Floor, Point2, Room, Stair, Wall } from './architecture.js';
import { newId, type FloorId, type RoomId, type StairId, type WallId } from './ids.js';
import type { Millimetres } from '../units.js';
import { fromMm } from '../units.js';

/**
 * Comfortable stair proportions.
 *
 * The riser range is the conventional band for a commercial building; below
 * 150 mm a stair eats floor area for no benefit, above 190 mm it becomes tiring
 * and, in most codes, non-compliant. The tread range follows from the same
 * conventions. These are checked and reported, never silently enforced, because
 * an existing building being surveyed may well have a stair outside them and
 * the model must record what is actually there.
 */
export const STAIR_LIMITS = {
  minRiserMm: 150,
  maxRiserMm: 190,
  minTreadMm: 250,
  maxTreadMm: 320,
  minWidthMm: 1000,
  /** 2R + G, the classic going rule; a comfortable stair lands near 600–640 mm. */
  minTwoRPlusG: 550,
  maxTwoRPlusG: 700,
} as const;

export interface StairCheck {
  readonly ok: boolean;
  readonly riser: Millimetres;
  readonly tread: Millimetres;
  readonly riserCount: number;
  readonly twoRPlusG: number;
  readonly notes: readonly string[];
}

/**
 * Derive a stair from the height it has to climb.
 *
 * The riser count is the smallest whole number that keeps the riser inside the
 * comfortable band; the riser is then the exact quotient, so the flight lands
 * precisely on the next floor level. Deriving the riser from a chosen count —
 * rather than choosing a "nice" riser and hoping — is what stops the top step
 * being a different height from the rest, which is both the commonest stair
 * defect and a genuine trip hazard.
 */
export function deriveStair(floorToFloorMm: Millimetres, treadMm = 280): StairCheck {
  const notes: string[] = [];

  const minCount = Math.ceil(floorToFloorMm / STAIR_LIMITS.maxRiserMm);
  const maxCount = Math.floor(floorToFloorMm / STAIR_LIMITS.minRiserMm);

  let riserCount: number;
  if (minCount > maxCount) {
    // The height cannot be divided into risers inside the comfortable band.
    riserCount = Math.max(1, Math.round(floorToFloorMm / 175));
    notes.push(
      `A floor-to-floor of ${fromMm(floorToFloorMm, 'ft').toFixed(2)} ft cannot be divided into ` +
        `risers between ${STAIR_LIMITS.minRiserMm} and ${STAIR_LIMITS.maxRiserMm} mm. ` +
        `${riserCount} risers gives ${(floorToFloorMm / riserCount).toFixed(0)} mm, which is outside ` +
        `the comfortable band and needs an architect's attention.`,
    );
  } else {
    // Prefer the count closest to a 175 mm riser, the middle of the band.
    riserCount = Math.round(floorToFloorMm / 175);
    riserCount = Math.min(maxCount, Math.max(minCount, riserCount));
  }

  const riser = floorToFloorMm / riserCount;
  const twoRPlusG = 2 * riser + treadMm;

  if (riser < STAIR_LIMITS.minRiserMm || riser > STAIR_LIMITS.maxRiserMm) {
    notes.push(`Riser is ${riser.toFixed(0)} mm, outside the ${STAIR_LIMITS.minRiserMm}–${STAIR_LIMITS.maxRiserMm} mm band.`);
  }
  if (treadMm < STAIR_LIMITS.minTreadMm || treadMm > STAIR_LIMITS.maxTreadMm) {
    notes.push(`Tread is ${treadMm} mm, outside the ${STAIR_LIMITS.minTreadMm}–${STAIR_LIMITS.maxTreadMm} mm band.`);
  }
  if (twoRPlusG < STAIR_LIMITS.minTwoRPlusG || twoRPlusG > STAIR_LIMITS.maxTwoRPlusG) {
    notes.push(
      `2R + G is ${twoRPlusG.toFixed(0)} mm, outside the comfortable ${STAIR_LIMITS.minTwoRPlusG}–${STAIR_LIMITS.maxTwoRPlusG} mm range.`,
    );
  }

  return { ok: notes.length === 0, riser, tread: treadMm, riserCount, twoRPlusG, notes };
}

export type CoreKind = 'stair' | 'lift';

export interface CoreSpec {
  readonly kind: CoreKind;
  readonly name: string;
  readonly origin: Point2;
  readonly widthMm: Millimetres;
  readonly depthMm: Millimetres;
}

/** A stair core sized for a single straight flight with a landing. */
export function stairCoreSize(floorToFloorMm: Millimetres, treadMm = 280, widthMm = 1200): { widthMm: number; depthMm: number } {
  const stair = deriveStair(floorToFloorMm, treadMm);
  // A straight flight of N risers has N-1 treads, plus a landing at each end.
  const flightLength = (stair.riserCount - 1) * treadMm;
  return { widthMm, depthMm: flightLength + 2400 };
}

export const LIFT_CORE = { widthMm: 2000, depthMm: 2200 } as const;

/** The footprint a core of this kind needs on one floor. */
export function coreSize(kind: CoreKind, floorToFloorMm: Millimetres): { widthMm: number; depthMm: number } {
  return kind === 'stair'
    ? stairCoreSize(floorToFloorMm)
    : { widthMm: LIFT_CORE.widthMm, depthMm: LIFT_CORE.depthMm };
}

export interface BuiltCore {
  readonly room: Room;
  readonly walls: readonly Wall[];
  readonly stair: Stair | null;
  readonly check: StairCheck | null;
}

/**
 * Build one core — its room, its four enclosing walls and, for a stair, the
 * flight itself — at a given origin.
 *
 * Split out from `addCores` because a core has to be buildable in two different
 * situations. A building this app lays out knows where its cores go before it
 * has any rooms; an imported drawing already has all its rooms and the core has
 * to be fitted into whatever space is left. The geometry is identical in both
 * cases and only the origin differs, so only the origin is a parameter.
 */
export function buildCore(
  floor: Floor,
  kind: CoreKind,
  origin: Point2,
  note: string,
  /**
   * Footprint to use instead of this floor's own.
   *
   * A shaft has to be plumb and the same size all the way up. A stair core's
   * depth follows its floor-to-floor height, so letting each storey size its own
   * gives a core that changes shape as it rises. The caller passes the size that
   * suits the deepest storey and every storey gets it.
   */
  sizeOverride?: { widthMm: number; depthMm: number },
): BuiltCore {
  const size = sizeOverride ?? coreSize(kind, floor.floorToFloor);
  const boundary = rectangleBoundary(origin, size.widthMm, size.depthMm);
  const roomId = newId<RoomId>('rm');

  // Four walls round the core. A lift shaft in particular is a real enclosure
  // and its masonry belongs in the quantities.
  const thickness = kind === 'lift' ? 229 : 114;
  const wallIds: WallId[] = [];
  const walls: Wall[] = [];
  const edges: Array<[Point2, Point2]> = [
    [
      { x: origin.x, y: origin.y - thickness / 2 },
      { x: origin.x + size.widthMm, y: origin.y - thickness / 2 },
    ],
    [
      { x: origin.x, y: origin.y + size.depthMm + thickness / 2 },
      { x: origin.x + size.widthMm, y: origin.y + size.depthMm + thickness / 2 },
    ],
    [
      { x: origin.x - thickness / 2, y: origin.y },
      { x: origin.x - thickness / 2, y: origin.y + size.depthMm },
    ],
    [
      { x: origin.x + size.widthMm + thickness / 2, y: origin.y },
      { x: origin.x + size.widthMm + thickness / 2, y: origin.y + size.depthMm },
    ],
  ];

  for (let i = 0; i < edges.length; i++) {
    const [start, end] = edges[i]!;
    const id = newId<WallId>('wal');
    wallIds.push(id);
    walls.push({
      id,
      floorId: floor.id,
      start,
      end,
      thickness,
      height: floor.clearHeight,
      function: kind === 'lift' ? 'interior' : 'partition',
      loadBearing: kind === 'lift',
      // The first wall of the core carries the doorway onto the floor.
      openings:
        i === 0
          ? [
              {
                id: newId('opn'),
                wallId: id,
                kind: kind === 'lift' ? ('door' as const) : ('archway' as const),
                distanceAlongWall: size.widthMm / 2,
                width: Math.min(1100, size.widthMm - 200),
                height: 2100,
                sillHeight: 0,
                isEmergencyExit: kind === 'stair',
                provenance: {
                  confidence: 'inferred' as const,
                  note: `Access into the ${kind} core.`,
                },
              },
            ]
          : [],
      provenance: { confidence: 'inferred', note: `${kind} core enclosure. ${note}`.trim() },
    });
  }

  const room: Room = {
    id: roomId,
    floorId: floor.id,
    name: kind === 'stair' ? 'Staircase' : 'Lift',
    use: kind === 'stair' ? 'stair' : 'lift',
    boundary,
    clearHeight: floor.clearHeight,
    boundingWallIds: wallIds,
    provenance: { confidence: 'inferred', note: `${kind} core. ${note}`.trim() },
  };

  if (kind !== 'stair') return { room, walls, stair: null, check: null };

  const check = deriveStair(floor.floorToFloor);
  const stair: Stair = {
    id: newId<StairId>('str'),
    floorId: floor.id,
    name: 'Staircase',
    footprint: boundary,
    floorToFloorRise: floor.floorToFloor,
    treadDepth: check.tread,
    riserHeight: check.riser,
    width: size.widthMm,
    provenance: {
      confidence: 'inferred',
      note: `${check.riserCount} risers at ${check.riser.toFixed(0)} mm derived from the floor-to-floor height.`,
    },
  };
  return { room, walls, stair, check };
}

/**
 * Add stair and lift cores to every floor of a building.
 *
 * Placed at the end of the room strip so they do not overlap the rooms the user
 * entered. They are real rooms with real walls, so they carry into the takeoff:
 * a lift shaft is four walls of masonry on every floor, which is a cost people
 * routinely forget.
 */
export function addCores(
  floors: readonly Floor[],
  kinds: readonly CoreKind[],
): { floors: Floor[]; checks: StairCheck[] } {
  if (kinds.length === 0 || floors.length <= 1) {
    return { floors: [...floors], checks: [] };
  }

  // Place cores past the far edge of the widest floor, with a corridor gap.
  const extent = floors.reduce((max, f) => {
    const xs = f.rooms.flatMap((r) => r.boundary.map((p) => p.x));
    return xs.length > 0 ? Math.max(max, Math.max(...xs)) : max;
  }, 0);

  // Where the core lands — decided ONCE, for the whole building.
  //
  // On a floor with a circulation spine, the core belongs at the end of it,
  // centred on the corridor: that is where a real core goes, it is what the
  // corridor's escape door already opens towards, and it keeps the core within
  // the building's envelope instead of hanging off a corner. Without a spine —
  // a room strip, or an import that never closed a corridor — it falls back to
  // sitting past the last room, which is the only sensible place left.
  //
  // It is decided once because a shaft has to be PLUMB. Reading each storey's
  // own spine put the lift 3 m further back on the top floor than on the ground
  // floor of a building whose upper storeys step back — a shaft that moves
  // sideways as it rises, which cannot be built and which the walkthrough could
  // only travel by pretending the two were the same shaft. The lowest storey
  // that has a spine sets the line, and every storey above it keeps to it.
  const spineFloor = floors.find((f) => f.rooms.some((r) => r.use === 'corridor'));
  const spine = spineFloor?.rooms.find((r) => r.use === 'corridor');
  const spineCentreY = spine
    ? (Math.min(...spine.boundary.map((p) => p.y)) + Math.max(...spine.boundary.map((p) => p.y))) / 2
    : null;
  const startX = extent + (spine ? 229 : 1200); // abut the end wall, or leave a corridor gap

  // One footprint per kind, big enough for the deepest storey, used on all of
  // them — see the note on `buildCore`'s size override.
  const sizeFor = new Map<CoreKind, { widthMm: number; depthMm: number }>();
  for (const kind of kinds) {
    let widthMm = 0;
    let depthMm = 0;
    for (const floor of floors) {
      const size = coreSize(kind, floor.floorToFloor);
      widthMm = Math.max(widthMm, size.widthMm);
      depthMm = Math.max(depthMm, size.depthMm);
    }
    sizeFor.set(kind, { widthMm, depthMm });
  }

  const checks: StairCheck[] = [];
  const result: Floor[] = [];

  for (const floor of floors) {
    const rooms: Room[] = [...floor.rooms];
    const walls: Wall[] = [...floor.walls];
    const stairs: Stair[] = [...floor.stairs];

    let cursorX = startX;

    for (const kind of kinds) {
      const size = sizeFor.get(kind)!;
      const origin: Point2 =
        spineCentreY === null
          ? { x: cursorX, y: 0 }
          : { x: cursorX, y: spineCentreY - size.depthMm / 2 };

      const built = buildCore(
        floor,
        kind,
        origin,
        'Generated from the floor-to-floor height.',
        size,
      );
      rooms.push(built.room);
      walls.push(...built.walls);
      if (built.stair) stairs.push(built.stair);
      if (built.check) checks.push(built.check);

      cursorX += size.widthMm + 600;
    }

    result.push({ ...floor, rooms, walls, stairs });
  }

  return { floors: result, checks };
}

// ---------------------------------------------------------------------------
// Walkthrough transport
// ---------------------------------------------------------------------------

/** A place in the model you can use to change floor. */
export interface TransportPoint {
  readonly kind: CoreKind;
  readonly name: string;
  readonly floorId: FloorId;
  readonly level: number;
  /** Centre of the core, in plan millimetres. */
  readonly at: Point2;
  /** Half-extent used for the proximity test. */
  readonly radiusMm: Millimetres;
}

/** Every stair and lift across the building, for the walkthrough to offer. */
export function transportPoints(floors: readonly Floor[]): TransportPoint[] {
  const points: TransportPoint[] = [];
  for (const floor of floors) {
    for (const room of floor.rooms) {
      if (room.use !== 'stair' && room.use !== 'lift') continue;
      const xs = room.boundary.map((p) => p.x);
      const ys = room.boundary.map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      points.push({
        kind: room.use === 'stair' ? 'stair' : 'lift',
        name: room.name,
        floorId: floor.id,
        level: floor.level,
        at: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
        // Generous, so you do not have to stand on an exact spot to use it.
        radiusMm: Math.max(maxX - minX, maxY - minY) / 2 + 900,
      });
    }
  }
  return points;
}

/** The nearest usable stair or lift on this floor, if the walker is close enough. */
export function transportNear(
  position: Point2,
  level: number,
  points: readonly TransportPoint[],
): TransportPoint | null {
  let best: { point: TransportPoint; distance: number } | null = null;
  for (const point of points) {
    if (point.level !== level) continue;
    const distance = Math.hypot(point.at.x - position.x, point.at.y - position.y);
    if (distance <= point.radiusMm && (best === null || distance < best.distance)) {
      best = { point, distance };
    }
  }
  return best?.point ?? null;
}

/** Where a walker lands after using a core: the same core on the target floor. */
export function landingFor(
  point: TransportPoint,
  targetLevel: number,
  points: readonly TransportPoint[],
): TransportPoint | null {
  return (
    points.find(
      (p) => p.level === targetLevel && p.kind === point.kind && near(p.at, point.at, 2000),
    ) ??
    points.find((p) => p.level === targetLevel && p.kind === point.kind) ??
    null
  );
}

function near(a: Point2, b: Point2, toleranceMm: number): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= toleranceMm;
}

/** Area a core occupies, so the takeoff and coverage checks account for it. */
export function coreAreaSqft(floors: readonly Floor[]): number {
  let mm2 = 0;
  for (const floor of floors) {
    for (const room of floor.rooms) {
      if (room.use === 'stair' || room.use === 'lift') mm2 += polygonArea(room.boundary);
    }
  }
  return mm2 / 92_903.04;
}
