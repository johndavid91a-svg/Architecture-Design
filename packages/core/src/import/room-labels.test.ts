import { describe, expect, it } from 'vitest';
import type { TextItem } from './contract.js';
import { labelRooms, useForName } from './room-labels.js';

const rect = (x: number, y: number, w: number, d: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + d },
  { x, y: y + d },
];

const text = (t: string, x: number, y: number, size = 200): TextItem => ({
  text: t,
  at: { x, y },
  heightHint: size,
});

describe('reading the names off a drawing', () => {
  it('takes the name written inside the space', () => {
    const labels = labelRooms([rect(0, 0, 6000, 5000)], [text('HALL', 3000, 2500)], 1);
    expect(labels[0]!.name).toBe('HALL');
    expect(labels[0]!.basis).toBe('inside');
  });

  it('does not call an unnamed space "Room"', () => {
    // The complaint this exists to answer: a floor imported as twenty spaces all
    // called "Room" is indistinguishable from an import that failed entirely.
    const labels = labelRooms([rect(0, 0, 6000, 5000)], [], 1);
    expect(labels[0]!.name).toBe('Unnamed space');
    expect(labels[0]!.basis).toBe('none');
  });

  it('takes a label that sits just outside the traced outline', () => {
    // A face is inset by half a wall thickness and may be traced as a fragment,
    // so a label placed by eye in the middle of a space can land outside it.
    const labels = labelRooms([rect(0, 0, 6000, 5000)], [text('KITCHEN', 3000, 5800)], 1);
    expect(labels[0]!.name).toBe('KITCHEN');
    expect(labels[0]!.basis).toBe('nearby');
    expect(labels[0]!.use).toBe('kitchen');
  });

  it('will not steal a name from the space it was written in', () => {
    // KITCHEN is inside the second space. The first space is 800 mm away and has
    // no label of its own — it must stay unnamed rather than take its
    // neighbour's name.
    const labels = labelRooms(
      [rect(0, 0, 6000, 5000), rect(0, 5800, 6000, 5000)],
      [text('KITCHEN', 3000, 8000)],
      1,
    );
    expect(labels[1]!.name).toBe('KITCHEN');
    expect(labels[0]!.name).toBe('Unnamed space');
  });

  it('prefers the larger text when a space holds several strings', () => {
    const labels = labelRooms(
      [rect(0, 0, 6000, 5000)],
      [text('DRAWING ROOM', 3000, 2600, 260), text('CARPET', 3000, 2000, 90)],
      1,
    );
    expect(labels[0]!.name).toBe('DRAWING ROOM');
  });

  it('ignores the tags and notes a sheet is covered in', () => {
    const junk = ['D1', 'W-04', '+3.60', 'A', '12', 'SCALE 1:100', "12'-6\"", '6000 x 4000', '—'];
    for (const j of junk) {
      const labels = labelRooms([rect(0, 0, 6000, 5000)], [text(j, 3000, 2500)], 1);
      expect(labels[0]!.name, `"${j}" should not become a room name`).toBe('Unnamed space');
    }
  });

  it('scales text positions the same way it scales the geometry', () => {
    // The label arrives in page points; the boundary is in millimetres. Applying
    // the scale to one and not the other puts every label outside every room.
    const labels = labelRooms([rect(0, 0, 6000, 5000)], [text('STORE', 300, 250)], 10);
    expect(labels[0]!.name).toBe('STORE');
    expect(labels[0]!.basis).toBe('inside');
  });
});

describe('the vocabulary a Pakistani drawing set actually uses', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['HALL', 'open_office'],
    ['MAIN HALL', 'open_office'],
    ['DRAWING ROOM', 'living'],
    ['TV LOUNGE', 'living'],
    ['KITCHEN', 'kitchen'],
    ['PANTRY', 'pantry'],
    ['BED ROOM', 'bedroom'],
    ['MASTER BEDROOM', 'bedroom'],
    ['SERVANT ROOM', 'bedroom'],
    ['DRESSING', 'store'],
    ['W.C.', 'toilet'],
    ['POWDER ROOM', 'toilet'],
    ['BATH', 'toilet'],
    ['WUDU', 'toilet'],
    ['MUMTY', 'stair'],
    ['STAIR CASE', 'stair'],
    ['LIFT', 'lift'],
    ['LOBBY', 'lobby'],
    ['PORCH', 'lobby'],
    ['SHOP', 'retail'],
    ['GENERATOR ROOM', 'plant'],
    ['WATER TANK', 'plant'],
    ['CAR PARKING', 'parking'],
    ['STORE', 'store'],
    ['OFFICE', 'office'],
    ['PRAYER ROOM', 'other'],
  ];

  for (const [name, use] of cases) {
    it(`reads ${name} as ${use}`, () => {
      expect(useForName(name)).toBe(use);
    });
  }

  it('does not read DRAWING ROOM as a drawing sheet, nor a bedroom', () => {
    // "DRAWING" appears both as a sitting room and in "DRAWING NO." on the title
    // block; "ROOM" appears in half the names on the sheet. Order in the table
    // is what keeps these apart, so it is tested rather than assumed.
    expect(useForName('DRAWING ROOM')).toBe('living');
    expect(useForName('SERVANT ROOM')).toBe('bedroom');
    expect(useForName('STORE ROOM')).toBe('store');
  });
});
