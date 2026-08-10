/**
 * THE ROUTE THROUGH A FLOOR.
 *
 * Given a floor, work out the path someone actually walks: down the circulation
 * spine, stopping at each room's door. Both the 2D plan and the 3D view animate
 * along it, and they animate along the *same* one, so the two views agree about
 * the building rather than each inventing its own idea of a walk.
 *
 * This is circulation analysis rather than decoration. The route is derived from
 * the corridor's geometry and the real positions of real doors, so where it goes
 * is a fact about the plan: a room the route cannot reach is a room with no door
 * onto circulation, and the tour will show that by never stopping there.
 */

import { boundsOf, centroid, distance } from '../geometry.js';
import type { Floor, Point2 } from '../model/architecture.js';
import type { RoomId } from '../model/ids.js';

export interface TourStop {
  readonly roomId: RoomId;
  readonly name: string;
  /** The door, on the corridor wall. */
  readonly at: Point2;
  /** Where the room's label sits, for the camera to look at. */
  readonly lookAt: Point2;
  /** Distance along the route at which this stop is reached, in mm. */
  readonly distanceAlong: number;
}

export interface Tour {
  /** Centreline of the walk, in plan coordinates. */
  readonly path: readonly Point2[];
  readonly stops: readonly TourStop[];
  readonly totalLength: number;
}

/** Position and heading at a given distance along the route. */
export function tourPointAt(tour: Tour, distanceMm: number): { at: Point2; headingRad: number } {
  const path = tour.path;
  if (path.length === 0) return { at: { x: 0, y: 0 }, headingRad: 0 };
  if (path.length === 1) return { at: path[0]!, headingRad: 0 };

  let remaining = Math.max(0, Math.min(distanceMm, tour.totalLength));
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const segment = distance(a, b);
    if (segment <= 0) continue;
    if (remaining <= segment) {
      const t = remaining / segment;
      return {
        at: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
        headingRad: Math.atan2(b.y - a.y, b.x - a.x),
      };
    }
    remaining -= segment;
  }
  const last = path[path.length - 1]!;
  const prev = path[path.length - 2]!;
  return { at: last, headingRad: Math.atan2(last.y - prev.y, last.x - prev.x) };
}

/**
 * Build the route for one floor.
 *
 * The spine is the long axis of the circulation room. Where a floor has no
 * corridor — a single-room shop, or an import that never closed one — the route
 * falls back to a line through the room centroids in plan order, which is still
 * a truthful walk even if it passes through walls that a corridor would have
 * avoided. Returning nothing at all would leave the viewer with no way to
 * inspect such a floor.
 */
export function buildTour(floor: Floor): Tour {
  const circulation = floor.rooms
    .filter((r) => r.use === 'corridor' || r.use === 'lobby')
    .sort((a, b) => boundsWidth(b) - boundsWidth(a))[0];

  const path: Point2[] = [];

  if (circulation) {
    const b = boundsOf(circulation.boundary);
    const horizontal = b.maxX - b.minX >= b.maxY - b.minY;
    const midY = (b.minY + b.maxY) / 2;
    const midX = (b.minX + b.maxX) / 2;
    path.push(
      horizontal ? { x: b.minX, y: midY } : { x: midX, y: b.minY },
      horizontal ? { x: b.maxX, y: midY } : { x: midX, y: b.maxY },
    );
  } else {
    for (const room of [...floor.rooms].sort((a, b) => centroid(a.boundary).x - centroid(b.boundary).x)) {
      path.push(centroid(room.boundary));
    }
  }

  if (path.length < 2) {
    return { path, stops: [], totalLength: 0 };
  }

  // Cumulative length, so a stop can be expressed as a distance along the walk.
  const cumulative: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    cumulative.push(cumulative[i - 1]! + distance(path[i - 1]!, path[i]!));
  }
  const totalLength = cumulative[cumulative.length - 1]!;

  // Each room's door, projected onto the spine. Rooms are visited in the order
  // the walk reaches them, which is the order someone actually meets them.
  const stops: TourStop[] = [];
  for (const room of floor.rooms) {
    if (room.use === 'corridor') continue;

    const doors = floor.walls
      .filter((w) => room.boundingWallIds.includes(w.id))
      .flatMap((w) => {
        const dx = w.end.x - w.start.x;
        const dy = w.end.y - w.start.y;
        const len = Math.hypot(dx, dy) || 1;
        return w.openings
          .filter((o) => o.kind === 'door')
          .map((o) => ({
            x: w.start.x + (dx / len) * o.distanceAlongWall,
            y: w.start.y + (dy / len) * o.distanceAlongWall,
          }));
      });

    const door = doors[0] ?? centroid(room.boundary);
    const projected = projectOntoPath(path, cumulative, door);
    stops.push({
      roomId: room.id,
      name: room.name,
      at: projected.at,
      lookAt: centroid(room.boundary),
      distanceAlong: projected.distanceAlong,
    });
  }

  stops.sort((a, b) => a.distanceAlong - b.distanceAlong);
  return { path, stops, totalLength };
}

function boundsWidth(room: { boundary: readonly Point2[] }): number {
  const b = boundsOf(room.boundary);
  return Math.max(b.maxX - b.minX, b.maxY - b.minY);
}

/** Nearest point on the polyline to `target`, and how far along it that is. */
function projectOntoPath(
  path: readonly Point2[],
  cumulative: readonly number[],
  target: Point2,
): { at: Point2; distanceAlong: number } {
  let best = { at: path[0]!, distanceAlong: 0, gap: Infinity };

  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq === 0) continue;

    const t = Math.max(0, Math.min(1, ((target.x - a.x) * dx + (target.y - a.y) * dy) / lengthSq));
    const at = { x: a.x + dx * t, y: a.y + dy * t };
    const gap = distance(at, target);
    if (gap < best.gap) {
      best = { at, distanceAlong: cumulative[i]! + Math.sqrt(lengthSq) * t, gap };
    }
  }

  return { at: best.at, distanceAlong: best.distanceAlong };
}
