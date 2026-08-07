import { describe, expect, it } from 'vitest';
import { allFloors, createProject } from '../project.js';
import { toMm } from '../units.js';
import type { FurniturePlacement } from '../model/design.js';
import type { FurnitureId } from '../model/ids.js';
import { hasBlockingViolations, validatePlacements, violationsToCorrectionBrief } from './clearance.js';

const NOW = '2026-08-07T00:00:00.000Z';

function room(widthFt: number, depthFt: number) {
  const project = createProject(
    {
      name: 'Clearance test',
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
            {
              name: 'Conference',
              use: 'conference',
              widthMm: toMm(widthFt, 'ft'),
              depthMm: toMm(depthFt, 'ft'),
            },
          ],
        },
      ],
    },
    NOW,
  );
  const floor = allFloors(project)[0]!;
  return { floor, room: floor.rooms[0]! };
}

function place(over: Partial<FurniturePlacement> & { roomId: FurniturePlacement['roomId'] }): FurniturePlacement {
  return {
    id: `fur_${Math.random().toString(36).slice(2)}` as FurnitureId,
    catalogueKey: 'table.conference.8',
    label: 'Conference table',
    position: { x: 0, y: 0 },
    rotationDeg: 0,
    width: 2400,
    depth: 1200,
    height: 750,
    ...over,
  };
}

describe('clearance validation', () => {
  it('rejects an item too large for the room', () => {
    // A 4.2 m table proposed for a 10 ft (3.05 m) room.
    const { floor, room: r } = room(10, 12);
    const item = place({
      roomId: r.id,
      label: 'Conference table, 14 seats',
      width: 4200,
      depth: 1400,
      position: { x: toMm(5, 'ft'), y: toMm(6, 'ft') },
    });
    const violations = validatePlacements(r, [item], floor.walls);
    expect(violations.some((v) => v.kind === 'outside_room')).toBe(true);
    expect(hasBlockingViolations(violations)).toBe(true);
  });

  it('accepts an item that genuinely fits', () => {
    const { floor, room: r } = room(20, 24);
    const item = place({
      roomId: r.id,
      position: { x: toMm(10, 'ft'), y: toMm(12, 'ft') },
    });
    const violations = validatePlacements(r, [item], floor.walls);
    expect(hasBlockingViolations(violations)).toBe(false);
  });

  it('rejects furniture blocking an emergency exit', () => {
    const { floor, room: r } = room(20, 24);
    // The door sits at the middle of the south wall (y = 0).
    const wall = floor.walls.find((w) => w.openings.some((o) => o.kind === 'door'))!;
    const door = wall.openings.find((o) => o.kind === 'door')!;
    expect(door.isEmergencyExit).toBe(true);

    const item = place({
      roomId: r.id,
      label: 'Reception desk',
      width: 2400,
      depth: 900,
      position: { x: door.distanceAlongWall, y: 700 },
    });
    const violations = validatePlacements(r, [item], floor.walls);
    const blocked = violations.find((v) => v.kind === 'blocks_emergency_exit');
    expect(blocked).toBeDefined();
    expect(blocked!.severity).toBe('error');
    expect(blocked!.message).toMatch(/never negotiable/);
  });

  it('detects overlapping furniture', () => {
    const { floor, room: r } = room(30, 30);
    const a = place({ roomId: r.id, label: 'Table A', position: { x: 5000, y: 5000 } });
    const b = place({ roomId: r.id, label: 'Table B', position: { x: 5300, y: 5000 } });
    const violations = validatePlacements(r, [a, b], floor.walls);
    expect(violations.some((v) => v.kind === 'overlaps_furniture')).toBe(true);
  });

  it('warns when working clearances collide even though the items do not', () => {
    const { floor, room: r } = room(30, 30);
    const a = place({ roomId: r.id, label: 'Desk A', width: 1600, depth: 800, clearanceFront: 900, position: { x: 5000, y: 5000 } });
    const b = place({ roomId: r.id, label: 'Desk B', width: 1600, depth: 800, clearanceFront: 900, position: { x: 5000, y: 4100 } });
    const violations = validatePlacements(r, [a, b], floor.walls);
    expect(violations.some((v) => v.kind === 'insufficient_circulation')).toBe(true);
  });

  it('produces a correction brief that forbids resizing the room', () => {
    const { floor, room: r } = room(10, 12);
    const item = place({ roomId: r.id, width: 4200, depth: 1400, position: { x: 1500, y: 1800 } });
    const violations = validatePlacements(r, [item], floor.walls);
    const brief = violationsToCorrectionBrief(violations);
    expect(brief).toMatch(/MUST FIX/);
    expect(brief).toMatch(/Do not resolve these by changing room dimensions/);
  });
});
