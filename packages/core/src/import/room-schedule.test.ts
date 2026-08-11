import { describe, expect, it } from 'vitest';
import { polygonArea } from '../geometry.js';
import type { TextItem } from './contract.js';
import { parseFeetInchesMm, parseStatedSize, readLabelledRooms, roomsFromLabels } from './room-schedule.js';

const at = (text: string, x: number, y: number, h = 20): TextItem => ({
  text,
  at: { x, y },
  heightHint: h,
});

/** A room label as a plan writes it: name, and the size on the line below. */
const label = (name: string, size: string, x: number, y: number, h = 20): TextItem[] => [
  at(name, x, y, h),
  at(size, x - 10, y - h * 1.2, h),
];

describe('reading a dimension off a drawing', () => {
  const ft = (n: number) => n * 304.8;
  const inch = (n: number) => n * 25.4;

  it('reads feet and inches', () => {
    expect(parseFeetInchesMm(`30'-2"`)).toBeCloseTo(ft(30) + inch(2), 6);
    expect(parseFeetInchesMm(`10'`)).toBeCloseTo(ft(10), 6);
    expect(parseFeetInchesMm(`9"`)).toBeCloseTo(inch(9), 6);
  });

  it('reads the vulgar fractions a CAD font emits', () => {
    // `BATH 5'-0" x 5'-5½"` — losing the half inch is a small error that
    // compounds through every quantity taken from the room.
    expect(parseFeetInchesMm(`5'-5½"`)).toBeCloseTo(ft(5) + inch(5.5), 6);
    expect(parseFeetInchesMm(`8'-4½''`)).toBeCloseTo(ft(8) + inch(4.5), 6);
    expect(parseFeetInchesMm(`4'-7 1/2"`)).toBeCloseTo(ft(4) + inch(7.5), 6);
  });

  it('accepts every quote style one sheet actually used', () => {
    // Straight quotes, doubled apostrophes and typographic primes all appeared
    // on the same drawing set.
    for (const written of [`7'-6" x 6'-3"`, `7'-6'' x 6'-3''`, `7’-6” x 6’-3”`]) {
      const size = parseStatedSize(written);
      expect(size, written).not.toBeNull();
      expect(size!.widthMm).toBeCloseTo(ft(7) + inch(6), 6);
    }
  });

  it('accepts either case of the multiplication sign, with or without spaces', () => {
    expect(parseStatedSize(`8'-4½''X18'-10''`)!.depthMm).toBeCloseTo(ft(18) + inch(10), 6);
    expect(parseStatedSize(`8'-5" x 6'-4"`)!.widthMm).toBeCloseTo(ft(8) + inch(5), 6);
  });

  it('keeps a tank’s depth out of its plan dimensions', () => {
    // `U.G.W.T 10' X 10' X 6'` is an underground water tank: 10 x 10 on plan,
    // 6 deep. Reading it as three plan dimensions, or as 10 x 6, gets both the
    // area and the excavation wrong.
    const size = parseStatedSize(`10' X 10' X 6'`)!;
    expect(size.widthMm).toBeCloseTo(ft(10), 6);
    expect(size.depthMm).toBeCloseTo(ft(10), 6);
    expect(size.heightMm).toBeCloseTo(ft(6), 6);
  });

  it('refuses what is not a dimension', () => {
    expect(parseStatedSize('HALL')).toBeNull();
    expect(parseStatedSize('+3.60')).toBeNull();
    expect(parseStatedSize(`30'-2"`)).toBeNull(); // one dimension is not a size
    expect(parseFeetInchesMm('SCALE 1:100')).toBeNull();
  });
});

