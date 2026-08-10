/**
 * READING THE NAMES OFF A DRAWING.
 *
 * A plan tells you what its spaces are. It writes HALL in the middle of the
 * hall, KITCHEN in the kitchen, and W.C. in the lavatory. Losing that and
 * calling everything "Room" throws away the most useful thing on the sheet — a
 * user looking at a floor of twenty spaces all labelled "Room" cannot tell
 * whether the import worked at all.
 *
 * Two things went wrong before:
 *
 *  1. A label counted only when its insertion point fell strictly inside the
 *     traced face. Faces are inset by half a wall thickness, labels sit close to
 *     walls, and a face traced in fragments has the one label in only one of
 *     them. So real names on the sheet were dropped.
 *  2. Everything unlabelled became "Room" — a name that appears on no drawing
 *     and is indistinguishable from a name that was read. An unnamed space is
 *     now called an unnamed space.
 *
 * The vocabulary is the one used on Pakistani and Indian drawing sets, because
 * that is what this app is for: DRAWING ROOM is a sitting room, not a studio;
 * a MUMTY is the stair head; a DRESS is a dressing room; WUDU is the ablution
 * area beside a prayer room. A generic Western room list reads none of them.
 */

import { distancePointToSegment, pointInPolygon } from '../geometry.js';
import type { Point2, RoomUse } from '../model/architecture.js';
import type { TextItem } from './contract.js';

/**
 * Space names as drawn, longest and most specific first.
 *
 * Order is load-bearing. DRAWING ROOM must be tested before ROOM or every
 * sitting room becomes a bedroom; POWDER ROOM before ROOM; SERVANT ROOM before
 * both. STORE must come after STORE ROOM would have matched anyway, but before
 * a bare ROOM. Getting this order wrong mislabels spaces silently, which is
 * worse than leaving them unnamed.
 */
const NAME_PATTERNS: ReadonlyArray<readonly [RegExp, RoomUse]> = [
  // --- Circulation, tested first: these words appear inside other names -----
  [/\bmumty\b|\bmumtee\b/i, 'stair'],
  [/stair|staircase|\bsteps\b|\bzeena\b/i, 'stair'],
  [/\blift\b|elevator|\bshaft\b/i, 'lift'],
  [/corridor|passage|circulation|\bgallery\b/i, 'corridor'],
  [/\blobby\b|\bfoyer\b|entrance\s*hall|\bporch\b|\bportico\b/i, 'lobby'],
  [/reception|\bwaiting\b|\bentrance\b/i, 'reception'],

  // --- Wet spaces -----------------------------------------------------------
  [/powder\s*(room)?|\bw\.?\s*c\.?\b|toilet|latrine|\bbath(room)?\b|\bwash\s*room\b|\ben[- ]?suite\b|\bwudu\b/i, 'toilet'],
  [/\bwash\b|\bsink\b|\bbasin\b/i, 'toilet'],

  // --- Living -------------------------------------------------------------
  [/drawing\s*room|\bdrawing\b(?!\s*(no|sheet))/i, 'living'],
  [/living|sitting|\bfamily\b|\btv\s*lounge\b|\blounge\b/i, 'living'],
  [/dining|\bdinning\b/i, 'dining'],
  [/kitchen|\bkichen\b|\bcooking\b/i, 'kitchen'],
  [/pantry|\bcrockery\b/i, 'pantry'],
  [/servant|\bmaid\b|\bquarter\b/i, 'bedroom'],
  [/bed\s*room|\bbedroom\b|\bmaster\b|\bbed\b/i, 'bedroom'],
  [/dress(ing)?(\s*room)?|\bward\s*robe\b|\bcloset\b/i, 'store'],
  [/prayer|\bnamaz\b|\bmasjid\b|\bmosque\b/i, 'other'],

  // --- Work -----------------------------------------------------------------
  [/conferen|boardroom|\bmeeting\b/i, 'conference'],
  [/open\s*.?office|open\s*.?plan|work\s*station/i, 'open_office'],
  [/\boffice\b|\bstudy\b|\bcabin\b|\bmanager\b|\bceo\b|\bmd\b/i, 'office'],
  [/\blibrary\b/i, 'library'],
  [/\blab(oratory)?\b/i, 'laboratory'],
  [/server|\bups\b|\bit\s*room\b/i, 'server_room'],

  // --- Commercial -----------------------------------------------------------
  [/\bshop\b|\bshops\b|retail|show\s*room|\bstall\b|\bkiosk\b|\bbooth\b/i, 'retail'],
  [/\brestaurant\b|\bcafe\b|\bfood\s*court\b|\bcanteen\b/i, 'dining'],

  // --- Service --------------------------------------------------------------
  [/store\s*room|\bstore\b|\bstorage\b|\butility\b|\bjunk\b/i, 'store'],
  [/\bparking\b|\bcar\s*porch\b|\bgarage\b|\bramp\b/i, 'parking'],
  [/generator|\bgen\.?\s*set\b|\belectric(al)?\b|\bpanel\b|\bplant\b|\bmech(anical)?\b|\bhvac\b|\bboiler\b|water\s*tank|\bpump\b/i, 'plant'],
  [/\bguard\b|\bsecurity\b|\bcontrol\s*room\b/i, 'control_room'],

  // --- Big rooms, tested last because HALL is a substring of nothing but is
  //     also the word a plan uses for the main open space.
  [/\bauditorium\b|\bcinema\b|\btheatre\b/i, 'auditorium'],
  [/exhibition|\bdisplay\b/i, 'exhibition'],
  [/\bhall\b|\bhalls\b|\bmain\s*hall\b/i, 'open_office'],
];

