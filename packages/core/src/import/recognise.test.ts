import { describe, expect, it } from 'vitest';
import { polygonArea } from '../geometry.js';
import type { LineSegment, LineWork, TextItem } from './contract.js';
import { classifyLayer, recogniseFloor } from './recognise.js';

/**
 * Build the line work a CAD export produces for a rectangular room: two
 * parallel lines per wall, a thickness apart, drawn as separate strokes.
 */
function roomLineWork(
  widthMm: number,
  depthMm: number,
  thicknessMm: number,
  texts: TextItem[] = [],
): LineWork {
  const t = thicknessMm;
  const segments: LineSegment[] = [];
  const line = (ax: number, ay: number, bx: number, by: number) =>
    segments.push({ a: { x: ax, y: ay }, b: { x: bx, y: by }, layer: 'A-WALL' });

  // Outer rectangle, then the inner one a thickness in.
  line(0, 0, widthMm, 0);
  line(widthMm, 0, widthMm, depthMm);
  line(widthMm, depthMm, 0, depthMm);
  line(0, depthMm, 0, 0);

  line(t, t, widthMm - t, t);
  line(widthMm - t, t, widthMm - t, depthMm - t);
  line(widthMm - t, depthMm - t, t, depthMm - t);
  line(t, depthMm - t, t, t);

  return {
    segments,
    arcs: [],
    texts,
    extent: { minX: 0, minY: 0, maxX: widthMm, maxY: depthMm },
    toMmScale: 1,
    units: { unit: 'mm', source: 'file_header', confident: true, note: 'test fixture' },
    issues: [],
  };
}