describe('pairing a room name with the size written under it', () => {
  /** The basement of the measured set, as its layout sheet writes it. */
  const SHEET: TextItem[] = [
    ...label('KITCHEN', `8'-5" x 6'-4"`, 250, 1330),
    ...label('BATH', `4'-7" x 5'-5½"`, 228, 1200),
    ...label('HALL', `30'-2" x 42'-10"`, 797, 825),
    ...label('STAIRS', `8'-4½''X18'-10''`, 249, 753),
    ...label('LIFT', `7'-6" x 6'-3"`, 261, 576),
    ...label('U.G.W.T', `10' X 10' X 6'`, 568, 1088),
    ...label('SUMP', `3' X 5' X 5'`, 55, 1088),
  ];

  it('finds every dimensioned space on the sheet', () => {
    const rooms = readLabelledRooms(SHEET);
    expect(rooms.map((r) => r.name).sort()).toEqual([
      'BATH',
      'HALL',
      'KITCHEN',
      'LIFT',
      'STAIRS',
      'SUMP',
      'U.G.W.T',
    ]);
  });

  it('gets the hall right, which is most of the building', () => {
    const hall = readLabelledRooms(SHEET).find((r) => r.name === 'HALL')!;
    const sqft = (hall.size.widthMm * hall.size.depthMm) / 92_903.04;
    // 30'-2" x 42'-10" = 1292 sq ft, as the sheet says.
    expect(sqft).toBeCloseTo(1292, 0);
  });

  it('adds up to the covered area the drawing states elsewhere', () => {
    // The schedule on another sheet puts this storey at 1,717.34 sq ft. The sum
    // of the rooms it dimensions should land near that — this is the check that
    // says the whole approach works, and it is the one tracing failed at 14%.
    const total = readLabelledRooms(SHEET).reduce(
      (sum, r) => sum + (r.size.widthMm * r.size.depthMm) / 92_903.04,
      0,
    );
    expect(total).toBeGreaterThan(1717.34 * 0.9);
    expect(total).toBeLessThan(1717.34 * 1.1);
  });

  it('maps the names to uses, so a lift is a lift', () => {
    const rooms = readLabelledRooms(SHEET);
    expect(rooms.find((r) => r.name === 'LIFT')!.use).toBe('lift');
    expect(rooms.find((r) => r.name === 'STAIRS')!.use).toBe('stair');
    expect(rooms.find((r) => r.name === 'KITCHEN')!.use).toBe('kitchen');
    expect(rooms.find((r) => r.name === 'BATH')!.use).toBe('toilet');
  });

  it('ignores component notes that carry a size', () => {
    // `MS LOUVERS 2"x4"` is a ventilation louver. Without a size floor it
    // imported as a room on every storey of the real set.
    const rooms = readLabelledRooms([...SHEET, ...label('MS LOUVERS', `2"x4"`, 100, 400)]);
    expect(rooms.some((r) => /louver/i.test(r.name))).toBe(false);
  });

  it('does not attach one room’s size to the room above it', () => {
    // Two labels close together with one size between them. The size belongs to
    // the nearer name; giving it to the other would silently resize a room.
    const rooms = readLabelledRooms([
      at('KITCHEN', 100, 1000),
      at('BATH', 100, 900),
      at(`4'-7" x 5'-5½"`, 100, 880),
    ]);
    expect(rooms).toHaveLength(1);
    expect(rooms[0]!.name).toBe('BATH');
  });

  it('builds rooms of the stated size, centred on their labels', () => {
    const rooms = roomsFromLabels(SHEET, 1, 3000);
    const hall = rooms.find((r) => r.name === 'HALL')!;
    expect(polygonArea(hall.boundary) / 92_903.04).toBeCloseTo(1292, 0);
    // The size is the architect's and the position is ours; the note has to say
    // so, because a user reading 1292 sq ft is entitled to know which half of
    // that came off the drawing.
    expect(hall.note).toMatch(/read from the dimension written on the drawing/i);
    expect(hall.note).toMatch(/position is approximate/i);
    expect(hall.confidence).toBe('extracted');
  });

  it('gives a tank its own depth as its height', () => {
    const tank = roomsFromLabels(SHEET, 1, 3000).find((r) => r.name === 'U.G.W.T')!;
    expect(tank.clearHeight).toBeCloseTo(6 * 304.8, 6);
  });

  it('scales page coordinates the same way the geometry is scaled', () => {
    const rooms = roomsFromLabels([...label('HALL', `30'-2" x 42'-10"`, 100, 100, 2)], 10, 3000);
    expect(rooms).toHaveLength(1);
    // The label is at (100, 100) page units, so the room centres on (1000, 1000).
    const xs = rooms[0]!.boundary.map((p) => p.x);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(1000, 6);
  });
});
