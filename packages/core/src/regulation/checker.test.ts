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

describe('planning parameters on the project', () => {
  it('travels with the project through a save and reload', () => {
    // The limits are the whole regulatory feature. Held in a screen's state they
    // vanish on the next tab change and nobody enters a bye-law schedule twice,
    // so they belong on the project — which means they have to survive the JSON
    // round trip that saving a project is.
    const base = createProject(
      {
        name: 'Persistence',
        buildingType: 'commercial_plaza',
        location: { city: 'Islamabad', country: 'Pakistan', authority: 'CDA' },
        displayUnit: 'ft',
        plotWidthMm: toMm(100, 'ft'),
        plotDepthMm: toMm(100, 'ft'),
        cores: [],
        floors: [
          {
            name: 'Ground Floor',
            level: 0,
            clearHeightMm: toMm(12, 'ft'),
            floorToFloorMm: toMm(13, 'ft'),
            rooms: [{ name: 'Hall', use: 'retail', widthMm: toMm(50, 'ft'), depthMm: toMm(50, 'ft') }],
          },
        ],
      },
      NOW,
    );

    const planning: PlanningParameters = {
      authority: 'CDA',
      source: 'CDA Building Regulations 2020, Schedule II',
      recordedAt: NOW,
      // One floor of 50 x 50 on a 100 x 100 plot is FAR 0.25, so 0.10 is a limit
      // this building genuinely breaches — the point is to prove the reloaded
      // figure reaches the checker, which a limit it passes would not show.
      maxFar: 0.1,
      maxGroundCoverage: 0.2,
    };

    const saved = JSON.parse(JSON.stringify({ ...base, planning })) as typeof base;
    expect(saved.planning?.maxFar).toBe(0.1);
    expect(saved.planning?.source).toMatch(/Schedule II/);

    // And the reloaded figures still drive the checker.
    const report = checkRegulations(saved.architecture, saved.planning!);
    const far = report.observations.find((o) => o.code === 'FAR');
    expect(far?.severity).toBe('exceeds_limit');
    expect(far?.parameterSource).toMatch(/Schedule II/);
  });

  it('reports every check as not-checkable when nothing has been entered', () => {
    // The state the application ships in, and the state it must stay in until
    // someone enters a real limit with a real source.
    const report = checkRegulations(arch(2), { authority: 'CDA' });
    expect(report.observations.length).toBeGreaterThan(0);
    for (const o of report.observations) {
      expect(o.severity).toBe('not_checkable');
    }
  });
});
