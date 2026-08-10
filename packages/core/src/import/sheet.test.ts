import { describe, expect, it } from 'vitest';
import type { TextItem } from './contract.js';
import { chooseFloorSheets, identifySheet, recoverTitle } from './sheet.js';

/** A sheet whose title is the largest text on it, as real sheets are. */
const sheet = (title: string, rest: string[] = []): TextItem[] => [
  { text: title, at: { x: 500, y: 900 }, heightHint: 30 },
  ...rest.map((text, i) => ({ text, at: { x: 100 + i * 40, y: 400 }, heightHint: 12 })),
];

describe('sheet identification', () => {
  it('tells a floor plan from everything else in the set', () => {
    // The mistake this exists to prevent: one floor per page turned a real
    // nine-storey building into a 52-storey tower, because a set draws its
    // storeys many times over and only one family is the model.
    expect(identifySheet(1, sheet('GROUND FLOOR LAYOUT PLAN')).kind).toBe('floor_plan');
    expect(identifySheet(2, sheet('WORKING PLAN (MEZZANINE FLOOR)')).kind).toBe('floor_plan');
    expect(identifySheet(3, sheet('FRONT ELEVATION')).kind).toBe('elevation');
    expect(identifySheet(4, sheet('SECTION AT A-A')).kind).toBe('section');
    expect(identifySheet(5, sheet('SCHEDULE OF OPENINGS')).kind).toBe('schedule');
    expect(identifySheet(6, sheet('GRID & BEAM LAYOUT PLAN (FIRST FLOOR)')).kind).toBe('structural_plan');
    expect(identifySheet(7, sheet('AREA BLOCK PLAN (GROUND FLOOR )')).kind).toBe('area_plan');
    expect(identifySheet(8, sheet('(STAIR DETAIL)')).kind).toBe('detail');
  });

  it('reads the storey and its place in the stack', () => {
    const level = (title: string) => identifySheet(1, sheet(title)).level;
    expect(level('BASEMENT FLOOR LAYOUT PLAN')).toBe(-1);
    expect(level('GROUND FLOOR LAYOUT PLAN')).toBe(0);
    expect(level('MEZZANINE FLOOR LAYOUT PLAN')).toBe(1);
    expect(level('FIRST FLOOR LAYOUT PLAN')).toBe(2);
    // A mumty is the stair head giving roof access — standard in Pakistan, and
    // a real storey. It must sort above every numbered floor.
    expect(level('MUMTY FLOOR LAYOUT PLAN')!).toBeGreaterThan(level('FIRST FLOOR LAYOUT PLAN')!);
    expect(level('ROOF LAYOUT PLAN')!).toBeGreaterThan(level('MUMTY FLOOR LAYOUT PLAN')!);
  });

  it('accepts both spellings of a numbered floor', () => {
    expect(identifySheet(1, sheet('WORKING PLAN (4TH FLOOR)')).storey).toBe('Fourth');
    expect(identifySheet(1, sheet('FOURTH FLOOR LAYOUT PLAN')).storey).toBe('Fourth');
  });

  it('does not read a lower ground floor as the ground floor', () => {
    expect(identifySheet(1, sheet('LOWER GROUND FLOOR PLAN')).storey).toBe('Lower Ground');
  });

  it('recovers a title mangled by a font with no ToUnicode map', () => {
    // A CAD exporter embeds a subset font with its own glyph codes and omits the
    // map back to Unicode, so one sheet arrives as mojibake while its
    // neighbours read fine. Every character here is 29 below its real code.
    const { title, recovered } = recoverTitle("7+,5')/225/$<2873/$1");
    expect(recovered).toBe(true);
    expect(title.replace(/\s/g, '')).toBe('THIRDFLOORLAYOUTPLAN');
    expect(identifySheet(1, sheet("7+,5')/225/$<2873/$1")).storey).toBe('Third');
  });

  it('leaves a string alone when no shift makes it a title', () => {
    // A shift applied hopefully would mislabel a storey, which is exactly the
    // failure the classifier exists to prevent. Nonsense stays nonsense.
    const { title, recovered } = recoverTitle('%%$#@!~^&*');
    expect(recovered).toBe(false);
    expect(title).toBe('%%$#@!~^&*');
  });

  it('does not shift a title that already reads correctly', () => {
    const { title, recovered } = recoverTitle('GROUND FLOOR LAYOUT PLAN');
    expect(recovered).toBe(false);
    expect(title).toBe('GROUND FLOOR LAYOUT PLAN');
  });
});

describe('choosing the sheets that become storeys', () => {
  /** The shape of a real set: several families, each drawing every storey. */
  const set = [
    identifySheet(1, sheet('ARCHITECTURE DRAWINGS FOR PLOT NO. 06')),
    identifySheet(5, sheet('BASEMENT FLOOR LAYOUT PLAN')),
    identifySheet(6, sheet('GROUND FLOOR LAYOUT PLAN')),
    identifySheet(7, sheet('MEZZANINE FLOOR LAYOUT PLAN')),
    identifySheet(14, sheet('GRID & BEAM LAYOUT PLAN (BASEMENT FLOOR)')),
    identifySheet(22, sheet('WORKING PLAN (BASEMENT FLOOR)')),
    identifySheet(23, sheet('WORKING PLAN (GROUND FLOOR)')),
    identifySheet(24, sheet('WORKING PLAN (MEZZANINE FLOOR)')),
    identifySheet(31, sheet('OPENING PLAN (BASEMENT FLOOR)')),
    identifySheet(48, sheet('FRONT ELEVATION')),
    identifySheet(50, sheet('SECTION AT A-A')),
  ];

  it('picks the working plans, which are the ones carrying room names', () => {
    const chosen = chooseFloorSheets(set);
    expect(chosen.family).toBe('working');
    expect(chosen.floors.map((f) => f.pageNumber)).toEqual([22, 23, 24]);
  });

  it('takes one sheet per storey, so a storey cannot be imported twice', () => {
    // Layout, working and opening plans all draw the basement. Importing more
    // than one family stacks the same floor several times.
    const chosen = chooseFloorSheets(set);
    const levels = chosen.floors.map((f) => f.level);
    expect(new Set(levels).size).toBe(levels.length);
  });

  it('renumbers to contiguous levels around the ground floor', () => {
    // The table's levels are ordering sentinels — a mumty sits at 20 so it
    // always sorts above a sixth floor. Elevation is level x floor-to-floor, so
    // leaving 20 there would hang the mumty twenty storeys above the roof.
    const tall = [
      identifySheet(1, sheet('WORKING PLAN (BASEMENT FLOOR)')),
      identifySheet(2, sheet('WORKING PLAN (GROUND FLOOR)')),
      identifySheet(3, sheet('WORKING PLAN (MEZZANINE FLOOR)')),
      identifySheet(4, sheet('WORKING PLAN (FIRST FLOOR)')),
      identifySheet(5, sheet('WORKING PLAN (MUMTY FLOOR)')),
    ];
    const chosen = chooseFloorSheets(tall);
    expect(chosen.floors.map((f) => f.level)).toEqual([-1, 0, 1, 2, 3]);
    expect(chosen.floors.map((f) => f.storey)).toEqual([
      'Basement',
      'Ground',
      'Mezzanine',
      'First',
      'Mumty',
    ]);
  });

  it('returns nothing rather than guessing when no sheet is a floor plan', () => {
    const chosen = chooseFloorSheets([
      identifySheet(1, sheet('FRONT ELEVATION')),
      identifySheet(2, sheet('SECTION AT A-A')),
    ]);
    expect(chosen.family).toBeNull();
    expect(chosen.floors).toHaveLength(0);
  });
});
