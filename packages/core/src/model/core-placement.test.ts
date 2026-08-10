import { describe, expect, it } from 'vitest';
import { materialise } from '../import/materialise.js';
import type { CandidateFloor, CandidateRoom, CandidateWall } from '../import/contract.js';
import { addCores, transportPoints } from './circulation.js';
import { fitCores, hasVerticalCirculation } from './core-placement.js';
import { findEntrances, justInside } from './wayfinding.js';

const NOW = '2026-08-10T00:00:00.000Z';

const rect = (x: number, y: number, w: number, d: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + d },
  { x, y: y + d },
];

const room = (name: string, x: number, y: number, w: number, d: number): CandidateRoom => ({
  name,
  use: 'office',
  boundary: rect(x, y, w, d),
  clearHeight: 3000,
  confidence: 'extracted',
});

const wall = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  openings: CandidateWall['openings'] = [],
  fn: CandidateWall['function'] = 'exterior',
): CandidateWall => ({
  start: { x: x1, y: y1 },
  end: { x: x2, y: y2 },
  thickness: 229,
  height: 3000,
  function: fn,
  loadBearing: true,
  confidence: 'extracted',
  openings,
});

/**
 * A building shaped like a real import: rooms down one side, an open bay on the
 * other, and a front door. Nothing in it is a stair or a lift, which is exactly
 * what a PDF import produces.
 */
function importedFloors(count: number): CandidateFloor[] {
  const floors: CandidateFloor[] = [];
  for (let i = 0; i < count; i++) {
    floors.push({
      name: i === 0 ? 'Ground' : `Floor ${i}`,
      level: i,
      elevation: i * 3600,
      floorToFloor: 3600,
      clearHeight: 3000,
      confidence: 'extracted',
      rooms: [room('Room 1', 0, 0, 6000, 8000), room('Room 2', 0, 8000, 6000, 8000)],
      walls: [
        // Front wall, carrying the widest door in the building.
        wall(0, 0, 20000, 0, [
          {
            kind: 'door',
            distanceAlongWall: 12000,
            width: 1800,
            height: 2400,
            sillHeight: 0,
            confidence: 'extracted',
          },
          {
            kind: 'door',
            distanceAlongWall: 3000,
            width: 900,
            height: 2100,
            sillHeight: 0,
            confidence: 'extracted',
          },
        ]),
        wall(20000, 0, 20000, 16000),
        wall(20000, 16000, 0, 16000),
        wall(0, 16000, 0, 0),
      ],
    });
  }
  return floors;
}

