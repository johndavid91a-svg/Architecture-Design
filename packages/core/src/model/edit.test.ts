import { describe, expect, it } from 'vitest';
import { createProject } from '../project.js';
import { toMm } from '../units.js';
import { fingerprintArchitecture } from './guard.js';
import {
  addOpening,
  deleteWall,
  moveWallEndpoint,
  recomputeBoundingWalls,
  resizeRoom,
  setRoomProperties,
  userAuthorisation,
} from './edit.js';
import { History } from './history.js';
import type { ArchitectureLayer } from './architecture.js';

const NOW = '2026-08-07T00:00:00.000Z';

function arch(): ArchitectureLayer {
  return createProject(
    {
      name: 'Edit test',
      buildingType: 'office',
      location: { city: 'Islamabad', country: 'Pakistan', authority: 'CDA' },
      displayUnit: 'ft',
      floors: [
        {
          name: 'Ground Floor',
          level: 0,
          clearHeightMm: toMm(10, 'ft'),
          floorToFloorMm: toMm(11, 'ft'),
          rooms: [
            { name: 'A', use: 'office', widthMm: toMm(20, 'ft'), depthMm: toMm(24, 'ft') },
            { name: 'B', use: 'office', widthMm: toMm(15, 'ft'), depthMm: toMm(24, 'ft') },
          ],
        },
      ],
    },
    NOW,
  ).architecture;
}

const auth = (a: ArchitectureLayer) => userAuthorisation(a.projectId, 'test edit', true);

function boundsOfRoom(a: ArchitectureLayer, index: number) {
  const room = a.site.buildings[0]!.floors[0]!.rooms[index]!;
  const xs = room.boundary.map((p) => p.x);
  const ys = room.boundary.map((p) => p.y);
  return { width: Math.max(...xs) - Math.min(...xs), depth: Math.max(...ys) - Math.min(...ys) };
}

