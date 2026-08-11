/**
 * THE ROOM SIZES THE DRAWING ALREADY WRITES DOWN.
 *
 * This module exists because of a correction. The recogniser tried to *measure*
 * rooms by tracing pairs of wall lines and closing faces — a hard problem on a
 * dense plan, and one it was losing: storeys came back at a fraction of their
 * real area. Meanwhile the sheet said, in plain text, in the middle of each room:
 *
 *     HALL          30'-2" x 42'-10"
 *     KITCHEN        8'-5" x 6'-4"
 *     BATH           4'-7" x 5'-5½"
 *     STAIRS         8'-4½" X 18'-10"
 *     LIFT           7'-6" x 6'-3"
 *     U.G.W.T       10' X 10' X 6'
 *
 * Those are the architect's own numbers. They are not an inference from geometry
 * and they cannot be defeated by hatching, a dimension chain or a poorly closed
 * corner. Summed for the basement of the measured set they come to about 1,689
 * sq ft against a stated covered area of 1,717.34 — within two per cent, where
 * tracing the same sheet reached fourteen.
 *
 * So: read the label. Measure only what carries no label.
 *
 * What this does NOT give you is position. A stated size says how big a room is,
 * not where its corners are, so each room is placed as a rectangle centred on its
 * own label — which is where an architect writes it, and close enough to walk
 * through, but not surveyed. Everything here is marked `extracted` and the
 * provenance note says the size was read rather than measured.
 */

import type { Point2, RoomUse } from '../model/architecture.js';
import type { CandidateRoom, TextItem } from './contract.js';
import { useForName } from './room-labels.js';

/** Vulgar fractions a CAD font emits, and their values. */
const FRACTIONS: Readonly<Record<string, number>> = {
  '½': 0.5,
  '¼': 0.25,
  '¾': 0.75,
  '⅐': 1 / 7,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '⅕': 0.2,
  '⅖': 0.4,
  '⅗': 0.6,
  '⅘': 0.8,
  '⅙': 1 / 6,
  '⅚': 5 / 6,
  '⅛': 0.125,
  '⅜': 0.375,
  '⅝': 0.625,
  '⅞': 0.875,
};

const MM_PER_FOOT = 304.8;
const MM_PER_INCH = 25.4;

/**
 * Normalise the many ways a drawing writes feet and inches.
 *
 * A single sheet in the measured set used `8'-5" x 6'-4"`, `8'-4½''X18'-10''`
 * and `3' X 5' X 5'` — straight quotes, doubled apostrophes, typographic primes,
 * a vulgar fraction, and both cases of the multiplication sign. All of it is the
 * same notation and none of it should need its own parser.
 */
function tidy(text: string): string {
  return text
    .replace(/[‘’ʹ′]/g, "'")
    .replace(/[“”ʺ″]/g, '"')
    .replace(/''/g, '"')
    .replace(/[×✕]/g, 'x')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Read one feet-and-inches dimension into millimetres.
 *
 * Accepts `30'-2"`, `8'-4½"`, `10'`, `9"`, `4'-7 1/2"` and the same with spaces
 * where the drawing put them. Returns null for anything it cannot read rather
 * than a partial answer: a dimension read as 30 ft when it says 30'-2" is a
 * quiet 0.5% error on every quantity derived from it.
 */
export function parseFeetInchesMm(raw: string): number | null {
  const text = tidy(raw);
  if (text === '') return null;

  // Feet, then optional inches, then an optional fraction of an inch.
  const match =
    /^(?:(\d+(?:\.\d+)?)\s*')?\s*(?:-\s*)?(?:(\d+(?:\.\d+)?)?\s*(?:([¼-¾⅐-⅞])|(\d+)\s*\/\s*(\d+))?\s*")?$/.exec(
      text,
    );
  if (!match) return null;

  const [, feet, inches, vulgar, numerator, denominator] = match;
  if (feet === undefined && inches === undefined && vulgar === undefined && numerator === undefined) {
    return null;
  }

  let mm = 0;
  if (feet !== undefined) mm += Number(feet) * MM_PER_FOOT;
  if (inches !== undefined) mm += Number(inches) * MM_PER_INCH;
  if (vulgar !== undefined) mm += (FRACTIONS[vulgar] ?? 0) * MM_PER_INCH;
  if (numerator !== undefined && denominator !== undefined && Number(denominator) !== 0) {
    mm += (Number(numerator) / Number(denominator)) * MM_PER_INCH;
  }
  return mm > 0 ? mm : null;
}

export interface StatedSize {
  readonly widthMm: number;
  readonly depthMm: number;
  /**
   * A third figure, where the drawing gives one.
   *
   * `SUMP 3' X 5' X 5'` and `U.G.W.T 10' X 10' X 6'` are tanks, and the third
   * number is their depth, not a third plan dimension. Keeping it separate is
   * what stops a 10 x 10 x 6 water tank being read as a room 10 ft by 6 ft.
   */
  readonly heightMm?: number;
}

/** Read `30'-2" x 42'-10"`, or `10' X 10' X 6'`, into millimetres. */
export function parseStatedSize(raw: string): StatedSize | null {
  const parts = tidy(raw)
    .split(/\s*x\s*/i)
    .map((p) => p.trim())
    .filter((p) => p !== '');
  if (parts.length < 2 || parts.length > 3) return null;

  const values = parts.map(parseFeetInchesMm);
  if (values.some((v) => v === null)) return null;

  return {
    widthMm: values[0]!,
    depthMm: values[1]!,
    heightMm: parts.length === 3 ? values[2]! : undefined,
  };
}

/**
 * The smallest thing that can be a room.
 *
 * A sheet dimensions plenty of things that are not rooms: `MS LOUVERS 2"x4"` is
 * a ventilation louver, and a stair tread note or a sill detail is smaller
 * still. Without this the louvers on every floor imported as rooms. Two feet on
 * a side and six square feet is under any real space — a lavatory on this
 * building is 5'-0" x 5'-5½" — and well above any component note.
 */
const MIN_ROOM_SIDE_MM = 610;
const MIN_ROOM_AREA_MM2 = 6 * 92_903.04 / 100;

/** Words that label a note or a component rather than a space. */
const NOT_A_ROOM =
  /^(up|dn|down|eq|typ|dia|nts|ms\s*louvers?|louvers?|look\s*below|open\s*to\s*(sky|below)|slope|duct|ref|sill|lintel|tread|riser|grid|level|ffl|sfl)$/i;

/** Could this string be the name of a space? */
function looksLikeName(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2 || trimmed.length > 40) return false;
  // At least two letters, and no more digits than letters — `M.H` and `U.G.W.T`
  // are names, `8'-5" x 6'-4"` and `+3.60` are not.
  if (NOT_A_ROOM.test(trimmed)) return false;
  const letters = (trimmed.match(/[A-Za-z]/g) ?? []).length;
  const digits = (trimmed.match(/\d/g) ?? []).length;
  return letters >= 2 && letters > digits;
}