describe('a building that arrived without a way between its floors', () => {
  it('knows when there is no vertical circulation at all', () => {
    const result = materialise(
      {
        name: 'No cores',
        buildingType: 'commercial_plaza',
        location: { city: 'Islamabad', country: 'Pakistan', authority: 'CDA' },
        displayUnit: 'ft',
        floors: [importedFloors(1)[0]!],
      },
      NOW,
    );
    // One storey needs no core, and none is added: a stair to nowhere is worse
    // than no stair.
    const floors = result.project.architecture.site.buildings[0]!.floors;
    expect(hasVerticalCirculation(floors)).toBe(false);
  });

  it('fits a stair and a lift into a multi-storey import, on every storey', () => {
    const floors = importedFloors(9);
    const result = materialise(
      {
        name: 'Imported plaza',
        buildingType: 'commercial_plaza',
        location: { city: 'Islamabad', country: 'Pakistan', authority: 'CDA' },
        displayUnit: 'ft',
        floors,
      },
      NOW,
    );

    const built = result.project.architecture.site.buildings[0]!.floors;
    expect(built).toHaveLength(9);
    expect(hasVerticalCirculation(built)).toBe(true);

    // Every storey, not just the ground floor. A lift that exists on four floors
    // of nine is not a lift.
    for (const floor of built) {
      expect(floor.rooms.filter((r) => r.use === 'stair')).toHaveLength(1);
      expect(floor.rooms.filter((r) => r.use === 'lift')).toHaveLength(1);
      expect(floor.stairs).toHaveLength(1);
    }
  });

  it('says so, rather than letting the user think it came off the drawing', () => {
    const result = materialise(
      {
        name: 'Imported plaza',
        buildingType: 'commercial_plaza',
        location: { city: 'Islamabad', country: 'Pakistan', authority: 'CDA' },
        displayUnit: 'ft',
        floors: importedFloors(4),
      },
      NOW,
    );
    const declared = result.issues.find((i) => i.code === 'CORES_ADDED');
    expect(declared).toBeDefined();
    expect(declared!.severity).toBe('review');

    const built = result.project.architecture.site.buildings[0]!.floors;
    for (const floor of built) {
      for (const core of floor.rooms.filter((r) => r.use === 'stair' || r.use === 'lift')) {
        expect(core.provenance.confidence).toBe('inferred');
      }
    }
  });

  it('adds nothing when the drawing already has a stair', () => {
    const floors = importedFloors(3).map((f) => ({
      ...f,
      rooms: [...f.rooms, { ...room('STAIR', 12000, 2000, 2400, 5000), use: 'stair' as const }],
    }));
    const result = materialise(
      {
        name: 'Has a stair',
        buildingType: 'commercial_plaza',
        location: { city: 'Islamabad', country: 'Pakistan', authority: 'CDA' },
        displayUnit: 'ft',
        floors,
      },
      NOW,
    );
    expect(result.issues.find((i) => i.code === 'CORES_ADDED')).toBeUndefined();
    const built = result.project.architecture.site.buildings[0]!.floors;
    for (const floor of built) {
      expect(floor.rooms.filter((r) => r.use === 'lift')).toHaveLength(0);
    }
  });

  it('puts the core in free space, not through somebody’s office', () => {
    const fitted = fitCores(
      materialise(
        {
          name: 'Fit test',
          buildingType: 'commercial_plaza',
          location: { city: 'Islamabad', country: 'Pakistan', authority: 'CDA' },
          displayUnit: 'ft',
          // Two storeys of the same rooms, so the free bay is free on both.
          floors: importedFloors(2).map((f) => ({ ...f })),
        },
        NOW,
      ).project.architecture.site.buildings[0]!.floors.map((f) => ({
        ...f,
        // Strip the cores materialise already added, so this tests fitCores alone.
        rooms: f.rooms.filter((r) => r.use !== 'stair' && r.use !== 'lift'),
        stairs: [],
      })),
      ['stair', 'lift'],
    );

    expect(fitted.placement).not.toBeNull();
    expect(fitted.placement!.inside).toBe(true);

    // The rooms occupy x 0..6000. The core must clear them.
    expect(fitted.placement!.origin.x).toBeGreaterThanOrEqual(6000);
  });

  it('gives the walkthrough a landing on every floor to travel between', () => {
    const result = materialise(
      {
        name: 'Travel',
        buildingType: 'commercial_plaza',
        location: { city: 'Islamabad', country: 'Pakistan', authority: 'CDA' },
        displayUnit: 'ft',
        floors: importedFloors(5),
      },
      NOW,
    );
    const points = transportPoints(result.project.architecture.site.buildings[0]!.floors);
    // Five floors, two cores each.
    expect(points).toHaveLength(10);
    expect(new Set(points.filter((p) => p.kind === 'lift').map((p) => p.level)).size).toBe(5);
  });
});