describe('architecture editing', () => {
  it('refuses a geometry edit with no authorisation', () => {
    const a = arch();
    const floor = a.site.buildings[0]!.floors[0]!;
    const result = resizeRoom(a, floor.id, floor.rooms[0]!.id, toMm(30, 'ft'), toMm(30, 'ft'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/authorisation/i);
  });

  it('refuses when the professional-review notice was not acknowledged', () => {
    const a = arch();
    const floor = a.site.buildings[0]!.floors[0]!;
    const unacknowledged = userAuthorisation(a.projectId, 'test', false);
    const result = resizeRoom(a, floor.id, floor.rooms[0]!.id, toMm(30, 'ft'), toMm(30, 'ft'), unacknowledged);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/professional-review/i);
  });

  it('resizes a room and the geometry fingerprint changes', () => {
    const a = arch();
    const before = fingerprintArchitecture(a);
    const floor = a.site.buildings[0]!.floors[0]!;

    // Depth, not width: room A's east side is a partition shared with room B,
    // and widening it is refused for that reason.
    const result = resizeRoom(a, floor.id, floor.rooms[0]!.id, toMm(20, 'ft'), toMm(30, 'ft'), auth(a));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(fingerprintArchitecture(result.architecture)).not.toBe(before);

    const room = result.architecture.site.buildings[0]!.floors[0]!.rooms[0]!;
    const ys = room.boundary.map((p) => p.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(toMm(30, 'ft'), 6);
  });

  it('moves the room walls with the room, so the slab never outruns them', () => {
    // Without this, a resized room renders as a floor slab extending past its
    // own walls, and the takeoff computes wall area from the new perimeter while
    // masonry still comes from the old wall lengths.
    const a = arch();
    const floor = a.site.buildings[0]!.floors[0]!;
    const room = floor.rooms[0]!;

    // Room A is the first in the strip: its east side is a shared partition, so
    // only deepen it, which moves the north wall alone.
    const before = boundsOfRoom(a, 0);
    const result = resizeRoom(a, floor.id, room.id, before.width, before.depth + 1000, auth(a));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const nextFloor = result.architecture.site.buildings[0]!.floors[0]!;
    const nextRoom = nextFloor.rooms[0]!;
    const maxY = Math.max(...nextRoom.boundary.map((p) => p.y));

    const northWall = nextFloor.walls.find((w) => nextRoom.boundingWallIds.includes(w.id) && w.start.y > maxY - 500);
    expect(northWall).toBeDefined();
    // The wall keeps its half-thickness offset outside the finished face.
    expect(northWall!.start.y).toBeCloseTo(maxY + northWall!.thickness / 2, 3);
  });

  it('refuses a resize that would move a partition shared with another room', () => {
    // Moving it would silently change the neighbour's size without changing the
    // neighbour's polygon, leaving the two permanently disagreeing.
    const a = arch();
    const floor = a.site.buildings[0]!.floors[0]!;
    const room = floor.rooms[0]!;
    const before = boundsOfRoom(a, 0);

    const result = resizeRoom(a, floor.id, room.id, before.width + 1000, before.depth, auth(a));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/shared with an adjoining room/i);
  });

  it('refuses to shorten a wall past an opening it carries', () => {
    // Silently dropping the door, or clamping it, would leave the model and the
    // takeoff quietly disagreeing about how many doors the building has.
    const a = arch();
    const floor = a.site.buildings[0]!.floors[0]!;
    const wall = floor.walls.find((w) => w.openings.some((o) => o.kind === 'door'))!;

    const result = moveWallEndpoint(a, floor.id, wall.id, 'end', { x: wall.start.x + 300, y: wall.start.y }, auth(a));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/opening/i);
  });

  it('refuses to delete a load-bearing wall', () => {
    const a = arch();
    const floor = a.site.buildings[0]!.floors[0]!;
    const bearing = floor.walls.find((w) => w.loadBearing)!;
    const result = deleteWall(a, floor.id, bearing.id, auth(a));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/load-bearing/i);
  });

  it('refuses an opening that would overlap another on the same wall', () => {
    const a = arch();
    const floor = a.site.buildings[0]!.floors[0]!;
    const wall = floor.walls.find((w) => w.openings.length > 0)!;
    const existing = wall.openings[0]!;

    const result = addOpening(
      a,
      floor.id,
      wall.id,
      {
        kind: 'window',
        distanceAlongWallMm: existing.distanceAlongWall + 100,
        widthMm: 1000,
        heightMm: 1200,
        sillHeightMm: 900,
      },
      auth(a),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/overlap/i);
  });

  it('refuses an opening that runs off the end of the wall', () => {
    const a = arch();
    const floor = a.site.buildings[0]!.floors[0]!;
    const wall = floor.walls[0]!;
    const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);

    const result = addOpening(
      a,
      floor.id,
      wall.id,
      { kind: 'window', distanceAlongWallMm: length - 100, widthMm: 2000, heightMm: 1200, sillHeightMm: 900 },
      auth(a),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/past the end/i);
  });

  it('lets a rename through without an authorisation, since it is not geometry', () => {
    const a = arch();
    const floor = a.site.buildings[0]!.floors[0]!;
    const before = fingerprintArchitecture(a);

    const result = setRoomProperties(a, floor.id, floor.rooms[0]!.id, { name: 'Reception' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.architecture.site.buildings[0]!.floors[0]!.rooms[0]!.name).toBe('Reception');
    expect(fingerprintArchitecture(result.architecture)).toBe(before);
  });

  it('requires authorisation for a clear-height change, which is geometry', () => {
    const a = arch();
    const floor = a.site.buildings[0]!.floors[0]!;
    const result = setRoomProperties(a, floor.id, floor.rooms[0]!.id, { clearHeightMm: toMm(14, 'ft') });
    expect(result.ok).toBe(false);
  });

  it('recomputes which walls bound which rooms', () => {
    const a = arch();
    const floor = a.site.buildings[0]!.floors[0]!;
    const recomputed = recomputeBoundingWalls(a, floor.id);
    for (const room of recomputed.site.buildings[0]!.floors[0]!.rooms) {
      // Each room in the strip is bounded by at least its north, south and west walls.
      expect(room.boundingWallIds.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('undo / redo', () => {
  it('restores the previous state and then replays it', () => {
    const a = arch();
    const history = new History(a, 'Initial');
    const floor = a.site.buildings[0]!.floors[0]!;

    const edit = resizeRoom(a, floor.id, floor.rooms[0]!.id, toMm(20, 'ft'), toMm(30, 'ft'), auth(a));
    expect(edit.ok).toBe(true);
    if (!edit.ok) return;
    history.push(edit.architecture, edit.description);

    expect(history.canUndo).toBe(true);
    const undone = history.undo();
    expect(fingerprintArchitecture(undone!)).toBe(fingerprintArchitecture(a));

    const redone = history.redo();
    expect(fingerprintArchitecture(redone!)).toBe(fingerprintArchitecture(edit.architecture));
  });

  it('discards the redo branch once a new edit is made', () => {
    const a = arch();
    const history = new History(a, 'Initial');
    const floor = a.site.buildings[0]!.floors[0]!;

    const first = resizeRoom(a, floor.id, floor.rooms[0]!.id, toMm(20, 'ft'), toMm(30, 'ft'), auth(a));
    if (!first.ok) throw new Error('setup');
    history.push(first.architecture, 'first');
    history.undo();

    const second = resizeRoom(a, floor.id, floor.rooms[0]!.id, toMm(20, 'ft'), toMm(28, 'ft'), auth(a));
    if (!second.ok) throw new Error('setup');
    history.push(second.architecture, 'second');

    // Redoing into the abandoned branch would take the user to a state that no
    // longer follows from the present one.
    expect(history.canRedo).toBe(false);
  });
});