/** Text that states a measurement rather than a name. */
const DIMENSION_LIKE = /^[\d\s.,'"×xX*\-\/]+(mm|cm|m|ft|in|sq\.?\s?ft|sqft|s\.?ft|m2|m²|')?$/i;

/**
 * Text that is a tag, a grid bubble or a note rather than a space name.
 *
 * A commercial sheet is dense with these — D1, W-04, +3.60, A, 12, SCALE 1:100 —
 * and every one of them is a plausible-looking string sitting inside a room. A
 * space called "D1" is worse than a space called nothing.
 */
function isNotAName(raw: string): boolean {
  const text = raw.trim();
  if (text.length === 0) return true;
  if (DIMENSION_LIKE.test(text)) return true;
  // Door and window tags: D1, W-04, V3, DW2.
  if (/^[DWV]{1,2}[-\s]?\d{1,3}[a-z]?$/i.test(text)) return true;
  // Grid bubbles and revision marks: a single letter or number.
  if (/^[A-Za-z0-9]$/.test(text)) return true;
  // Levels and spot heights: +3.60, -1.20, FFL 0.00.
  if (/^(ffl|sfl|fl)?\s*[+\-]?\d+(\.\d+)?\s*(m|mm|ft)?$/i.test(text)) return true;
  // Sheet furniture.
  if (/\bscale\b|\bdrawn\b|\bchecked\b|\bsheet\b|\brev(ision)?\b|\bdate\b|\bdwg\b|\bnorth\b|\bnts\b/i.test(text)) {
    return true;
  }
  if (/\bplan\b|\belevation\b|\bsection\b|\bdetail\b|\bschedule\b|\blegend\b/i.test(text)) return true;
  // A string with no letters at all cannot be a name.
  if (!/[A-Za-z]/.test(text)) return true;
  return false;
}

/** Tidy a label as drawn: collapse the space CAD puts between every character. */
function tidy(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').replace(/[.:\-]+$/, '').trim();
}

export type LabelBasis = 'inside' | 'nearby' | 'none';

export interface RoomLabel {
  readonly name: string;
  readonly use: RoomUse;
  /** How the name was arrived at, so the provenance note can say. */
  readonly basis: LabelBasis;
}

/** The use a drawn name implies, or `other` when the vocabulary does not cover it. */
export function useForName(name: string): RoomUse {
  for (const [pattern, use] of NAME_PATTERNS) {
    if (pattern.test(name)) return use;
  }
  return 'other';
}

/** Shortest distance from a point to a polygon's edge. */
function distanceToBoundary(point: Point2, boundary: readonly Point2[]): number {
  let best = Infinity;
  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i]!;
    const b = boundary[(i + 1) % boundary.length]!;
    best = Math.min(best, distancePointToSegment(point, a, b));
  }
  return best;
}

/**
 * How far outside its space a label may sit and still belong to it.
 *
 * Two metres. A label is placed by eye in the middle of a space, but the face
 * this app traces is inset by half a wall thickness and may be a fragment of the
 * real space, so the label can land just outside it. Two metres catches that
 * without reaching across a corridor into the next room — and a label that no
 * room contains is the only kind considered here anyway, so a name can never be
 * stolen from the space it was actually written in.
 */
const NEARBY_MM = 2000;

/**
 * Name every traced space from the text on the sheet.
 *
 * Done for all spaces at once rather than one at a time, because the assignment
 * is competitive: a label belongs to the space that contains it, and only a
 * label no space contains is available to a space that has none.
 */
export function labelRooms(
  boundaries: ReadonlyArray<readonly Point2[]>,
  texts: readonly TextItem[],
  scale: number,
): RoomLabel[] {
  // Candidate labels, in model millimetres.
  const candidates = texts
    .filter((t) => !isNotAName(t.text))
    .map((t) => ({
      text: tidy(t.text),
      at: { x: t.at.x * scale, y: t.at.y * scale },
      size: t.heightHint ?? 0,
    }))
    .filter((t) => t.text.length > 0);

  // Which space, if any, contains each label.
  const containedBy = candidates.map((c) => boundaries.findIndex((b) => pointInPolygon(c.at, b)));

  const results: RoomLabel[] = boundaries.map(() => ({ name: '', use: 'other', basis: 'none' }));

  // Pass one: the label written inside the space. Where a space holds several,
  // the largest text wins — a plan writes the name larger than the area note
  // under it.
  for (let i = 0; i < boundaries.length; i++) {
    let best: { text: string; size: number } | null = null;
    for (let c = 0; c < candidates.length; c++) {
      if (containedBy[c] !== i) continue;
      const candidate = candidates[c]!;
      if (best === null || candidate.size > best.size) best = candidate;
    }
    if (best) results[i] = { name: best.text, use: useForName(best.text), basis: 'inside' };
  }

  // Pass two: a space with no label of its own takes the nearest label that no
  // space contains, if one is close enough.
  const free = candidates.filter((_, c) => containedBy[c] === -1);
  for (let i = 0; i < boundaries.length; i++) {
    if (results[i]!.basis !== 'none') continue;
    const boundary = boundaries[i]!;
    let best: { text: string; distance: number } | null = null;
    for (const candidate of free) {
      const distance = distanceToBoundary(candidate.at, boundary);
      if (distance > NEARBY_MM) continue;
      if (best === null || distance < best.distance) best = { text: candidate.text, distance };
    }
    if (best) results[i] = { name: best.text, use: useForName(best.text), basis: 'nearby' };
  }

  // Pass three: say plainly that nothing was read. "Room" is a name that appears
  // on no drawing and cannot be told apart from one that was.
  for (let i = 0; i < boundaries.length; i++) {
    if (results[i]!.basis === 'none') {
      results[i] = { name: 'Unnamed space', use: 'other', basis: 'none' };
    }
  }

  return results;
}