describe('a shaft has to be plumb', () => {
  /** Storeys that step back as they rise, as a real public building does. */
  const stepped = (): CandidateFloor[] =>
    [0, 1, 2, 3].map((i) => ({
      name: `Level ${i}`,
      level: i,
      elevation: i * (4200 + i * 600),
      // A different floor-to-floor on each storey, which is what drives a stair
      // core's depth.
      floorToFloor: 4200 + i * 600,
      clearHeight: 3600,
      confidence: 'extracted',
      rooms: [
        room('Corridor', 0, 6000 - i * 1000, 20000 - i * 2000, 2400),
        room('Space', 0, 0, 20000 - i * 2000, 5600),
      ].map((r, k) => (k === 0 ? { ...r, use: 'corridor' as const } : r)),
      walls: [wall(0, 0, 20000, 0)],
    }));

  it('puts the stair and the lift on the same line on every storey', () => {
    const materialised = materialise(
      {
        name: 'Stepped',
        buildingType: 'commercial_plaza',
        location: { city: 'Islamabad', country: 'Pakistan', authority: 'CDA' },
        displayUnit: 'ft',
        floors: stepped(),
      },
      NOW,
    ).project.architecture.site.buildings[0]!.floors.map((f) => ({
      ...f,
      rooms: f.rooms.filter((r) => r.use !== 'stair' && r.use !== 'lift'),
      stairs: [],
    }));

    const { floors: cored } = addCores(materialised, ['stair', 'lift']);
    const points = transportPoints(cored);

    for (const kind of ['stair', 'lift'] as const) {
      const of = points.filter((p) => p.kind === kind);
      expect(of.length).toBe(4);
      const xs = new Set(of.map((p) => Math.round(p.at.x)));
      const ys = new Set(of.map((p) => Math.round(p.at.y)));
      // A shaft that moves sideways as it rises cannot be built, and the
      // walkthrough can only travel it by pretending two shafts are one. Each
      // storey following its own stepped-back corridor drifted the lift 3 m.
      expect(xs.size, `${kind} x drifted: ${[...xs].join(', ')}`).toBe(1);
      expect(ys.size, `${kind} y drifted: ${[...ys].join(', ')}`).toBe(1);
    }
  });
});

describe('finding the way in', () => {
  it('takes the widest door on the lowest storey above ground', () => {
    const result = materialise(
      {
        name: 'Entrance',
        buildingType: 'commercial_plaza',
        location: { city: 'Islamabad', country: 'Pakistan', authority: 'CDA' },
        displayUnit: 'ft',
        floors: importedFloors(3),
      },
      NOW,
    );
    const entrances = findEntrances(result.project.architecture.site.buildings[0]!.floors);
    expect(entrances.length).toBeGreaterThan(0);
    const main = entrances[0]!;
    expect(main.level).toBe(0);
    expect(main.widthMm).toBe(1800);
  });

  it('points inward, so standing just inside puts you in the building', () => {
    const result = materialise(
      {
        name: 'Entrance',
        buildingType: 'commercial_plaza',
        location: { city: 'Islamabad', country: 'Pakistan', authority: 'CDA' },
        displayUnit: 'ft',
        floors: importedFloors(3),
      },
      NOW,
    );
    const main = findEntrances(result.project.architecture.site.buildings[0]!.floors)[0]!;
    // The front wall runs along y = 0 and the building is at positive y, so
    // inward must be +y. Getting this backwards drops the walker on the pavement.
    expect(main.inward.y).toBeGreaterThan(0.9);
    expect(justInside(main).y).toBeGreaterThan(main.at.y);
  });

  it('returns nothing rather than inventing a door when there is none', () => {
    const bare = importedFloors(2).map((f) => ({
      ...f,
      walls: f.walls.map((w) => ({ ...w, openings: [] })),
    }));
    const result = materialise(
      {
        name: 'Sealed',
        buildingType: 'commercial_plaza',
        location: { city: 'Islamabad', country: 'Pakistan', authority: 'CDA' },
        displayUnit: 'ft',
        floors: bare,
      },
      NOW,
    );
    const floors = result.project.architecture.site.buildings[0]!.floors;
    // The fitted stair core carries an emergency archway, not a front door, so
    // the only doors present are the lift's — which are not on the perimeter.
    const entrances = findEntrances(floors).filter((e) => !e.isEmergencyExit);
    expect(entrances.every((e) => e.widthMm <= 1100)).toBe(true);
  });
});
