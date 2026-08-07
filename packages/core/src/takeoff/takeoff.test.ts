import { describe, expect, it } from 'vitest';
import { allFloors, createProject } from '../project.js';
import { toMm } from '../units.js';
import { computeTakeoff } from './takeoff.js';

const NOW = '2026-08-07T00:00:00.000Z';

function singleRoomProject(widthFt: number, depthFt: number, heightFt = 10) {
  return createProject(
    {
      name: 'One room',
      buildingType: 'office',
      location: { city: 'Rawalpindi', country: 'Pakistan', authority: 'RDA' },
      displayUnit: 'ft',
      floors: [
        {
          name: 'Ground Floor',
          level: 0,
          clearHeightMm: toMm(heightFt, 'ft'),
          floorToFloorMm: toMm(heightFt + 1, 'ft'),
          rooms: [
            {
              name: 'Room',
              use: 'office',
              widthMm: toMm(widthFt, 'ft'),
              depthMm: toMm(depthFt, 'ft'),
              doorCount: 1,
              windowCount: 1,
            },
          ],
        },
      ],
    },
    NOW,
  );
}

describe('quantity takeoff', () => {
  it('derives floor area from the room polygon, matching the typed dimensions', () => {
    const project = singleRoomProject(15, 20);
    const takeoff = computeTakeoff(allFloors(project));

    // The requirement's own example: 15 x 20 must stay 15 x 20 = 300 sq ft.
    expect(takeoff.summary.grossFloorAreaSqft).toBeCloseTo(300, 6);

    const floorLine = takeoff.lines.find((l) => l.key.startsWith('floor_area:'));
    expect(floorLine?.quantity).toBeCloseTo(300, 6);
    expect(floorLine?.basis).toBe('measured_from_model');
  });

  it('deducts large openings from wall finish area but not small ones', () => {
    const project = singleRoomProject(15, 20, 10);
    const takeoff = computeTakeoff(allFloors(project));
    const wallLine = takeoff.lines.find((l) => l.key.startsWith('wall_area:'));
    expect(wallLine).toBeDefined();

    // Gross wall = perimeter 70 ft x 10 ft = 700 sq ft, less a 900x2100 door
    // (1.89 m², deductible) and a 1500x1200 window (1.8 m², deductible).
    const doorSqft = (900 * 2100) / 92_903.04;
    const windowSqft = (1500 * 1200) / 92_903.04;
    expect(wallLine!.quantity).toBeCloseTo(700 - doorSqft - windowSqft, 4);
    expect(wallLine!.derivation).toMatch(/perimeter/);
  });

  it('counts doors and windows from the model', () => {
    const project = singleRoomProject(15, 20);
    const takeoff = computeTakeoff(allFloors(project));
    expect(takeoff.summary.doorCount).toBe(1);
    expect(takeoff.summary.windowCount).toBe(1);

    const doors = takeoff.lines.find((l) => l.key.startsWith('doors:'));
    expect(doors?.quantity).toBe(1);
    expect(doors?.basis).toBe('counted_from_model');
  });

  it('reports reinforcement as a gap instead of guessing it', () => {
    // A floor plan does not contain the structural design. Applying a
    // rule-of-thumb kg/sqft here would look like a measured quantity.
    const project = singleRoomProject(15, 20);
    const takeoff = computeTakeoff(allFloors(project));
    const rebar = takeoff.gaps.find((g) => g.key === 'rebar');
    expect(rebar).toBeDefined();
    expect(rebar!.basis).toBe('requires_engineering');
    expect(rebar!.quantity).toBe(0);
    expect(rebar!.gap).toMatch(/structural design/i);
  });

  it('gives every line a derivation an estimator can check', () => {
    const project = singleRoomProject(15, 20);
    const takeoff = computeTakeoff(allFloors(project));
    for (const line of takeoff.lines) {
      expect(line.derivation.length).toBeGreaterThan(0);
    }
  });

  it('scales with real dimensions rather than assuming a shape', () => {
    const small = computeTakeoff(allFloors(singleRoomProject(10, 10)));
    const large = computeTakeoff(allFloors(singleRoomProject(20, 20)));
    expect(small.summary.grossFloorAreaSqft).toBeCloseTo(100, 6);
    expect(large.summary.grossFloorAreaSqft).toBeCloseTo(400, 6);
  });
});