export interface LabelledRoom {
  readonly name: string;
  readonly use: RoomUse;
  readonly size: StatedSize;
  /** Where the name is written, in page units. */
  readonly at: Point2;
}

/**
 * How far below its name a size may be written, in name heights.
 *
 * On the measured set the gap ran from 0.9 to 1.6 heights. Three gives room for
 * a sheet that sets its labels more loosely without reaching past the next room's
 * label — which would attach one room's size to another and be worse than
 * reading none.
 */
const SIZE_BELOW_NAME_HEIGHTS = 3;
/** How far the size may be offset sideways, in name heights. A size line is centred under its name. */
const SIZE_SIDEWAYS_HEIGHTS = 6;

/**
 * Find every space the drawing names and dimensions.
 *
 * The pairing is positional: a size belongs to the nearest name above it. Both
 * runs arrive separately from the PDF and reading order is whatever the exporter
 * emitted, so order cannot be used.
 */
export function readLabelledRooms(texts: readonly TextItem[]): LabelledRoom[] {
  const sizes = texts
    .map((t) => ({ item: t, size: parseStatedSize(t.text) }))
    .filter((s): s is { item: TextItem; size: StatedSize } => s.size !== null);
  if (sizes.length === 0) return [];

  const names = texts.filter((t) => looksLikeName(t.text));
  const claimed = new Set<TextItem>();
  const rooms: LabelledRoom[] = [];

  for (const name of names) {
    const height = Math.max(name.heightHint ?? 0, 6);
    let best: { size: StatedSize; item: TextItem; gap: number } | null = null;

    for (const candidate of sizes) {
      if (claimed.has(candidate.item)) continue;
      // Below the name: page y increases upwards, so a size line has a smaller y.
      const below = name.at.y - candidate.item.at.y;
      if (below <= 0 || below > height * SIZE_BELOW_NAME_HEIGHTS) continue;
      if (Math.abs(candidate.item.at.x - name.at.x) > height * SIZE_SIDEWAYS_HEIGHTS) continue;
      if (best === null || below < best.gap) {
        best = { size: candidate.size, item: candidate.item, gap: below };
      }
    }

    if (!best) continue;
    // A dimension too small to stand in is a component note, not a room.
    if (
      best.size.widthMm < MIN_ROOM_SIDE_MM ||
      best.size.depthMm < MIN_ROOM_SIDE_MM ||
      best.size.widthMm * best.size.depthMm < MIN_ROOM_AREA_MM2
    ) {
      continue;
    }
    claimed.add(best.item);
    rooms.push({
      name: name.text.trim(),
      use: useForName(name.text),
      size: best.size,
      at: name.at,
    });
  }

  return rooms;
}

/**
 * Turn the labelled spaces into rooms, as rectangles centred on their labels.
 *
 * The size is the architect's; the position is ours, and the note on every room
 * says so. A plan writes a room's name near its middle, so centring the stated
 * rectangle on the label puts it in the right part of the building — good enough
 * to walk through and to see the floor take shape, and explicitly not a survey.
 */
export function roomsFromLabels(
  texts: readonly TextItem[],
  toMmScale: number,
  clearHeightMm: number,
): CandidateRoom[] {
  if (!Number.isFinite(toMmScale) || toMmScale <= 0) return [];

  return readLabelledRooms(texts).map((room) => {
    const cx = room.at.x * toMmScale;
    const cy = room.at.y * toMmScale;
    const halfW = room.size.widthMm / 2;
    const halfD = room.size.depthMm / 2;
    const boundary: Point2[] = [
      { x: cx - halfW, y: cy - halfD },
      { x: cx + halfW, y: cy - halfD },
      { x: cx + halfW, y: cy + halfD },
      { x: cx - halfW, y: cy + halfD },
    ];

    const stated =
      `${(room.size.widthMm / MM_PER_FOOT).toFixed(2)} x ${(room.size.depthMm / MM_PER_FOOT).toFixed(2)} ft`;
    return {
      name: room.name,
      use: room.use,
      boundary,
      // A tank states its own depth; a room takes the floor's clear height.
      clearHeight: room.size.heightMm ?? clearHeightMm,
      confidence: 'extracted',
      note:
        `Size read from the dimension written on the drawing (${stated}), not measured from the ` +
        `line work. Placed centred on its label, so the size is the architect's and the position ` +
        `is approximate.`,
    };
  });
}
