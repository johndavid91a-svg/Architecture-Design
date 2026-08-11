/**
 * WHICH SHEET IS WHICH.
 *
 * A drawing set is not a stack of floors. A real 56-sheet set held nine floor
 * plans; the rest were a title sheet, an index, a 3D view, a site plan, eight
 * structural grids, eight opening plans, eight area blocks, two elevations, four
 * sections and details. Importing one floor per page turned a nine-storey
 * building into a 52-storey tower — a complete, confident, wrong answer, which
 * is worse than an error.
 *
 * So sheets are classified before anything is measured: what family a sheet
 * belongs to, and which storey it draws. The storey is what fixes `level`;
 * page order never does.
 *
 * Everything here works from the sheet title, which is reliably the largest text
 * on the sheet.
 */

import type { TextItem } from './contract.js';

/** What a sheet draws. Only `floor_plan` can become a storey. */
export type SheetKind =
  | 'floor_plan'
  | 'structural_plan'
  | 'area_plan'
  | 'elevation'
  | 'section'
  | 'detail'
  | 'schedule'
  | 'site_plan'
  | 'front_matter'
  | 'unknown';

/**
 * Which family of plans a sheet belongs to.
 *
 * A set draws the same storeys several times over. Importing two families gives
 * two copies of every floor, so exactly one is chosen — see `preferredFamily`.
 */
export type PlanFamily = 'working' | 'layout' | 'opening' | 'other';

export interface SheetIdentity {
  readonly pageNumber: number;
  readonly kind: SheetKind;
  readonly family: PlanFamily;
  /** Storey name as drawn, e.g. `MEZZANINE`. Absent when not a floor plan. */
  readonly storey?: string;
  /** Storey ordering: basement -1, ground 0, mezzanine 1, first 2 … */
  readonly level?: number;
  /** The title as read, after any font recovery. */
  readonly title: string;
  /** True when the title had to be recovered from a broken font encoding. */
  readonly titleRecovered: boolean;
}

/**
 * Storey names, in the order they stack.
 *
 * `MUMTY` is the small enclosure at the head of the stair giving roof access —
 * standard in Pakistan and India, and a real storey rather than part of the
 * roof. `MEZZANINE` usually covers only part of the floor below it, so its area
 * is legitimately smaller and a checker expecting full plates must not read that
 * as an error.
 *
 * Longer names are matched first so `FOURTH` cannot be shadowed by `FOUR`, and
 * `LOWER GROUND` cannot be taken for `GROUND`.
 */
const STOREYS: ReadonlyArray<{ readonly match: RegExp; readonly name: string; readonly level: number }> = [
  { match: /\bLOWER\s*GROUND\b/i, name: 'Lower Ground', level: -1 },
  { match: /\bBASEMENT\b/i, name: 'Basement', level: -1 },
  { match: /\bGROUND\b/i, name: 'Ground', level: 0 },
  { match: /\bMEZZANINE\b/i, name: 'Mezzanine', level: 1 },
  { match: /\bFIRST\b|\b1ST\b/i, name: 'First', level: 2 },
  { match: /\bSECOND\b|\b2ND\b/i, name: 'Second', level: 3 },
  { match: /\bTHIRD\b|\b3RD\b/i, name: 'Third', level: 4 },
  { match: /\bFOURTH\b|\b4TH\b/i, name: 'Fourth', level: 5 },
  { match: /\bFIFTH\b|\b5TH\b/i, name: 'Fifth', level: 6 },
  { match: /\bSIXTH\b|\b6TH\b/i, name: 'Sixth', level: 7 },
  { match: /\bMUMTY\b/i, name: 'Mumty', level: 20 },
  { match: /\bTOP\s*ROOF\b/i, name: 'Top Roof', level: 22 },
  { match: /\bROOF\b/i, name: 'Roof', level: 21 },
];

/** Words that mark a title as belonging to a real architectural drawing. */
const VOCABULARY = [
  'FLOOR',
  'PLAN',
  'LAYOUT',
  'SECTION',
  'ELEVATION',
  'BASEMENT',
  'GROUND',
  'MEZZANINE',
  'MUMTY',
  'ROOF',
  'WORKING',
  'OPENING',
  'SCHEDULE',
  'DETAIL',
  'GRID',
  'BEAM',
];

