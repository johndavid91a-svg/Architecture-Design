/**
 * FITTING A STAIR AND A LIFT INTO A BUILDING THAT ARRIVED WITHOUT THEM.
 *
 * A drawing import produces rooms, walls and openings. It does not produce a
 * staircase, and it does not produce a lift. The recogniser labels a room
 * `stair` only when the word "STAIR" happens to land inside a polygon it managed
 * to close, and on a dense commercial plan — where the stair is drawn as a run
 * of parallel tread lines that break every face around it — it usually does not.
 * A nine-storey building then imports with no way to get from one floor to the
 * next: the walkthrough has nothing to offer, the takeoff misses a lift shaft's
 * masonry on every storey, and the model is wrong in a way that is easy to miss
 * because nothing errors.
 *
 * So a core is fitted. Two rules govern it:
 *
 *  1. It goes in a space that is genuinely free on EVERY storey, because a lift
 *     shaft that lands on top of a room two floors up is not a lift shaft. A
 *     stair that only exists on some floors is worse than none.
 *  2. It is reported. `addedCores` comes back as a list, the provenance on every
 *     element it creates says `inferred`, and the caller is expected to tell the
 *     user. This app does not quietly add geometry and let it be mistaken for
 *     something read off the drawing.
 */

import type { Floor, Point2, Room } from './architecture.js';
import { buildCore, coreSize, type CoreKind, type StairCheck } from './circulation.js';

/** Does the building already have a way to change floor? */
export function hasVerticalCirculation(floors: readonly Floor[]): boolean {
  return floors.some((f) => f.rooms.some((r) => r.use === 'stair' || r.use === 'lift'));
}

