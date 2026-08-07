import { describe, expect, it } from 'vitest';
import { createProject } from '../project.js';
import { toMm } from '../units.js';
import type { ArchitectureLayer } from './architecture.js';
import {
  ArchitecturalIntegrityError,
  assertGeometryUnchanged,
  fingerprintArchitecture,
  withArchitecturalIntegrity,
  type ArchitecturalChangeAuthorisation,
} from './guard.js';

const NOW = '2026-08-07T00:00:00.000Z';

function project() {
  return createProject(
    {
      name: 'Test plaza',
      buildingType: 'commercial_plaza',
      location: { city: 'Islamabad', country: 'Pakistan', authority: 'CDA' },
      displayUnit: 'ft',
      floors: [
        {
          name: 'Ground Floor',
          level: 0,
          clearHeightMm: toMm(12, 'ft'),
          floorToFloorMm: toMm(13, 'ft'),
          rooms: [
            { name: 'Reception', use: 'reception', widthMm: toMm(20, 'ft'), depthMm: toMm(30, 'ft') },
            { name: 'Office', use: 'office', widthMm: toMm(15, 'ft'), depthMm: toMm(20, 'ft') },
          ],
        },
      ],
    },
    NOW,
  );
}

/** Deep clone through JSON — the same round trip an AI call makes. */
function roundTrip(arch: ArchitectureLayer): ArchitectureLayer {
  return JSON.parse(JSON.stringify(arch)) as ArchitectureLayer;
}

describe('architectural integrity guard', () => {
  it('is stable across a JSON round trip', () => {
    // If this failed, every AI call would look like an unauthorised change.
    const arch = project().architecture;
    expect(fingerprintArchitecture(roundTrip(arch))).toBe(fingerprintArchitecture(arch));
  });

  it('rejects an unauthorised change to a room dimension', () => {
    const arch = project().architecture;

    // The exact failure this guard exists for: the AI widens a room by 2 ft so
    // a conference table fits.
    const tampered = roundTrip(arch);
    const room = tampered.site.buildings[0]!.floors[0]!.rooms[0]!;
    (room.boundary as { x: number; y: number }[])[1]!.x += toMm(2, 'ft');
    (room.boundary as { x: number; y: number }[])[2]!.x += toMm(2, 'ft');

    expect(() =>
      withArchitecturalIntegrity(arch, () => ({ architecture: tampered, result: 'design' })),
    ).toThrow(ArchitecturalIntegrityError);
  });

  it('rejects an unauthorised change to a wall thickness', () => {
    const arch = project().architecture;
    const tampered = roundTrip(arch);
    const wall = tampered.site.buildings[0]!.floors[0]!.walls[0]! as { thickness: number };
    wall.thickness = 300;

    expect(() => assertGeometryUnchanged(arch, tampered)).toThrow(ArchitecturalIntegrityError);
  });

  it('rejects an unauthorised change to an opening', () => {
    const arch = project().architecture;
    const tampered = roundTrip(arch);
    const wall = tampered.site.buildings[0]!.floors[0]!.walls.find((w) => w.openings.length > 0)!;
    (wall.openings[0] as { width: number }).width += 300;

    expect(() => assertGeometryUnchanged(arch, tampered)).toThrow(ArchitecturalIntegrityError);
  });

  it('allows a design-layer operation that leaves geometry alone', () => {
    const arch = project().architecture;
    const result = withArchitecturalIntegrity(arch, () => ({
      architecture: roundTrip(arch),
      result: 'marble floor applied',
    }));
    expect(result.result).toBe('marble floor applied');
  });

  it('allows an authorised change when professional review was acknowledged', () => {
    const arch = project().architecture;
    const tampered = roundTrip(arch);
    (tampered.site.buildings[0]!.floors[0]!.rooms[0]!.boundary as { x: number }[])[1]!.x += 1000;

    const auth: ArchitecturalChangeAuthorisation = {
      projectId: arch.projectId,
      description: 'Move reception partition 1 m east',
      authorisedAt: NOW,
      authorisedBy: 'user',
      professionalReviewAcknowledged: true,
    };

    expect(() =>
      withArchitecturalIntegrity(arch, () => ({ architecture: tampered, result: 1 }), auth),
    ).not.toThrow();
  });

  it('refuses an authorised change when professional review was not acknowledged', () => {
    const arch = project().architecture;
    const tampered = roundTrip(arch);
    (tampered.site.buildings[0]!.floors[0]!.rooms[0]!.boundary as { x: number }[])[1]!.x += 1000;

    const auth: ArchitecturalChangeAuthorisation = {
      projectId: arch.projectId,
      description: 'Move reception partition',
      authorisedAt: NOW,
      authorisedBy: 'user',
      professionalReviewAcknowledged: false,
    };

    expect(() =>
      withArchitecturalIntegrity(arch, () => ({ architecture: tampered, result: 1 }), auth),
    ).toThrow(/professional-review notice/);
  });

  it('tolerates floating-point noise below construction tolerance', () => {
    const arch = project().architecture;
    const noisy = roundTrip(arch);
    // 0.01 mm of drift is not a geometry change.
    (noisy.site.buildings[0]!.floors[0]!.rooms[0]!.boundary as { x: number }[])[1]!.x += 0.01;
    expect(fingerprintArchitecture(noisy)).toBe(fingerprintArchitecture(arch));
  });
});