/**
 * Recover a title mangled by a subset font with no `ToUnicode` map.
 *
 * A CAD exporter often embeds a font whose glyph codes are its own, and omits
 * the map back to Unicode. pdf.js then hands over the raw codes, so one sheet
 * title arrives as mojibake while its neighbours read perfectly:
 *
 *   "7+,5')/225/$<2873/$1"  ->  "THIRD FLOOR LAYOUT PLAN"
 *
 * The offset is constant, and in the file measured it was 29. It is **searched
 * for rather than hardcoded**, and a shift is accepted only when it produces
 * recognisable architectural vocabulary. A shift applied hopefully would
 * silently mislabel a storey, which is the failure this whole module exists to
 * prevent — so a string that yields nothing recognisable is left exactly as it
 * came.
 */
export function recoverTitle(raw: string): { title: string; recovered: boolean } {
  if (looksLikeWords(raw)) return { title: raw, recovered: false };

  for (let shift = 1; shift <= 64; shift++) {
    // Only printable ASCII is shifted; spaces and punctuation frequently do not
    // survive the encoding and must not be dragged out of range.
    const candidate = shiftText(raw, shift);
    if (looksLikeWords(candidate)) return { title: candidate, recovered: true };
  }

  return { title: raw, recovered: false };
}

/** Does this read as an architectural title rather than as noise? */
function looksLikeWords(text: string): boolean {
  const letters = text.toUpperCase().replace(/[^A-Z]/g, '');
  if (letters.length < 4) return false;
  return VOCABULARY.some((word) => letters.includes(word));
}

/**
 * Recover every string on a sheet whose font lost its `ToUnicode` map.
 *
 * `recoverTitle` fixes one string at a time, which was enough to name the sheet.
 * It is not enough to read it: on the set measured here the third-floor layout
 * plan is entirely in a broken subset font, so its title recovered while every
 * room name and every dimension on it stayed as mojibake — and that sheet alone
 * contributed no rooms at all while its neighbours contributed seven each.
 *
 * The shift is a property of the page, not of the string, so it is found once
 * across all the text and applied to all of it. A shift is accepted only when it
 * makes substantially more of the page readable than leaving it alone, so a sheet
 * that was fine to begin with is never touched.
 */
export function recoverPageTexts(texts: readonly TextItem[]): TextItem[] {
  // Only SOME of the page is broken. On the sheet that exposed this the title
  // block reads perfectly and every string inside the drawing is mojibake, so a
  // single shift applied to everything fixes the rooms and destroys the title
  // block. The shift is found from the page as a whole and then applied only to
  // the strings that need it.
  const broken = texts.filter((t) => !readsAsDrawingText(t.text));
  if (broken.length === 0) return [...texts];

  let bestShift = 0;
  let bestScore = 0;
  for (let shift = 1; shift <= 64; shift++) {
    const score = broken.filter((t) => readsAsDrawingText(shiftText(t.text, shift))).length;
    if (score > bestScore) {
      bestScore = score;
      bestShift = shift;
    }
  }

  // Three strings recovered, and a real share of what was broken. One or two
  // could be coincidence on a page of hundreds of runs, and a shift applied
  // hopefully turns correct text into nonsense — which is the failure this whole
  // area exists to prevent.
  if (bestShift === 0 || bestScore < 3) return [...texts];

  return texts.map((t) => {
    if (readsAsDrawingText(t.text)) return t;
    const shifted = shiftText(t.text, bestShift);
    return readsAsDrawingText(shifted) ? { ...t, text: shifted } : t;
  });
}

/**
 * Words that appear on an architectural sheet somewhere — not just in its title.
 *
 * `looksLikeWords` is deliberately narrow because it decides whether a *sheet
 * title* has been recovered, and a wrong shift there mislabels a storey. Reading
 * the body of a sheet needs a wider net: the strings that matter most are room
 * names and dimensions, and neither is in the title vocabulary.
 */
const DRAWING_WORDS = [
  ...VOCABULARY,
  'HALL', 'KITCHEN', 'BATH', 'TOILET', 'LIFT', 'STAIR', 'STAIRS', 'BALCONY', 'LOBBY',
  'STORE', 'ROOM', 'LOUVER', 'DUCT', 'LANDING', 'TERRACE', 'PORCH', 'SUMP', 'TANK',
  'WATER', 'MACHINE', 'PARKING', 'SHOP', 'OFFICE', 'LOUNGE', 'DINING', 'BEDROOM',
  'DRAWING', 'PLOT', 'SCALE', 'DATE', 'PROJECT', 'TITLE', 'OWNER', 'DESIGN', 'BELOW',
  'EMG', 'UPVC', 'PIPE', 'WIDE', 'COVERED', 'AREA', 'TOTAL', 'BLOCK', 'SECTOR',
];

