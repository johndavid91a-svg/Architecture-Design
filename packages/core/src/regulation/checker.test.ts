import { describe, expect, it } from 'vitest';
import { createProject } from '../project.js';
import { toMm } from '../units.js';
import { checkRegulations, computeMetrics, type PlanningParameters } from './checker.js';
import type { ArchitectureLayer } from '../model/architecture.js';

const NOW = '2026-08-07T00:00:00.000Z';

function arch(floorCount: number, cores: 'none' | 'default' = 'none'): ArchitectureLayer {
  return createProject(
    {
      name: 'Reg test',
      buildingType: 'commercial_plaza',
      location: { city: 'Islamabad', country: 'Pakistan', authority: 'CDA' },
      displayUnit: 'ft',
      plotWidthMm: toMm(100, 'ft'),
      plotDepthMm: toMm(100, 'ft'),
      // These tests are about the coverage arithmetic, so the generated stair
      // and lift cores are switched off; they are exercised separately below.
      cores: cores === 'none' ? [] : ['stair', 'lift'],
      floors: Array.from({ length: floorCount }, (_, i) => ({
        name: i === 0 ? 'Ground Floor' : `Floor ${i}`,
        level: i,
        clearHeightMm: toMm(12, 'ft'),
        floorToFloorMm: toMm(13, 'ft'),
        rooms: [{ name: 'Hall', use: 'retail' as const, widthMm: toMm(50, 'ft'), depthMm: toMm(50, 'ft') }],
      })),
    },
    NOW,
  ).architecture;
}

const base: PlanningParameters = { authority: 'CDA', source: 'Test parameters' };

describe('regulation checker', () => {
  it('computes FAR and coverage from the model', () => {
    const metrics = computeMetrics(arch(2));
    // Two floors of 50x50 = 5,000 sq ft covered, on a 10,000 sq ft plot.
    expect(metrics.totalCoveredAreaSqft).toBeCloseTo(5000, 0);
    expect(metrics.plotAreaSqft).toBeCloseTo(10_000, 0);
    expect(metrics.far).toBeCloseTo(0.5, 3);
    expect(metrics.floorCount).toBe(2);
  });

  it('raises an observation when FAR exceeds the entered limit', () => {
    const report = checkRegulations(arch(6), { ...base, maxFar: 1.0 });
    const far = report.observations.find((o) => o.code === 'FAR');
    expect(far?.severity).toBe('exceeds_limit');
    expect(far?.measured).toBeGreaterThan(1.0);
  });

  it('warns when a value is close to the limit rather than staying silent', () => {
    // 2 floors → FAR 0.5. A limit of 0.51 puts it inside the 5% band.
    const report = checkRegulations(arch(2), { ...base, maxFar: 0.51 });
    const far = report.observations.find((o) => o.code === 'FAR');
    expect(far?.severity).toBe('near_limit');
  });

  it('says it cannot check rather than passing silently when a parameter is missing', () => {
    const report = checkRegulations(arch(2), base);
    const codes = report.observations.filter((o) => o.severity === 'not_checkable').map((o) => o.code);
    expect(codes).toContain('FAR');
    expect(codes).toContain('COVERAGE');
    expect(codes).toContain('HEIGHT');
    expect(codes).toContain('PARKING');
    expect(codes).toContain('SETBACK');
  });

  it('never reports a pass verdict', () => {
    const report = checkRegulations(arch(1), { ...base, maxFar: 10, maxGroundCoverage: 0.9 });
    for (const o of report.observations) {
      expect(['exceeds_limit', 'near_limit', 'not_checkable']).toContain(o.severity);
    }
    // Silence on FAR means "nothing detected", not "compliant".
    expect(report.observations.find((o) => o.code === 'FAR')).toBeUndefined();
  });

  it('computes a parking shortfall from covered area', () => {
    // 1 floor of 2,500 sq ft at one bay per 500 sq ft = 5 bays required.
    const report = checkRegulations(arch(1), {
      ...base,
      parkingBaysPerSqft: 1 / 500,
      parkingBaysProvided: 2,
    });
    const parking = report.observations.find((o) => o.code === 'PARKING');
    expect(parking?.severity).toBe('exceeds_limit');
    expect(parking?.limit).toBe(5);
    expect(parking?.measured).toBe(2);
  });

  it('counts generated stair and lift cores in the covered area', () => {
    // A lift shaft and a staircase occupy real floor area on every storey and
    // cost real masonry. Leaving them out of the coverage figure understates
    // both the FAR and the build cost — a routine and expensive omission.
    const without = computeMetrics(arch(2, 'none'));
    const with_ = computeMetrics(arch(2, 'default'));

    expect(with_.totalCoveredAreaSqft).toBeGreaterThan(without.totalCoveredAreaSqft);
    expect(with_.far!).toBeGreaterThan(without.far!);
  });

  it('always carries the disclaimer', () => {
    const report = checkRegulations(arch(1), base);
    expect(report.disclaimer).toMatch(/not a compliance determination/i);
    expect(report.disclaimer).toMatch(/verified by a qualified architect or engineer/i);
  });
});
