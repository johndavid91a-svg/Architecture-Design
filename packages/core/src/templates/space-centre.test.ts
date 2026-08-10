import { describe, expect, it } from 'vitest';
import { boundsOf, polygonArea } from '../geometry.js';
import { allFloors } from '../project.js';
import { computeMetrics } from '../regulation/checker.js';
import { computeTakeoff } from '../takeoff/takeoff.js';
import { buildTour, tourPointAt } from '../layout/tour.js';
import { createSpaceCentre } from './space-centre.js';

const NOW = '2026-08-08T00:00:00.000Z';
const project = createSpaceCentre({}, NOW);
const floors = allFloors(project);

const plate = (level: number) => {
  const floor = floors.find((f) => f.level === level)!;
  const b = boundsOf(floor.rooms.flatMap((r) => r.boundary));
  return { width: b.maxX - b.minX, depth: b.maxY - b.minY, floor };
};

describe('the Space Centre template', () => {
  it('builds four storeys, each with a circulation spine', () => {
    expect(floors).toHaveLength(4);
    for (const floor of floors) {
      expect(floor.rooms.some((r) => r.use === 'corridor')).toBe(true);
    }
  });

  it('gives every room a door onto circulation', () => {
    // A room with no door is a room nobody can enter. It is the single most
    // embarrassing thing a generated plan can contain, and the cheapest to check.
    for (const floor of floors) {
      const habitable = floor.rooms.filter((r) => !['corridor', 'stair', 'lift'].includes(r.use));
      for (const room of habitable) {
        const hasDoor = floor.walls.some(
          (w) => room.boundingWallIds.includes(w.id) && w.openings.some((o) => o.kind === 'door'),
        );
        expect(hasDoor, `${room.name} on ${floor.name} has no door`).toBe(true);
      }
    }
  });

  it('never lets an upper floor oversail the one below it', () => {
    // A floor wider or deeper than its neighbour below is a cantilever, which is
    // an engineering decision with a cost attached — not something a room
    // schedule should produce by accident.
    for (let level = 1; level < floors.length; level++) {
      const upper = plate(level);
      const lower = plate(level - 1);
      expect(upper.width, `level ${level} is wider than level ${level - 1}`).toBeLessThanOrEqual(
        lower.width + 1,
      );
      expect(upper.depth, `level ${level} is deeper than level ${level - 1}`).toBeLessThanOrEqual(
        lower.depth + 1,
      );
    }
  });

  it('keeps the building inside its plot', () => {
    const metrics = computeMetrics(project.architecture);
    expect(metrics.groundCoverageRatio).not.toBeNull();
    expect(metrics.groundCoverageRatio!).toBeGreaterThan(0);
    expect(metrics.groundCoverageRatio!).toBeLessThan(1);
  });

  it('runs the stair and the lift the full height', () => {
    for (const floor of floors) {
      expect(floor.rooms.some((r) => r.use === 'stair'), `${floor.name} has no stair`).toBe(true);
      expect(floor.rooms.some((r) => r.use === 'lift'), `${floor.name} has no lift`).toBe(true);
    }
  });

  it('gives every floor a way out', () => {
    for (const floor of floors) {
      const exits = floor.walls.flatMap((w) => w.openings.filter((o) => o.isEmergencyExit));
      expect(exits.length, `${floor.name} has no escape door`).toBeGreaterThan(0);
    }
  });

  it('leaves the planetarium and the data centre without windows', () => {
    // Daylight would ruin a projection dome and is a thermal load on a room full
    // of servers. Both are deliberately blind, and that has to survive layout.
    const blind = floors.flatMap((f) =>
      f.rooms
        .filter((r) => r.use === 'planetarium' || r.use === 'server_room')
        .map((r) => ({ room: r, floor: f })),
    );
    expect(blind.length).toBeGreaterThan(0);

    for (const { room, floor } of blind) {
      const windows = floor.walls
        .filter((w) => room.boundingWallIds.includes(w.id))
        .flatMap((w) => w.openings.filter((o) => o.kind === 'window'));
      expect(windows, `${room.name} should have no windows`).toHaveLength(0);
    }
  });

  it('keeps every opening inside the wall that carries it', () => {
    for (const floor of floors) {
      for (const wall of floor.walls) {
        const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
        for (const o of wall.openings) {
          expect(o.distanceAlongWall - o.width / 2).toBeGreaterThanOrEqual(-1);
          expect(o.distanceAlongWall + o.width / 2).toBeLessThanOrEqual(length + 1);
        }
      }
    }
  });

  it('produces a takeoff with no impossible quantity', () => {
    const takeoff = computeTakeoff(floors);
    expect(takeoff.lines.length).toBeGreaterThan(100);
    for (const line of takeoff.lines) {
      expect(Number.isFinite(line.quantity)).toBe(true);
      expect(line.quantity).toBeGreaterThanOrEqual(0);
      expect(line.derivation.length).toBeGreaterThan(0);
    }
  });

  it('holds the authored dimensions exactly', () => {
    // The template states a 16 m planetarium dome. If the layout has quietly
    // resized it to make the plate tidy, every quantity taken from it is wrong.
    const dome = floors.flatMap((f) => f.rooms).find((r) => r.use === 'planetarium')!;
    const b = boundsOf(dome.boundary);
    expect(b.maxX - b.minX).toBeCloseTo(16_000, 6);
    expect(b.maxY - b.minY).toBeCloseTo(16_000, 6);
    expect(polygonArea(dome.boundary)).toBeCloseTo(16_000 * 16_000, 3);
  });
});

describe('the circulation tour', () => {
  it('reaches every room on a floor', () => {
    for (const floor of floors) {
      const tour = buildTour(floor);
      const expected = floor.rooms.filter((r) => r.use !== 'corridor').length;
      expect(tour.stops.length, `${floor.name}`).toBe(expected);
    }
  });

  it('orders the stops the way someone walking would meet them', () => {
    const tour = buildTour(floors[0]!);
    for (let i = 1; i < tour.stops.length; i++) {
      expect(tour.stops[i]!.distanceAlong).toBeGreaterThanOrEqual(tour.stops[i - 1]!.distanceAlong);
    }
  });

  it('stays on the route from one end to the other', () => {
    const tour = buildTour(floors[0]!);
    expect(tour.totalLength).toBeGreaterThan(0);

    const start = tourPointAt(tour, 0);
    const end = tourPointAt(tour, tour.totalLength);
    expect(start.at).toEqual(tour.path[0]);
    expect(end.at).toEqual(tour.path[tour.path.length - 1]);

    // Past the end it clamps rather than running off into space.
    const beyond = tourPointAt(tour, tour.totalLength * 10);
    expect(beyond.at).toEqual(end.at);
  });

  it('does not throw on a floor with nothing in it', () => {
    const empty = { ...floors[0]!, rooms: [], walls: [] };
    const tour = buildTour(empty);
    expect(tour.stops).toHaveLength(0);
    expect(tour.totalLength).toBe(0);
  });
});
