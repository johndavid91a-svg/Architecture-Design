/**
 * ARCHITECTURE EDITING.
 *
 * The twin has to be correctable. A manual-measurement layout, or an imported
 * drawing, is a starting point — the user needs to move a wall to where it
 * actually is, widen a room they mistyped, put the door on the right side.
 *
 * Every operation here changes geometry, so every one of them requires an
 * `ArchitecturalChangeAuthorisation`. That is not ceremony: the guard cannot
 * distinguish "the user dragged a wall" from "an AI moved a wall", and it must
 * not try. What distinguishes them is that the user's action arrives with an
 * authorisation attached, and the AI's does not.
 *
 * The UI mints an authorisation from a direct user gesture. It must never mint
 * one on behalf of an agent.
 *
 * Operations are pure: each returns a new architecture layer. That gives undo
 * and redo for free — see `history.ts` — and means a rejected edit leaves the
 * previous twin untouched rather than half-applied.
 */

import { boundsOf, polygonArea, rectangleBoundary } from '../geometry.js';
import type {
  ArchitectureLayer,
  Floor,
  Opening,
  OpeningKind,
  Point2,
  Room,
  RoomUse,
  Wall,
  WallFunction,
} from './architecture.js';
import { newId, type FloorId, type OpeningId, type RoomId, type WallId } from './ids.js';
import type { ArchitecturalChangeAuthorisation } from './guard.js';
import { fromMm } from '../units.js';

/** Result of an edit: either a new layer, or a refusal with a reason. */
export type EditResult =
  | { readonly ok: true; readonly architecture: ArchitectureLayer; readonly description: string }
  | { readonly ok: false; readonly reason: string };

function refuse(reason: string): EditResult {
  return { ok: false, reason };
}

/** Minimum sensible room dimension. Below this it is a duct, not a room. */
const MIN_ROOM_DIMENSION_MM = 600;
const MIN_WALL_LENGTH_MM = 100;
const MIN_WALL_THICKNESS_MM = 50;
const MAX_WALL_THICKNESS_MM = 1500;

/** Replace one floor inside the layer, leaving everything else identical. */
function withFloor(arch: ArchitectureLayer, floorId: FloorId, update: (floor: Floor) => Floor): ArchitectureLayer {
  return {
    ...arch,
    site: {
      ...arch.site,
      buildings: arch.site.buildings.map((building) => ({
        ...building,
        floors: building.floors.map((floor) => (floor.id === floorId ? update(floor) : floor)),
      })),
    },
  };
}

export function findFloor(arch: ArchitectureLayer, floorId: FloorId): Floor | undefined {
  for (const building of arch.site.buildings) {
    const floor = building.floors.find((f) => f.id === floorId);
    if (floor) return floor;
  }
  return undefined;
}

/**
 * Authorisation check shared by every operation.
 *
 * The professional-review acknowledgement is required even for a user's own
 * edit. Moving a load-bearing wall in the model is not the same as moving it on
 * site, and a user who has never been told the difference will assume the tool
 * checked.
 */