describe('wall recognition', () => {
  it('pairs parallel lines into walls of the right thickness', () => {
    const result = recogniseFloor(roomLineWork(6000, 4000, 230));
    expect(result.floor).not.toBeNull();
    const walls = result.floor!.walls;
    expect(walls.length).toBeGreaterThanOrEqual(4);
    for (const wall of walls) {
      expect(wall.thickness).toBeCloseTo(230, 0);
    }
  });

  it('finds the enclosed room and insets it to the finished face', () => {
    // The fixture states its own ground truth: the inner rectangle it draws is
    // the finished face, running (230,230) to (5770,3770) -- 5.54 x 3.54 m,
    // 19.61 m². Measuring to the wall centrelines instead would report 21.75 m²,
    // and floor area is the multiplicand of every quantity in the takeoff, so
    // this is checked to the millimetre rather than to a plausible band.
    const result = recogniseFloor(roomLineWork(6000, 4000, 230));
    expect(result.floor!.rooms).toHaveLength(1);

    const area = polygonArea(result.floor!.rooms[0]!.boundary) / 1e6;
    expect(area).toBeCloseTo((5540 * 3540) / 1e6, 2);
  });

  it('does not report the building outline as a room', () => {
    // The face walk enumerates the unbounded outer face alongside the rooms.
    // Counting it doubles the floor area of a single-room building, and floor
    // area is the multiplicand of every quantity in the takeoff.
    const result = recogniseFloor(roomLineWork(6000, 4000, 230));
    expect(result.floor!.rooms).toHaveLength(1);
  });

  it('finds both rooms either side of a shared partition', () => {
    // Two rooms sharing a wall is the smallest drawing with T-junctions in it,
    // and a T-junction is where a mis-sorted half-edge sends the walk down the
    // wrong branch so that no face ever closes. Every internal partition in a
    // real building makes four of them.
    const t = 230;
    const seg = (ax: number, ay: number, bx: number, by: number): LineSegment => ({
      a: { x: ax, y: ay },
      b: { x: bx, y: by },
      layer: 'A-WALL',
    });
    // Outer 9000 x 4000 shell, with a partition at x = 4500.
    const work: LineWork = {
      segments: [
        seg(0, 0, 9000, 0),
        seg(9000, 0, 9000, 4000),
        seg(9000, 4000, 0, 4000),
        seg(0, 4000, 0, 0),
        seg(t, t, 9000 - t, t),
        seg(9000 - t, t, 9000 - t, 4000 - t),
        seg(9000 - t, 4000 - t, t, 4000 - t),
        seg(t, 4000 - t, t, t),
        seg(4500 - t / 2, t, 4500 - t / 2, 4000 - t),
        seg(4500 + t / 2, t, 4500 + t / 2, 4000 - t),
      ],
      arcs: [],
      texts: [
        { text: 'Lounge', at: { x: 2200, y: 2000 }, heightHint: 200 },
        { text: 'Bedroom', at: { x: 6800, y: 2000 }, heightHint: 200 },
      ],
      extent: { minX: 0, minY: 0, maxX: 9000, maxY: 4000 },
      toMmScale: 1,
      units: { unit: 'mm', source: 'file_header', confident: true, note: 'test fixture' },
      issues: [],
    };

    const result = recogniseFloor(work);
    expect(result.floor).not.toBeNull();
    expect(result.floor!.rooms).toHaveLength(2);

    const names = result.floor!.rooms.map((r) => r.name).sort();
    expect(names).toEqual(['Bedroom', 'Lounge']);

    // Each room runs from the inside face of the shell to the inside face of
    // the partition: 4155 x 3540 mm, 14.71 m² apiece.
    for (const room of result.floor!.rooms) {
      expect(polygonArea(room.boundary) / 1e6).toBeCloseTo((4155 * 3540) / 1e6, 2);
    }
  });

  it('never marks anything from a drawing as verified', () => {
    // A pair of parallel lines might be a wall or might be a kerb. Only IFC,
    // which declares its walls, earns 'verified'.
    const result = recogniseFloor(roomLineWork(6000, 4000, 230));
    for (const wall of result.floor!.walls) {
      expect(['extracted', 'inferred']).toContain(wall.confidence);
    }
    for (const room of result.floor!.rooms) {
      expect(['extracted', 'inferred']).toContain(room.confidence);
    }
  });

  it('names a room from text inside it and maps it to a use', () => {
    const result = recogniseFloor(
      roomLineWork(6000, 4000, 230, [{ text: 'Master Bedroom', at: { x: 3000, y: 2000 }, heightHint: 200 }]),
    );
    expect(result.floor!.rooms[0]!.name).toBe('Master Bedroom');
    expect(result.floor!.rooms[0]!.use).toBe('bedroom');
  });

  it('ignores dimension strings when naming a room, and says the space is unnamed', () => {
    // "6000 x 4000" sitting in the middle of a room is a measurement, not a name.
    // What it becomes matters: calling the space "Room" invents a name that is
    // on no drawing and cannot be told apart from one that was read, which is
    // exactly how a floor of twenty spaces all reads as "Room".
    const result = recogniseFloor(
      roomLineWork(6000, 4000, 230, [{ text: '6000 x 4000', at: { x: 3000, y: 2000 }, heightHint: 200 }]),
    );
    expect(result.floor!.rooms[0]!.name).toBe('Unnamed space');
  });

  it('refuses to measure anything without a scale', () => {
    const work = roomLineWork(6000, 4000, 230);
    const result = recogniseFloor({ ...work, toMmScale: 0 });
    expect(result.floor).toBeNull();
    expect(result.issues.some((i) => i.severity === 'blocking' && i.code === 'NO_SCALE')).toBe(true);
    expect(result.issues[0]!.remedy).toMatch(/calibrat/i);
  });

  it('says so when the line work encloses nothing', () => {
    // Two parallel lines and nothing else: a wall, but no room.
    const work: LineWork = {
      segments: [
        { a: { x: 0, y: 0 }, b: { x: 6000, y: 0 } },
        { a: { x: 0, y: 230 }, b: { x: 6000, y: 230 } },
      ],
      arcs: [],
      texts: [],
      extent: { minX: 0, minY: 0, maxX: 6000, maxY: 230 },
      toMmScale: 1,
      units: { unit: 'mm', source: 'file_header', confident: true, note: '' },
      issues: [],
    };
    const result = recogniseFloor(work);
    expect(result.floor!.rooms).toHaveLength(0);
    expect(result.issues.some((i) => i.code === 'NO_ROOMS')).toBe(true);
  });

  it('always reports that heights were assumed', () => {
    // A plan carries no heights, and wall area drives plaster and paint.
    const result = recogniseFloor(roomLineWork(6000, 4000, 230));
    expect(result.issues.some((i) => i.code === 'HEIGHTS_ASSUMED')).toBe(true);
  });

  it('flags an unconfirmed scale for review', () => {
    const work = roomLineWork(6000, 4000, 230);
    const result = recogniseFloor({
      ...work,
      units: { ...work.units, confident: false, note: 'inferred from extent' },
    });
    expect(result.issues.some((i) => i.code === 'SCALE_UNCONFIRMED')).toBe(true);
  });

  it('rejoins a wall a drawing interrupts at a door, and reads the gap back as an opening', () => {
    // Almost every CAD plan stops its wall lines either side of a door rather
    // than carrying an opening on a continuous wall. Left in pieces, the room
    // boundary has a hole in it and nothing encloses.
    const t = 230;
    const gapFrom = 2500;
    const gapTo = 3400; // a 900 mm door
    const seg = (ax: number, ay: number, bx: number, by: number): LineSegment => ({
      a: { x: ax, y: ay },
      b: { x: bx, y: by },
      layer: 'A-WALL',
    });

    const work: LineWork = {
      segments: [
        // Bottom wall, broken either side of the doorway on both its faces.
        seg(0, 0, gapFrom, 0),
        seg(gapTo, 0, 6000, 0),
        seg(t, t, gapFrom, t),
        seg(gapTo, t, 6000 - t, t),
        // The other three walls, whole.
        seg(6000, 0, 6000, 4000),
        seg(6000, 4000, 0, 4000),
        seg(0, 4000, 0, 0),
        seg(6000 - t, t, 6000 - t, 4000 - t),
        seg(6000 - t, 4000 - t, t, 4000 - t),
        seg(t, 4000 - t, t, t),
      ],
      arcs: [],
      texts: [],
      extent: { minX: 0, minY: 0, maxX: 6000, maxY: 4000 },
      toMmScale: 1,
      units: { unit: 'mm', source: 'file_header', confident: true, note: 'test fixture' },
      issues: [],
    };

    const result = recogniseFloor(work);
    expect(result.floor!.rooms).toHaveLength(1);
    // The room is the same size as if the wall had never been broken.
    expect(polygonArea(result.floor!.rooms[0]!.boundary) / 1e6).toBeCloseTo((5540 * 3540) / 1e6, 2);

    // And the bridged span comes back as an opening, so the masonry the wall
    // never had is deducted again and the quantity is unchanged.
    const openings = result.floor!.walls.flatMap((w) => w.openings);
    const door = openings.find((o) => Math.abs(o.width - (gapTo - gapFrom)) < 60);
    expect(door).toBeDefined();
    expect(door!.kind).toBe('door');
  });

  it('refuses a drawing too small to be a building rather than measuring it', () => {
    // A plan read at 1/100 of its real scale produces a complete, plausible
    // model of a building 1 m across. Nothing downstream can detect that, so it
    // has to be caught here.
    const work = roomLineWork(600, 400, 23);
    const result = recogniseFloor(work);
    expect(result.floor).toBeNull();
    const blocking = result.issues.find((i) => i.severity === 'blocking');
    expect(blocking?.code).toBe('IMPLAUSIBLE_SCALE');
    expect(blocking?.remedy).toMatch(/calibrat/i);
  });

  it('leaves furniture, planting and dimension layers out of the walls', () => {
    expect(classifyLayer('A-WALL')).toBe('wall');
    expect(classifyLayer('wall high')).toBe('wall');
    expect(classifyLayer('Muros')).toBe('wall');
    expect(classifyLayer('plants')).toBe('excluded');
    expect(classifyLayer('topography')).toBe('excluded');
    expect(classifyLayer('A-FURN')).toBe('excluded');
    expect(classifyLayer('dimensions')).toBe('excluded');
    // An unfamiliar name must cost accuracy, never whole walls.
    expect(classifyLayer('LAYER_17')).toBe('unknown');
    expect(classifyLayer(undefined)).toBe('unknown');
  });

  it('does not pair a contour line with a paving joint into a wall', () => {
    // The room is drawn on a wall layer; a long line on a planting layer runs
    // parallel to one of its faces, close enough to pair with it.
    const work = roomLineWork(6000, 4000, 230);
    const polluted: LineWork = {
      ...work,
      segments: [
        ...work.segments,
        { a: { x: -500, y: -240 }, b: { x: 6500, y: -240 }, layer: 'plants' },
        { a: { x: -500, y: -700 }, b: { x: 6500, y: -700 }, layer: 'topography' },
      ],
      extent: { minX: -500, minY: -700, maxX: 6500, maxY: 4000 },
    };

    const result = recogniseFloor(polluted);
    expect(result.floor!.rooms).toHaveLength(1);
    expect(polygonArea(result.floor!.rooms[0]!.boundary) / 1e6).toBeCloseTo((5540 * 3540) / 1e6, 2);
  });

  it('handles a degenerate drawing without throwing', () => {
    const empty: LineWork = {
      segments: [],
      arcs: [],
      texts: [],
      extent: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      toMmScale: 1,
      units: { unit: 'mm', source: 'file_header', confident: true, note: '' },
      issues: [],
    };
    const result = recogniseFloor(empty);
    expect(result.floor).toBeNull();
    expect(result.issues.some((i) => i.severity === 'blocking')).toBe(true);
  });
});
