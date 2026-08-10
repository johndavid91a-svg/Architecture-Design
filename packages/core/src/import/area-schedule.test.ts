import { describe, expect, it } from 'vitest';
import type { TextItem } from './contract.js';
import { compareWithDrawing, mergeAreaSchedules, readAreaSchedule } from './area-schedule.js';

/** A schedule row as a PDF emits it: label, `=` and figure as separate runs. */
const row = (label: string, value: string, y: number): TextItem[] => [
  { text: label, at: { x: 100, y }, heightHint: 10 },
  { text: '=', at: { x: 300, y }, heightHint: 10 },
  { text: value, at: { x: 340, y }, heightHint: 10 },
];

/**
 * The schedule from the set that prompted this, laid out as the file has it —
 * out of storey order, with the total in the middle.
 */
const SHEET: TextItem[] = [
  { text: 'SCHEDULE OF COV. AREA', at: { x: 100, y: 500 }, heightHint: 14 },
  ...row('GROUND FLOOR COV. AREA', '1717.34 Sft', 480),
  ...row('TOTAL COV. AREA', '12845.94 Sft', 460),
  ...row('BASEMENT FLOOR COV. AREA', '1717.34 Sft', 440),
  ...row('FIRST FLOOR COV. AREA', '1717.34 Sft', 420),
  ...row('MUMTY FLOOR COV. AREA', '458.56 Sft', 400),
  ...row('MEZZANINE FLOOR COV. AREA', '1717.34 Sft', 380),
  ...row("PLOT SIZE & AREA", "40'x45' (1800 sft)", 360),
];

describe('the drawing’s own covered-area schedule', () => {
  it('reads every storey the schedule names', () => {
    const areas = readAreaSchedule(SHEET)!;
    expect(areas.perStorey.map((a) => a.storey).sort()).toEqual([
      'BASEMENT',
      'FIRST',
      'GROUND',
      'MEZZANINE',
      'MUMTY',
    ]);
    expect(areas.perStorey.find((a) => a.storey === 'MUMTY')!.sqft).toBe(458.56);
  });

  it('reads the total and the plot', () => {
    const areas = readAreaSchedule(SHEET)!;
    expect(areas.totalSqft).toBe(12845.94);
    expect(areas.plotSqft).toBe(1800);
    expect(areas.plotSize).toBe("40'x45'");
  });

  it('does not read the total as a storey', () => {
    const areas = readAreaSchedule(SHEET)!;
    expect(areas.perStorey.some((a) => /total/i.test(a.storey))).toBe(false);
  });

  it('matches label to figure by position, not by reading order', () => {
    // A PDF emits runs in whatever order the exporter chose. Pairing by order
    // works until a two-column schedule interleaves, and then it silently
    // attaches the wrong number to a storey — which is worse than reading none.
    const scrambled = [...SHEET].reverse();
    const areas = readAreaSchedule(scrambled)!;
    expect(areas.perStorey.find((a) => a.storey === 'MUMTY')!.sqft).toBe(458.56);
    expect(areas.perStorey.find((a) => a.storey === 'GROUND')!.sqft).toBe(1717.34);
  });

  it('returns nothing for a sheet that carries no schedule', () => {
    expect(readAreaSchedule([{ text: 'FRONT ELEVATION', at: { x: 0, y: 0 } }])).toBeNull();
  });

  it('merges the schedules found across a set without double-counting', () => {
    const merged = mergeAreaSchedules([null, readAreaSchedule(SHEET), readAreaSchedule(SHEET)])!;
    expect(merged.perStorey).toHaveLength(5);
    expect(merged.totalSqft).toBe(12845.94);
  });
});

describe('checking what we read against what the drawing says', () => {
  const stated = readAreaSchedule(SHEET)!;

  it('catches geometry that is wrong by a factor', () => {
    // The real failure: storeys the schedule puts at 1,717.34 sq ft were traced
    // as 21. Nothing else in the pipeline could tell, because every part of it
    // was internally consistent — and consistently wrong.
    const rows = compareWithDrawing(stated, [
      { storey: 'Ground', sqft: 173 },
      { storey: 'Mumty', sqft: 175 },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => !r.agrees)).toBe(true);
    expect(rows[0]!.ratio).toBeCloseTo(173 / 1717.34, 3);
  });

  it('accepts geometry that is close, because the two are not measured alike', () => {
    // Covered area is taken to the outside of the external wall; the sum of room
    // polygons is taken to the inside faces. They are not meant to be equal, so
    // the check must not fire on an import that in fact worked.
    const rows = compareWithDrawing(stated, [{ storey: 'Ground', sqft: 1560 }]);
    expect(rows[0]!.agrees).toBe(true);
  });

  it('matches 4TH to Fourth, and does not invent a comparison', () => {
    const rows = compareWithDrawing(stated, [
      { storey: 'Fourth', sqft: 1700 },
      // The schedule states no roof, so the roof must not be reported as a
      // disagreement with a figure that was never given.
      { storey: 'Top Roof', sqft: 962 },
    ]);
    expect(rows.map((r) => r.storey)).toEqual([]);

    const withFourth = compareWithDrawing(
      { ...stated, perStorey: [...stated.perStorey, { storey: '4TH', sqft: 1717.34 }] },
      [{ storey: 'Fourth', sqft: 1700 }, { storey: 'Top Roof', sqft: 962 }],
    );
    expect(withFourth.map((r) => r.storey)).toEqual(['Fourth']);
    expect(withFourth[0]!.agrees).toBe(true);
  });
});
