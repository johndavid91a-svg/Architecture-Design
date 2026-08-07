import { describe, expect, it } from 'vitest';
import { allFloors, createProject } from '../project.js';
import { toMm } from '../units.js';
import { THEMES } from '../themes/theme.js';
import { computeTakeoff } from '../takeoff/takeoff.js';
import { applyThemeToFloors } from './apply-theme.js';
import { hasBlockingViolations, validatePlacements } from './clearance.js';

const NOW = '2026-08-07T00:00:00.000Z';
const SATELLITE = THEMES.find((t) => t.name === 'Satellite Company')!;

function project(rooms: Array<{ name: string; use: 'reception' | 'conference' | 'open_office'; w: number; d: number }>) {
  return createProject(
    {
      name: 'Theme test',
      buildingType: 'commercial_plaza',
      location: { city: 'Islamabad', country: 'Pakistan', authority: 'CDA' },
      displayUnit: 'ft',
      floors: [
        {
          name: 'Ground Floor',
          level: 0,
          clearHeightMm: toMm(12, 'ft'),
          floorToFloorMm: toMm(13, 'ft'),
          rooms: rooms.map((r) => ({
            name: r.name,
            use: r.use,
            widthMm: toMm(r.w, 'ft'),
            depthMm: toMm(r.d, 'ft'),
          })),
        },
      ],
    },
    NOW,
  );
}

describe('theme application', () => {
  it('assigns finishes, ceiling and lighting to every room', () => {
    const floors = allFloors(
      project([
        { name: 'Reception', use: 'reception', w: 24, d: 30 },
        { name: 'Open office', use: 'open_office', w: 40, d: 30 },
      ]),
    );
    const applied = applyThemeToFloors(floors, SATELLITE, { includeFurniture: true });

    expect(applied.floors).toHaveLength(1);
    for (const room of applied.floors[0]!.rooms) {
      expect(room.finishes.length).toBeGreaterThan(0);
      expect(room.finishes.some((f) => f.surface === 'floor')).toBe(true);
      expect(room.finishes.some((f) => f.surface === 'wall_internal')).toBe(true);
      expect(room.ceiling.kind).not.toBe('none');
      expect(room.lighting.length).toBeGreaterThan(0);
      expect(room.lighting[0]!.count).toBeGreaterThan(0);
    }
  });

  it('never places furniture that violates clearance', () => {
    // The baseline layout is subject to the same validator as AI output.
    const proj = project([
      { name: 'Reception', use: 'reception', w: 24, d: 30 },
      { name: 'Conference', use: 'conference', w: 20, d: 24 },
      { name: 'Open office', use: 'open_office', w: 40, d: 30 },
    ]);
    const floors = allFloors(proj);
    const applied = applyThemeToFloors(floors, SATELLITE, { includeFurniture: true });

    const floor = floors[0]!;
    for (const roomDesign of applied.floors[0]!.rooms) {
      const room = floor.rooms.find((r) => r.id === roomDesign.roomId)!;
      const violations = validatePlacements(room, roomDesign.furniture, floor.walls);
      expect(hasBlockingViolations(violations)).toBe(false);
    }
  });

  it('reports what it could not place rather than forcing it in', () => {
    // A 14-seat conference table into a room far too small for it.
    const floors = allFloors(project([{ name: 'Tiny meeting', use: 'conference', w: 8, d: 8 }]));
    const applied = applyThemeToFloors(floors, SATELLITE, { includeFurniture: true });
    expect(applied.unplaced.length).toBeGreaterThan(0);
    expect(applied.unplaced[0]).toMatch(/Tiny meeting/);
  });

  it('scales the lighting count with the room area', () => {
    const small = allFloors(project([{ name: 'Small', use: 'open_office', w: 10, d: 10 }]));
    const large = allFloors(project([{ name: 'Large', use: 'open_office', w: 40, d: 40 }]));

    const a = applyThemeToFloors(small, SATELLITE, { includeFurniture: false });
    const b = applyThemeToFloors(large, SATELLITE, { includeFurniture: false });

    const countOf = (r: typeof a) => r.floors[0]!.rooms[0]!.lighting[0]!.count;
    expect(countOf(b)).toBeGreaterThan(countOf(a) * 8);
  });

  it('produces a takeoff with priced-material lines once a theme is applied', () => {
    // Before a theme there are placeholder "no finish selected" lines; after it
    // there are real material lines that the estimator can act on.
    const proj = project([{ name: 'Reception', use: 'reception', w: 24, d: 30 }]);
    const floors = allFloors(proj);
    const base = computeTakeoff(floors);
    expect(base.lines.some((l) => l.key.startsWith('floor_area:'))).toBe(true);

    const applied = applyThemeToFloors(floors, SATELLITE, { includeFurniture: false });
    const design = { ...proj.designs[0]!, floors: applied.floors };
    const themed = computeTakeoff(floors, design);

    expect(themed.lines.some((l) => l.key.startsWith('floor_finish:'))).toBe(true);
    expect(themed.lines.some((l) => l.key.startsWith('ceiling:'))).toBe(true);
    expect(themed.lines.filter((l) => l.materialId !== undefined).length).toBeGreaterThan(
      base.lines.filter((l) => l.materialId !== undefined).length,
    );
  });

  it('gives a feature wall only to client-facing rooms', () => {
    const floors = allFloors(
      project([
        { name: 'Reception', use: 'reception', w: 24, d: 30 },
        { name: 'Office', use: 'open_office', w: 24, d: 30 },
      ]),
    );
    const applied = applyThemeToFloors(floors, SATELLITE, { includeFurniture: false });
    const [reception, office] = applied.floors[0]!.rooms;

    const featureCount = (r: typeof reception) =>
      r!.finishes.filter((f) => f.note === 'Feature wall treatment').length;

    expect(featureCount(reception)).toBe(1);
    expect(featureCount(office)).toBe(0);
  });
});
