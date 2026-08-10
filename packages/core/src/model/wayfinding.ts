/**
 * FINDING YOUR WAY AROUND THE BUILDING.
 *
 * Two questions a person standing in a 3D model asks immediately, and which the
 * model has to be able to answer:
 *
 *   "Where do I go in?"       -> `findEntrances`
 *   "Where are the stairs?"   -> `transportPoints`, in circulation.ts
 *
 * Both were unanswerable for an imported drawing. A PDF import produces walls,
 * openings and rooms and nothing that says *this* door is the way in, so the
 * building rendered as a closed block. And a PDF import produces no stair and no
 * lift at all — the recogniser only labels a room `stair` when the word "STAIR"
 * happens to fall inside a polygon it managed to close, which on a dense
 * commercial plan it usually does not. So the walkthrough had nothing to offer
 * and no way to change floor.
 *
 * This module answers the first question and `core-placement.ts` answers the
 * second. Neither invents a measurement: an entrance is a door that is already
 * in the model, and a fitted core is reported as inferred, never as read.
 */

import type { Floor, Opening, Point2, Wall } from './architecture.js';

export interface Entrance {
  readonly floorId: string;
  readonly level: number;
  readonly wallId: string;
  readonly openingId: string;
  /** Centre of the doorway, in plan millimetres. */
  readonly at: Point2;
  /** Unit vector pointing from the doorway into the building. */
  readonly inward: Point2;
  readonly widthMm: number;
  readonly isEmergencyExit: boolean;
  /** Why this door was taken for the entrance. Shown to the user, not guessed at. */
  readonly basis: string;
}

/** The centre of a door, and the direction the wall runs. */
function openingGeometry(wall: Wall, opening: Opening): { at: Point2; along: Point2 } | null {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return null;
  const along = { x: dx / length, y: dy / length };
  return {
    at: {
      x: wall.start.x + along.x * opening.distanceAlongWall,
      y: wall.start.y + along.y * opening.distanceAlongWall,
    },
    along,
  };
}

/**
 * The doors you can walk in through.
 *
 * The entrance level is the lowest storey at or above ground — a basement door
 * is a car-park ramp, not the way a person arrives. Within that storey a door
 * counts as an entrance when it sits in an exterior wall; the widest is listed
 * first, because on every real plan the main entrance is the widest opening in
 * the front elevation.
 *
 * If no wall on that floor is marked exterior — common in an imported drawing,
 * where every wall arrives as a line and nothing declares which side is outside
 * — the doors nearest the footprint edge are used instead, and `basis` says so.
 * An entrance the app worked out is worth showing; an entrance the app pretends
 * it read off the drawing is not.
 */
export function findEntrances(floors: readonly Floor[]): Entrance[] {
  const aboveGround = floors.filter((f) => f.level >= 0);
  const floor = (aboveGround.length > 0 ? aboveGround : [...floors].sort((a, b) => a.level - b.level))[0];
  if (!floor) return [];

  const points = floor.walls.flatMap((w) => [w.start, w.end]);
  if (points.length === 0) return [];
  const minX = Math.min(...points.map((p) => p.x));
  const maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));
  const centre = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };

  const anyExterior = floor.walls.some((w) => w.function === 'exterior');
  // A door within this much of the footprint edge is on the perimeter. One
  // metre: thick enough to catch a wall drawn at its centreline rather than its
  // face, thin enough not to sweep in the first internal partition.
  const EDGE_TOLERANCE_MM = 1000;

  const candidates: Entrance[] = [];
  for (const wall of floor.walls) {
    for (const opening of wall.openings) {
      if (opening.kind === 'window') continue;
      const geometry = openingGeometry(wall, opening);
      if (!geometry) continue;

      const onEdge =
        Math.min(
          Math.abs(geometry.at.x - minX),
          Math.abs(geometry.at.x - maxX),
          Math.abs(geometry.at.y - minY),
          Math.abs(geometry.at.y - maxY),
        ) <= EDGE_TOLERANCE_MM;

      const isEntrance = anyExterior ? wall.function === 'exterior' : onEdge;
      if (!isEntrance) continue;

      // Inward is the wall normal that points towards the middle of the
      // building. Both normals are perpendicular to the wall; the one whose dot
      // product with (centre - door) is positive is the one facing in.
      const normal = { x: -geometry.along.y, y: geometry.along.x };
      const towardsCentre = { x: centre.x - geometry.at.x, y: centre.y - geometry.at.y };
      const sign = normal.x * towardsCentre.x + normal.y * towardsCentre.y >= 0 ? 1 : -1;

      candidates.push({
        floorId: floor.id,
        level: floor.level,
        wallId: wall.id,
        openingId: opening.id,
        at: geometry.at,
        inward: { x: normal.x * sign, y: normal.y * sign },
        widthMm: opening.width,
        isEmergencyExit: opening.isEmergencyExit,
        basis: anyExterior
          ? 'A door in a wall the model marks as exterior.'
          : 'A door on the edge of the footprint. No wall on this floor declares itself exterior, so the perimeter was used.',
      });
    }
  }

  // Widest first: on every real plan the main entrance is the widest opening in
  // the front elevation, and an emergency exit is never the front door.
  return candidates.sort(
    (a, b) => Number(a.isEmergencyExit) - Number(b.isEmergencyExit) || b.widthMm - a.widthMm,
  );
}

/**
 * A spot just inside the entrance to stand a walker on.
 *
 * Two metres in, which clears the door leaf and its frame and puts you far
 * enough inside that the collision push-out cannot shove you back through the
 * opening on the first frame.
 */
export function justInside(entrance: Entrance, distanceMm = 2000): Point2 {
  return {
    x: entrance.at.x + entrance.inward.x * distanceMm,
    y: entrance.at.y + entrance.inward.y * distanceMm,
  };
}