function checkAuthorisation(
  auth: ArchitecturalChangeAuthorisation | undefined,
  arch: ArchitectureLayer,
): string | null {
  if (arch.frozen) {
    return 'The architecture is frozen. Unfreeze it before editing.';
  }
  if (!auth) {
    return 'Architecture edits require an explicit authorisation from a direct user action.';
  }
  if (auth.projectId !== arch.projectId) {
    return 'The authorisation was issued for a different project.';
  }
  if (!auth.professionalReviewAcknowledged) {
    return 'The professional-review notice has not been acknowledged.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

/**
 * Resize a rectangular room, keeping its lower-left corner fixed.
 *
 * Only meaningful for rooms that are still rectangles. A room reshaped into an
 * L cannot be "resized" by two numbers, and the operation refuses rather than
 * silently replacing the polygon with a rectangle and losing the shape.
 */
export function resizeRoom(
  arch: ArchitectureLayer,
  floorId: FloorId,
  roomId: RoomId,
  widthMm: number,
  depthMm: number,
  auth?: ArchitecturalChangeAuthorisation,
): EditResult {
  const problem = checkAuthorisation(auth, arch);
  if (problem) return refuse(problem);

  if (widthMm < MIN_ROOM_DIMENSION_MM || depthMm < MIN_ROOM_DIMENSION_MM) {
    return refuse(
      `A room cannot be smaller than ${fromMm(MIN_ROOM_DIMENSION_MM, 'ft').toFixed(2)} ft in either direction.`,
    );
  }

  const floor = findFloor(arch, floorId);
  const room = floor?.rooms.find((r) => r.id === roomId);
  if (!floor || !room) return refuse('Room not found.');

  if (room.boundary.length !== 4) {
    return refuse(
      'This room is not a rectangle. Move its corner points individually instead of resizing it.',
    );
  }

  const bounds = boundsOf(room.boundary);
  const origin: Point2 = { x: bounds.minX, y: bounds.minY };
  const boundary = rectangleBoundary(origin, widthMm, depthMm);

  // Walls must follow the room. A resize that moved only the polygon would
  // leave the floor slab extending past its own walls — the model would render
  // wrong, and worse, the takeoff would compute wall area from the new
  // perimeter while the masonry came from the old wall lengths.
  const bounding = floor.walls.filter((w) => room.boundingWallIds.includes(w.id));

  // A partition shared with a neighbouring room cannot be moved by resizing one
  // side of it: the neighbour's polygon would silently stop matching its walls.
  // Refusing is the honest outcome — the user moves the partition explicitly,
  // which resizes both rooms visibly.
  const shared = bounding.filter((w) =>
    floor.rooms.some((other) => other.id !== roomId && other.boundingWallIds.includes(w.id)),
  );
  const movingShared = shared.filter((w) => wallNeedsMove(w, bounds, widthMm, depthMm));
  if (movingShared.length > 0) {
    return refuse(
      `That resize would move ${movingShared.length} wall shared with an adjoining room. ` +
        `Move the partition itself instead, so both rooms change together.`,
    );
  }

  const oldWidth = bounds.maxX - bounds.minX;
  const oldDepth = bounds.maxY - bounds.minY;

  return {
    ok: true,
    description: `Resize "${room.name}" to ${fromMm(widthMm, 'ft').toFixed(2)} × ${fromMm(depthMm, 'ft').toFixed(2)} ft`,
    architecture: withFloor(arch, floorId, (f) => ({
      ...f,
      rooms: f.rooms.map((r) =>
        r.id === roomId
          ? { ...r, boundary, provenance: { ...r.provenance, confidence: 'measured' as const } }
          : r,
      ),
      walls: f.walls.map((w) =>
        room.boundingWallIds.includes(w.id)
          ? moveWallWithRoom(w, bounds, oldWidth, oldDepth, widthMm, depthMm)
          : w,
      ),
    })),
  };
}

/** True when this wall lies on an edge the resize is actually moving. */
function wallNeedsMove(
  wall: Wall,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  newWidth: number,
  newDepth: number,
): boolean {
  const oldWidth = bounds.maxX - bounds.minX;
  const oldDepth = bounds.maxY - bounds.minY;
  const tolerance = wall.thickness / 2 + 60;
  const onMaxX = Math.abs(wall.start.x - bounds.maxX) <= tolerance && Math.abs(wall.end.x - bounds.maxX) <= tolerance;
  const onMaxY = Math.abs(wall.start.y - bounds.maxY) <= tolerance && Math.abs(wall.end.y - bounds.maxY) <= tolerance;
  return (onMaxX && newWidth !== oldWidth) || (onMaxY && newDepth !== oldDepth);
}

/**
 * Move one bounding wall to follow a resized room.
 *
 * The room's lower-left corner is fixed, so walls on the min edges stay put and
 * walls on the max edges translate by the size delta. Walls running along an
 * edge also have to stretch, or a widened room would end up with short side
 * walls and a gap at the corner.
 *
 * The wall's offset from the room boundary — half its thickness, outward — is
 * preserved rather than recomputed, so the finished face stays the finished
 * face.
 */
function moveWallWithRoom(
  wall: Wall,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  oldWidth: number,
  oldDepth: number,
  newWidth: number,
  newDepth: number,
): Wall {
  const dx = newWidth - oldWidth;
  const dy = newDepth - oldDepth;
  if (dx === 0 && dy === 0) return wall;

  const tolerance = wall.thickness / 2 + 60;
  const near = (a: number, b: number) => Math.abs(a - b) <= tolerance;

  const shift = (p: Point2): Point2 => ({
    // Anything at or beyond the far edge moves by the delta; anything at the
    // near edge stays. Interior points cannot occur on a bounding wall.
    x: near(p.x, bounds.maxX) || p.x > bounds.maxX ? p.x + dx : p.x,
    y: near(p.y, bounds.maxY) || p.y > bounds.maxY ? p.y + dy : p.y,
  });

  const start = shift(wall.start);
  const end = shift(wall.end);

  // Openings are positioned along the wall. If the wall shortened past one,
  // clamp it back inside rather than leaving a door hanging off the end.
  const newLength = Math.hypot(end.x - start.x, end.y - start.y);
  const openings = wall.openings.map((o) => {
    const half = o.width / 2;
    const clamped = Math.min(Math.max(o.distanceAlongWall, half), Math.max(half, newLength - half));
    return clamped === o.distanceAlongWall ? o : { ...o, distanceAlongWall: clamped };
  });

  return { ...wall, start, end, openings };
}

/** Move a room's whole boundary by a delta. */
export function moveRoom(
  arch: ArchitectureLayer,
  floorId: FloorId,
  roomId: RoomId,
  dx: number,
  dy: number,
  auth?: ArchitecturalChangeAuthorisation,
): EditResult {
  const problem = checkAuthorisation(auth, arch);
  if (problem) return refuse(problem);

  const floor = findFloor(arch, floorId);
  const room = floor?.rooms.find((r) => r.id === roomId);
  if (!floor || !room) return refuse('Room not found.');

  return {
    ok: true,
    description: `Move "${room.name}"`,
    architecture: withFloor(arch, floorId, (f) => ({
      ...f,
      rooms: f.rooms.map((r) =>
        r.id === roomId
          ? { ...r, boundary: r.boundary.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
          : r,
      ),
    })),
  };
}

/** Move a single boundary vertex, for non-rectangular reshaping. */
export function moveRoomVertex(
  arch: ArchitectureLayer,
  floorId: FloorId,
  roomId: RoomId,
  vertexIndex: number,
  position: Point2,
  auth?: ArchitecturalChangeAuthorisation,
): EditResult {
  const problem = checkAuthorisation(auth, arch);
  if (problem) return refuse(problem);

  const floor = findFloor(arch, floorId);
  const room = floor?.rooms.find((r) => r.id === roomId);
  if (!floor || !room) return refuse('Room not found.');
  if (vertexIndex < 0 || vertexIndex >= room.boundary.length) return refuse('No such vertex.');

  const boundary = room.boundary.map((p, i) => (i === vertexIndex ? position : p));

  // A polygon that has collapsed to near-zero area is not a room, and every
  // area-based quantity derived from it would be meaningless.
  if (polygonArea(boundary) < MIN_ROOM_DIMENSION_MM * MIN_ROOM_DIMENSION_MM) {
    return refuse('That would collapse the room to almost no area.');
  }

  return {
    ok: true,
    description: `Reshape "${room.name}"`,
    architecture: withFloor(arch, floorId, (f) => ({
      ...f,
      rooms: f.rooms.map((r) => (r.id === roomId ? { ...r, boundary } : r)),
    })),
  };
}

export function setRoomProperties(
  arch: ArchitectureLayer,
  floorId: FloorId,
  roomId: RoomId,
  patch: { name?: string; use?: RoomUse; clearHeightMm?: number },
  auth?: ArchitecturalChangeAuthorisation,
): EditResult {
  const floor = findFloor(arch, floorId);
  const room = floor?.rooms.find((r) => r.id === roomId);
  if (!floor || !room) return refuse('Room not found.');

  // Name and use are not geometry, so they need no authorisation. Clear height
  // is geometry — it drives wall area, and therefore paint, plaster and cost.
  if (patch.clearHeightMm !== undefined) {
    const problem = checkAuthorisation(auth, arch);
    if (problem) return refuse(problem);
    if (patch.clearHeightMm < 1800) {
      return refuse('A clear height below 6 ft is not habitable space.');
    }
  }

  return {
    ok: true,
    description: `Update "${room.name}"`,
    architecture: withFloor(arch, floorId, (f) => ({
      ...f,
      rooms: f.rooms.map((r) =>
        r.id === roomId
          ? {
              ...r,
              name: patch.name ?? r.name,
              use: patch.use ?? r.use,
              clearHeight: patch.clearHeightMm ?? r.clearHeight,
            }
          : r,
      ),
    })),
  };
}

export function addRoom(
  arch: ArchitectureLayer,
  floorId: FloorId,
  spec: { name: string; use: RoomUse; origin: Point2; widthMm: number; depthMm: number },
  auth?: ArchitecturalChangeAuthorisation,
): EditResult {
  const problem = checkAuthorisation(auth, arch);
  if (problem) return refuse(problem);

  const floor = findFloor(arch, floorId);
  if (!floor) return refuse('Floor not found.');
  if (spec.widthMm < MIN_ROOM_DIMENSION_MM || spec.depthMm < MIN_ROOM_DIMENSION_MM) {
    return refuse('Room dimensions are too small.');
  }

  const room: Room = {
    id: newId<RoomId>('rm'),
    floorId,
    name: spec.name,
    use: spec.use,
    boundary: rectangleBoundary(spec.origin, spec.widthMm, spec.depthMm),
    clearHeight: floor.clearHeight,
    boundingWallIds: [],
    provenance: { confidence: 'measured', note: 'Added in the plan editor.' },
  };

  return {
    ok: true,
    description: `Add room "${spec.name}"`,
    architecture: withFloor(arch, floorId, (f) => ({ ...f, rooms: [...f.rooms, room] })),
  };
}

export function deleteRoom(
  arch: ArchitectureLayer,
  floorId: FloorId,
  roomId: RoomId,
  auth?: ArchitecturalChangeAuthorisation,
): EditResult {
  const problem = checkAuthorisation(auth, arch);
  if (problem) return refuse(problem);

  const floor = findFloor(arch, floorId);
  const room = floor?.rooms.find((r) => r.id === roomId);
  if (!floor || !room) return refuse('Room not found.');
  if (floor.rooms.length === 1) return refuse('A floor must keep at least one room.');

  return {
    ok: true,
    description: `Delete room "${room.name}"`,
    architecture: withFloor(arch, floorId, (f) => ({
      ...f,
      rooms: f.rooms.filter((r) => r.id !== roomId),
    })),
  };
}

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

export function moveWallEndpoint(
  arch: ArchitectureLayer,
  floorId: FloorId,
  wallId: WallId,
  which: 'start' | 'end',
  position: Point2,
  auth?: ArchitecturalChangeAuthorisation,
): EditResult {
  const problem = checkAuthorisation(auth, arch);
  if (problem) return refuse(problem);

  const floor = findFloor(arch, floorId);
  const wall = floor?.walls.find((w) => w.id === wallId);
  if (!floor || !wall) return refuse('Wall not found.');

  const start = which === 'start' ? position : wall.start;
  const end = which === 'end' ? position : wall.end;
  const length = Math.hypot(end.x - start.x, end.y - start.y);

  if (length < MIN_WALL_LENGTH_MM) return refuse('That would collapse the wall to nothing.');

  // Openings are positioned along the wall. Shortening a wall past an opening
  // would leave a door hanging in space, so the edit is refused rather than
  // silently dropping or clamping the opening.
  const furthest = wall.openings.reduce(
    (max, o) => Math.max(max, o.distanceAlongWall + o.width / 2),
    0,
  );
  if (furthest > length) {
    return refuse(
      `The wall carries an opening extending to ${fromMm(furthest, 'ft').toFixed(2)} ft along it. ` +
        `Shortening it to ${fromMm(length, 'ft').toFixed(2)} ft would leave that opening off the wall. ` +
        `Move or delete the opening first.`,
    );
  }

  return {
    ok: true,
    description: `Move wall ${which}`,
    architecture: withFloor(arch, floorId, (f) => ({
      ...f,
      walls: f.walls.map((w) =>
        w.id === wallId
          ? { ...w, start, end, provenance: { ...w.provenance, confidence: 'measured' as const } }
          : w,
      ),
    })),
  };
}

/** Translate a whole wall, keeping its length and its openings. */
export function moveWall(
  arch: ArchitectureLayer,
  floorId: FloorId,
  wallId: WallId,
  dx: number,
  dy: number,
  auth?: ArchitecturalChangeAuthorisation,
): EditResult {
  const problem = checkAuthorisation(auth, arch);
  if (problem) return refuse(problem);

  const floor = findFloor(arch, floorId);
  const wall = floor?.walls.find((w) => w.id === wallId);
  if (!floor || !wall) return refuse('Wall not found.');

  return {
    ok: true,
    description: 'Move wall',
    architecture: withFloor(arch, floorId, (f) => ({
      ...f,
      walls: f.walls.map((w) =>
        w.id === wallId
          ? {
              ...w,
              start: { x: w.start.x + dx, y: w.start.y + dy },
              end: { x: w.end.x + dx, y: w.end.y + dy },
            }
          : w,
      ),
    })),
  };
}

export function setWallProperties(
  arch: ArchitectureLayer,
  floorId: FloorId,
  wallId: WallId,
  patch: { thicknessMm?: number; heightMm?: number; function?: WallFunction; loadBearing?: boolean },
  auth?: ArchitecturalChangeAuthorisation,
): EditResult {
  const problem = checkAuthorisation(auth, arch);
  if (problem) return refuse(problem);

  const floor = findFloor(arch, floorId);
  const wall = floor?.walls.find((w) => w.id === wallId);
  if (!floor || !wall) return refuse('Wall not found.');

  if (
    patch.thicknessMm !== undefined &&
    (patch.thicknessMm < MIN_WALL_THICKNESS_MM || patch.thicknessMm > MAX_WALL_THICKNESS_MM)
  ) {
    return refuse('Wall thickness is outside a sensible range.');
  }

  return {
    ok: true,
    description: 'Update wall',
    architecture: withFloor(arch, floorId, (f) => ({
      ...f,
      walls: f.walls.map((w) =>
        w.id === wallId
          ? {
              ...w,
              thickness: patch.thicknessMm ?? w.thickness,
              height: patch.heightMm ?? w.height,
              function: patch.function ?? w.function,
              loadBearing: patch.loadBearing ?? w.loadBearing,
            }
          : w,
      ),
    })),
  };
}

export function addWall(
  arch: ArchitectureLayer,
  floorId: FloorId,
  spec: { start: Point2; end: Point2; thicknessMm: number; function: WallFunction; loadBearing: boolean },
  auth?: ArchitecturalChangeAuthorisation,
): EditResult {
  const problem = checkAuthorisation(auth, arch);
  if (problem) return refuse(problem);

  const floor = findFloor(arch, floorId);
  if (!floor) return refuse('Floor not found.');
  if (Math.hypot(spec.end.x - spec.start.x, spec.end.y - spec.start.y) < MIN_WALL_LENGTH_MM) {
    return refuse('The wall is too short.');
  }

  const wall: Wall = {
    id: newId<WallId>('wal'),
    floorId,
    start: spec.start,
    end: spec.end,
    thickness: spec.thicknessMm,
    height: floor.clearHeight,
    function: spec.function,
    loadBearing: spec.loadBearing,
    openings: [],
    provenance: { confidence: 'measured', note: 'Drawn in the plan editor.' },
  };

  return {
    ok: true,
    description: 'Add wall',
    architecture: withFloor(arch, floorId, (f) => ({ ...f, walls: [...f.walls, wall] })),
  };
}

export function deleteWall(
  arch: ArchitectureLayer,
  floorId: FloorId,
  wallId: WallId,
  auth?: ArchitecturalChangeAuthorisation,
): EditResult {
  const problem = checkAuthorisation(auth, arch);
  if (problem) return refuse(problem);

  const floor = findFloor(arch, floorId);
  const wall = floor?.walls.find((w) => w.id === wallId);
  if (!floor || !wall) return refuse('Wall not found.');

  if (wall.loadBearing) {
    return refuse(
      'This wall is marked load-bearing. Removing it is a structural decision that needs an ' +
        'engineer, not a plan edit. Clear the load-bearing flag first if it was marked wrongly.',
    );
  }

  return {
    ok: true,
    description: 'Delete wall',
    architecture: withFloor(arch, floorId, (f) => ({
      ...f,
      walls: f.walls.filter((w) => w.id !== wallId),
      rooms: f.rooms.map((r) => ({
        ...r,
        boundingWallIds: r.boundingWallIds.filter((id) => id !== wallId),
      })),
    })),
  };
}

// ---------------------------------------------------------------------------
// Openings
// ---------------------------------------------------------------------------

export function addOpening(
  arch: ArchitectureLayer,
  floorId: FloorId,
  wallId: WallId,
  spec: {
    kind: OpeningKind;
    distanceAlongWallMm: number;
    widthMm: number;
    heightMm: number;
    sillHeightMm: number;
    isEmergencyExit?: boolean;
  },
  auth?: ArchitecturalChangeAuthorisation,
): EditResult {
  const problem = checkAuthorisation(auth, arch);
  if (problem) return refuse(problem);

  const floor = findFloor(arch, floorId);
  const wall = floor?.walls.find((w) => w.id === wallId);
  if (!floor || !wall) return refuse('Wall not found.');

  const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
  const half = spec.widthMm / 2;

  if (spec.distanceAlongWallMm - half < 0 || spec.distanceAlongWallMm + half > length) {
    return refuse('The opening would extend past the end of the wall.');
  }
  if (spec.sillHeightMm + spec.heightMm > wall.height) {
    return refuse('The opening is taller than the wall.');
  }

  // Overlapping openings produce a wall that cannot be built and a masonry
  // quantity that double-deducts.
  const overlapping = wall.openings.find(
    (o) =>
      Math.abs(o.distanceAlongWall - spec.distanceAlongWallMm) < (o.width + spec.widthMm) / 2,
  );
  if (overlapping) {
    return refuse(`That would overlap an existing ${overlapping.kind} on the same wall.`);
  }

  const opening: Opening = {
    id: newId<OpeningId>('opn'),
    wallId,
    kind: spec.kind,
    distanceAlongWall: spec.distanceAlongWallMm,
    width: spec.widthMm,
    height: spec.heightMm,
    sillHeight: spec.sillHeightMm,
    isEmergencyExit: spec.isEmergencyExit ?? false,
    provenance: { confidence: 'measured', note: 'Added in the plan editor.' },
  };

  return {
    ok: true,
    description: `Add ${spec.kind}`,
    architecture: withFloor(arch, floorId, (f) => ({
      ...f,
      walls: f.walls.map((w) => (w.id === wallId ? { ...w, openings: [...w.openings, opening] } : w)),
    })),
  };
}

export function updateOpening(
  arch: ArchitectureLayer,
  floorId: FloorId,
  wallId: WallId,
  openingId: OpeningId,
  patch: {
    distanceAlongWallMm?: number;
    widthMm?: number;
    heightMm?: number;
    sillHeightMm?: number;
    isEmergencyExit?: boolean;
  },
  auth?: ArchitecturalChangeAuthorisation,
): EditResult {
  const problem = checkAuthorisation(auth, arch);
  if (problem) return refuse(problem);

  const floor = findFloor(arch, floorId);
  const wall = floor?.walls.find((w) => w.id === wallId);
  const opening = wall?.openings.find((o) => o.id === openingId);
  if (!floor || !wall || !opening) return refuse('Opening not found.');

  const next: Opening = {
    ...opening,
    distanceAlongWall: patch.distanceAlongWallMm ?? opening.distanceAlongWall,
    width: patch.widthMm ?? opening.width,
    height: patch.heightMm ?? opening.height,
    sillHeight: patch.sillHeightMm ?? opening.sillHeight,
    isEmergencyExit: patch.isEmergencyExit ?? opening.isEmergencyExit,
  };

  const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
  if (next.distanceAlongWall - next.width / 2 < 0 || next.distanceAlongWall + next.width / 2 > length) {
    return refuse('The opening would extend past the end of the wall.');
  }
  if (next.sillHeight + next.height > wall.height) {
    return refuse('The opening is taller than the wall.');
  }

  return {
    ok: true,
    description: `Update ${opening.kind}`,
    architecture: withFloor(arch, floorId, (f) => ({
      ...f,
      walls: f.walls.map((w) =>
        w.id === wallId
          ? { ...w, openings: w.openings.map((o) => (o.id === openingId ? next : o)) }
          : w,
      ),
    })),
  };
}

export function deleteOpening(
  arch: ArchitectureLayer,
  floorId: FloorId,
  wallId: WallId,
  openingId: OpeningId,
  auth?: ArchitecturalChangeAuthorisation,
): EditResult {
  const problem = checkAuthorisation(auth, arch);
  if (problem) return refuse(problem);

  const floor = findFloor(arch, floorId);
  const wall = floor?.walls.find((w) => w.id === wallId);
  if (!floor || !wall) return refuse('Wall not found.');

  return {
    ok: true,
    description: 'Delete opening',
    architecture: withFloor(arch, floorId, (f) => ({
      ...f,
      walls: f.walls.map((w) =>
        w.id === wallId ? { ...w, openings: w.openings.filter((o) => o.id !== openingId) } : w,
      ),
    })),
  };
}

/**
 * Recompute which walls bound which rooms.
 *
 * Called after structural edits. Wall-to-room association drives the takeoff —
 * which openings are deducted from which room's wall area — so leaving it stale
 * after a wall move produces quantities that look right and are not.
 *
 * A wall bounds a room when its centreline runs along one of the room's edges,
 * within half its thickness plus a tolerance.
 */
export function recomputeBoundingWalls(arch: ArchitectureLayer, floorId: FloorId): ArchitectureLayer {
  return withFloor(arch, floorId, (floor) => ({
    ...floor,
    rooms: floor.rooms.map((room) => {
      const ids = floor.walls
        .filter((wall) => wallBoundsRoom(wall, room))
        .map((wall) => wall.id);
      return { ...room, boundingWallIds: ids };
    }),
  }));
}

/** How much of a room edge must lie along a wall for that wall to bound it. */
const EDGE_OVERLAP_FRACTION = 0.6;
const EDGE_SAMPLES = 9;

/**
 * Does this wall bound this room?
 *
 * Tested by sampling along the ROOM EDGE and asking how much of it runs beside
 * the wall — not by asking whether the wall's two endpoints sit near the edge.
 *
 * The endpoint test looks equivalent and is not. It fails for any wall longer
 * than the edge it bounds, which is the normal case in a real building: one
 * external wall runs the length of the façade past five rooms, and none of
 * those rooms would claim it. It also broke the moment a shared partition was
 * stretched by resizing one of the rooms it separates — the partition ran past
 * the neighbour's edge and the neighbour silently stopped owning it, which in
 * turn let a later resize move a wall it should have refused to touch.
 *
 * Sampling the edge answers the question actually being asked: is this room's
 * boundary, along here, formed by this wall.
 */
function wallBoundsRoom(wall: Wall, room: Room): boolean {
  const tolerance = wall.thickness / 2 + 60;
  const n = room.boundary.length;

  for (let i = 0; i < n; i++) {
    const a = room.boundary[i]!;
    const b = room.boundary[(i + 1) % n]!;

    let near = 0;
    for (let s = 0; s < EDGE_SAMPLES; s++) {
      const t = (s + 0.5) / EDGE_SAMPLES;
      const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (distanceToSegment(point, wall.start, wall.end) <= tolerance) near++;
    }

    if (near / EDGE_SAMPLES >= EDGE_OVERLAP_FRACTION) return true;
  }
  return false;
}

function distanceToSegment(p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Mint an authorisation for a direct user gesture. Never call this for an agent. */
export function userAuthorisation(
  projectId: ArchitectureLayer['projectId'],
  description: string,
  acknowledged: boolean,
): ArchitecturalChangeAuthorisation {
  return {
    projectId,
    description,
    authorisedAt: new Date().toISOString(),
    authorisedBy: 'user',
    professionalReviewAcknowledged: acknowledged,
  };
}