interface Rect {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

function boundsOfPoints(points: readonly Point2[]): Rect | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

/**
 * Is this rectangle clear of every room on every floor?
 *
 * Rooms are compared by bounding box rather than by exact polygon. That is
 * deliberately the conservative direction: a bounding box is never smaller than
 * the room, so a rectangle this accepts is clear of the real polygon too. The
 * cost is refusing a few L-shaped nooks that would in fact have fitted, which is
 * a far better failure than dropping a lift shaft through somebody's office.
 */
function isClear(candidate: Rect, roomBoxes: readonly Rect[]): boolean {
  for (const box of roomBoxes) {
    if (overlaps(candidate, box)) return false;
  }
  return true;
}

export interface CorePlacement {
  readonly kinds: readonly CoreKind[];
  readonly origin: Point2;
  /** True when the core sits inside the building; false when it abuts an outside wall. */
  readonly inside: boolean;
  readonly widthMm: number;
  readonly depthMm: number;
}

export interface FittedCores {
  readonly floors: readonly Floor[];
  readonly checks: readonly StairCheck[];
  readonly placement: CorePlacement | null;
  /** Plain-English account of what was added and why. Show it to the user. */
  readonly note: string;
}

/** Clearance kept around a fitted core so its door has somewhere to open into. */
const CLEARANCE_MM = 600;

/**
 * Add a stair and a lift to a building that has neither.
 *
 * The strip holding both cores side by side is placed by searching the footprint
 * on a grid for a position free of rooms on every storey, preferring the one
 * nearest the centre of the plan — which is both where a core belongs and where
 * it keeps travel distances shortest. If the plan is solid rooms edge to edge,
 * the strip abuts the outside of the footprint instead and `inside` is false, so
 * the caller can say so rather than leaving the user to notice a staircase
 * hanging off the side of their building.
 */
export function fitCores(floors: readonly Floor[], kinds: readonly CoreKind[]): FittedCores {
  if (floors.length <= 1 || kinds.length === 0) {
    return { floors: [...floors], checks: [], placement: null, note: '' };
  }

  // The strip has to hold every core side by side on the deepest floor, since
  // the stair's depth follows its floor-to-floor height and those differ.
  const GAP_MM = 600;
  const sizeFor = new Map<CoreKind, { widthMm: number; depthMm: number }>();
  let stripWidth = 0;
  let stripDepth = 0;
  for (const kind of kinds) {
    let widest = 0;
    let deepest = 0;
    for (const floor of floors) {
      const size = coreSize(kind, floor.floorToFloor);
      widest = Math.max(widest, size.widthMm);
      deepest = Math.max(deepest, size.depthMm);
    }
    sizeFor.set(kind, { widthMm: widest, depthMm: deepest });
    stripWidth += widest + (stripWidth > 0 ? GAP_MM : 0);
    stripDepth = Math.max(stripDepth, deepest);
  }

  const roomBoxes: Rect[] = [];
  const allPoints: Point2[] = [];
  for (const floor of floors) {
    for (const room of floor.rooms) {
      const box = boundsOfPoints(room.boundary);
      if (!box) continue;
      roomBoxes.push(box);
      allPoints.push(...room.boundary);
    }
    for (const wall of floor.walls) allPoints.push(wall.start, wall.end);
  }

  const footprint = boundsOfPoints(allPoints);
  if (!footprint) {
    return { floors: [...floors], checks: [], placement: null, note: '' };
  }

  const needW = stripWidth + CLEARANCE_MM * 2;
  const needD = stripDepth + CLEARANCE_MM * 2;
  const centre = {
    x: (footprint.minX + footprint.maxX) / 2,
    y: (footprint.minY + footprint.maxY) / 2,
  };

  // Grid search. The step is a quarter of the smaller dimension of the strip,
  // floored at 500 mm: fine enough not to miss a slot much bigger than the core,
  // coarse enough that a 60 m plan is a few thousand tests rather than a million.
  const step = Math.max(500, Math.min(needW, needD) / 4);
  let best: { origin: Point2; distance: number } | null = null;

  for (let x = footprint.minX; x + needW <= footprint.maxX; x += step) {
    for (let y = footprint.minY; y + needD <= footprint.maxY; y += step) {
      const candidate: Rect = { minX: x, minY: y, maxX: x + needW, maxY: y + needD };
      if (!isClear(candidate, roomBoxes)) continue;
      const cx = x + needW / 2;
      const cy = y + needD / 2;
      const distance = Math.hypot(cx - centre.x, cy - centre.y);
      if (best === null || distance < best.distance) {
        best = { origin: { x: x + CLEARANCE_MM, y: y + CLEARANCE_MM }, distance };
      }
    }
  }

  const inside = best !== null;
  const origin: Point2 = best?.origin ?? {
    // Abutting the right-hand edge, centred on the footprint's depth.
    x: footprint.maxX + 1200,
    y: centre.y - stripDepth / 2,
  };

  const checks: StairCheck[] = [];
  const result: Floor[] = [];
  const note = inside
    ? `A staircase and a lift were added by the app, in the largest space free of rooms on every ` +
      `storey. Your drawing did not carry either as a recognisable room, and a building with nine ` +
      `storeys and no way between them cannot be walked or costed correctly. Move them in the 2D ` +
      `plan to where the real core is.`
    : `A staircase and a lift were added by the app, abutting the outside of the footprint, because ` +
      `no space inside the plan was free of rooms on every storey. Move them in the 2D plan to ` +
      `where the real core is.`;

  for (const floor of floors) {
    const rooms: Room[] = [...floor.rooms];
    const walls = [...floor.walls];
    const stairs = [...floor.stairs];

    let cursorX = origin.x;
    for (const kind of kinds) {
      // The size the strip was measured for, not this storey's own — a shaft
      // that changes shape as it rises is not a shaft.
      const size = sizeFor.get(kind)!;
      const built = buildCore(
        floor,
        kind,
        { x: cursorX, y: origin.y },
        inside ? 'Fitted into free space on every storey; not read from the drawing.' : 'Added outside the footprint; not read from the drawing.',
        size,
      );
      rooms.push(built.room);
      walls.push(...built.walls);
      if (built.stair) stairs.push(built.stair);
      if (built.check) checks.push(built.check);
      cursorX += size.widthMm + GAP_MM;
    }

    result.push({ ...floor, rooms, walls, stairs });
  }

  return {
    floors: result,
    checks,
    placement: { kinds, origin, inside, widthMm: stripWidth, depthMm: stripDepth },
    note,
  };
}