/**
 * Does this string read as something written on a drawing?
 *
 * Two things count, and a dimension counts double in practice because it is the
 * hardest pattern to produce by accident: `30'-2" x 42'-10"` under a wrong shift
 * is essentially never a well-formed feet-and-inches string.
 */
function readsAsDrawingText(text: string): boolean {
  if (/\d+\s*'\s*(?:-\s*\d+)?\s*(?:"|'')/.test(text)) return true;
  const letters = text.toUpperCase().replace(/[^A-Z]/g, '');
  if (letters.length < 3) return false;
  return DRAWING_WORDS.some((word) => letters.includes(word));
}

/**
 * Shift a string's character codes, leaving anything outside the range alone.
 *
 * The range starts at 1, not at the printable ASCII floor of 33, because a
 * subset font numbers its glyphs from zero: in the font on the sheet that
 * exposed this, space is 0x03 and the digits run 0x13 to 0x1C. Stopping at 33
 * recovered every room NAME on that sheet and not one of its dimensions —
 * `30'-2" x 42'-10"` stayed as control codes — so the storey came back with the
 * right labels and no sizes at all, which is the least useful of the three
 * possible outcomes.
 *
 * Widening it is safe because a shift is only ever applied to a string that does
 * not already read, and only when the result does.
 */
function shiftText(text: string, shift: number): string {
  return [...text]
    .map((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 1 && code <= 126 ? String.fromCharCode(code + shift) : ch;
    })
    .join('');
}

/**
 * Identify one sheet from its text.
 *
 * The title is the largest text on the sheet. Where several strings share the
 * largest size — a title split across two lines, as in
 * `GRID & BEAM LAYOUT PLAN` + `(BASEMENT FLOOR)` — they are joined, because the
 * storey often lives in the second half.
 */
export function identifySheet(pageNumber: number, texts: readonly TextItem[]): SheetIdentity {
  if (texts.length === 0) {
    return { pageNumber, kind: 'unknown', family: 'other', title: '', titleRecovered: false };
  }

  const ranked = [...texts].sort((a, b) => (b.heightHint ?? 0) - (a.heightHint ?? 0));
  const tallest = ranked[0]!.heightHint ?? 0;
  const headline = ranked
    .filter((t) => (t.heightHint ?? 0) >= tallest * 0.9)
    .slice(0, 3)
    .map((t) => t.text.trim())
    .filter((t) => t.length > 0);

  const recovered = headline.map(recoverTitle);
  const title = recovered.map((r) => r.title).join(' ').replace(/\s+/g, ' ').trim();
  const titleRecovered = recovered.some((r) => r.recovered);
  const upper = title.toUpperCase();

  // Spaces frequently do not survive a broken font encoding, so a recovered
  // title arrives as `THIRDFLOORLAYOUTPLAN`. Word boundaries cannot match that,
  // so a letters-only pass runs as a fallback. The list is ordered longest-first
  // — `LOWER GROUND` before `GROUND` — which is what keeps the fallback from
  // reading a lower ground floor as the ground floor.
  const letters = upper.replace(/[^A-Z0-9]/g, '');
  const storey =
    STOREYS.find((s) => s.match.test(upper)) ??
    STOREYS.find((s) => new RegExp(s.match.source.replace(/\\b/g, ''), 'i').test(letters));

  /**
   * Test a pattern against the title, tolerating a lost-space encoding.
   *
   * A recovered title has no spaces, so every word-boundary pattern fails on it.
   * Each pattern is therefore tried twice: once on the title as read, and once
   * with boundaries and whitespace stripped, against the letters-only form.
   */
  const has = (pattern: RegExp): boolean =>
    pattern.test(upper) ||
    new RegExp(pattern.source.replace(/\\b/g, '').replace(/\\s\*/g, ''), 'i').test(letters);

  // Order matters: the more specific families are tested before the generic
  // "…PLAN", or a grid-and-beam sheet would be read as a floor plan.
  const kind: SheetKind = has(/SCHEDULE/)
    ? 'schedule'
    : has(/\bELEVATION\b/)
      ? 'elevation'
      : has(/\bSECTION\b/)
        ? 'section'
        : has(/\bDETAIL\b/)
          ? 'detail'
          : has(/GRID|BEAM|COLUMN|FOOTING|SLAB\s*REINF/)
            ? 'structural_plan'
            : has(/AREA\s*BLOCK|COVERED\s*AREA/)
              ? 'area_plan'
              : has(/SITE\s*PLAN|LOCATION\s*PLAN|BLOCK\s*PLAN/)
                ? 'site_plan'
                : has(/\bPLAN\b/) && storey
                  ? 'floor_plan'
                  : has(/DRAWINGS?\s*FOR|INDEX|VISUALIZATION|VISUALISATION|3D/)
                    ? 'front_matter'
                    : 'unknown';

  const family: PlanFamily = has(/\bWORKING\b/)
    ? 'working'
    : has(/\bOPENING\b/)
      ? 'opening'
      : has(/\bLAYOUT\b/)
        ? 'layout'
        : 'other';

  return {
    pageNumber,
    kind,
    family,
    storey: kind === 'floor_plan' ? storey?.name : undefined,
    level: kind === 'floor_plan' ? storey?.level : undefined,
    title,
    titleRecovered,
  };
}

/**
 * Choose which family of plans becomes the model.
 *
 * A set draws the same storeys several times. Working plans are preferred
 * because they carry room names — `HALL`, `LOBBY`, `STAIRS`, `LIFT`, `BALCONY` —
 * and a plan whose rooms are named is worth far more than one whose rooms are
 * `Room 1 … Room 20`. Layout plans come next, then opening plans.
 *
 * Exactly one family is used. Importing two gives two copies of every storey.
 */
export function preferredFamily(
  sheets: readonly SheetIdentity[],
  /**
   * How much a sheet is worth, usually the number of rooms it dimensions.
   *
   * Without it the choice is a fixed preference for working plans, which was a
   * guess that turned out to be wrong for this set: the layout plans dimension
   * six or seven rooms a sheet and the working plans dimension one. Asking the
   * sheets rather than assuming is both more accurate and self-correcting for a
   * set drawn to another office's conventions.
   */
  score?: (pageNumber: number) => number,
): PlanFamily | null {
  const plans = sheets.filter((s) => s.kind === 'floor_plan');
  const order = ['working', 'layout', 'opening', 'other'] as const;
  const count = (f: PlanFamily) => plans.filter((s) => s.family === f).length;

  if (score) {
    let best: { family: PlanFamily; total: number } | null = null;
    for (const family of order) {
      if (count(family) === 0) continue;
      const total = plans
        .filter((s) => s.family === family)
        .reduce((sum, s) => sum + score(s.pageNumber), 0);
      if (best === null || total > best.total) best = { family, total };
    }
    // A tie, or nothing dimensioned anywhere, falls back to the fixed order.
    if (best && best.total > 0) return best.family;
  }

  for (const family of order) {
    if (count(family) > 0) return family;
  }
  return null;
}

export interface ChosenSheets {
  readonly family: PlanFamily | null;
  /** One sheet per storey, in stacking order. */
  readonly floors: readonly SheetIdentity[];
  /** Every sheet, for reporting what was left out and why. */
  readonly all: readonly SheetIdentity[];
}

/**
 * Pick the sheets that become storeys.
 *
 * One per storey, lowest first. Where a family draws the same storey twice — a
 * revision, or a plan split over two sheets — the first is taken and the
 * duplicate reported rather than silently stacked as an extra floor.
 */
export function chooseFloorSheets(
  sheets: readonly SheetIdentity[],
  score?: (pageNumber: number) => number,
): ChosenSheets {
  const family = preferredFamily(sheets, score);
  if (family === null) return { family: null, floors: [], all: sheets };

  const byLevel = new Map<number, SheetIdentity>();
  for (const sheet of sheets) {
    if (sheet.kind !== 'floor_plan' || sheet.family !== family || sheet.level === undefined) continue;
    if (!byLevel.has(sheet.level)) byLevel.set(sheet.level, sheet);
  }

  const ordered = [...byLevel.values()].sort((a, b) => (a.level ?? 0) - (b.level ?? 0));

  // Renumber to contiguous levels around the ground floor.
  //
  // The table's levels are *ordering* sentinels — Mumty sits at 20 so that it
  // always sorts above a sixth floor without having to know how many floors a
  // building has. Elevation is `level x floorToFloor`, so leaving 20 there would
  // hang the mumty twenty storeys above the roof. What matters downstream is the
  // sequence, and that the basement is the one below ground.
  const groundIndex = ordered.findIndex((s) => s.level === 0);
  const floors = ordered.map((sheet, index) => ({
    ...sheet,
    level: groundIndex >= 0 ? index - groundIndex : index,
  }));

  return { family, floors, all: sheets };
}
