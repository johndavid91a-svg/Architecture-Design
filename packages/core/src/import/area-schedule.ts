/**
 * THE DRAWING'S OWN ARITHMETIC, USED TO CHECK OURS.
 *
 * A real architectural set states its covered area. This one carries a sheet
 * headed SCHEDULE OF COV. AREA:
 *
 *     PLOT SIZE & AREA           =  40'x45' (1800 sft)
 *     BASEMENT FLOOR COV. AREA   =  1717.34 Sft
 *     GROUND FLOOR COV. AREA     =  1717.34 Sft
 *     ...
 *     MUMTY FLOOR COV. AREA      =   458.56 Sft
 *     TOTAL COV. AREA            = 12845.94 Sft
 *
 * Those numbers are the architect's, not ours, and they are the one piece of
 * ground truth a PDF import can be measured against. It matters because the
 * recogniser can be confidently, silently wrong: on this set it read the same
 * storeys as 21 to 976 sq ft against a stated 1717.34, and nothing in the
 * pipeline could tell. A model that is wrong by a factor of eighty and says so
 * is useful; the same model presenting itself as measured is not.
 *
 * So this module reads the schedule, and `compareWithDrawing` puts the two
 * columns side by side. Nothing here alters a dimension — it only reports.
 */

import type { TextItem } from './contract.js';

export interface StatedArea {
  /** Storey as written on the schedule, e.g. `MEZZANINE`. */
  readonly storey: string;
  readonly sqft: number;
}

export interface DrawingAreas {
  readonly perStorey: readonly StatedArea[];
  /** `TOTAL COV. AREA`, where the sheet gives one. */
  readonly totalSqft: number | null;
  /** Plot area from `PLOT SIZE & AREA`. */
  readonly plotSqft: number | null;
  /** Plot dimensions as written, e.g. `40'x45'`. */
  readonly plotSize: string | null;
}

/** A number followed by a square-foot unit, in any of the spellings a set uses. */
const SQFT = /([\d,]+(?:\.\d+)?)\s*(?:sft|sq\.?\s*ft|sqft|s\.?\s*ft)\b/i;

/** `40'x45' (1800 sft)` — dimensions first, area in brackets. */
const PLOT = /(\d+(?:\.\d+)?\s*['’]?\s*[x×]\s*\d+(?:\.\d+)?\s*['’]?)\s*\(?\s*([\d,]+(?:\.\d+)?)\s*(?:sft|sq\.?\s*ft)/i;

const number = (text: string): number | null => {
  const value = Number(text.replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
};

/**
 * The value written against a label.
 *
 * A schedule is a table: the label is on the left, an `=` in the middle and the
 * figure on the right, and all three arrive as separate text runs. They are
 * matched by *position* rather than by reading order, because reading order in a
 * PDF is the order the exporter happened to emit and a two-column schedule
 * interleaves. Same line, to the right, nearest wins.
 */
function valueBeside(label: TextItem, texts: readonly TextItem[], pattern: RegExp): string | null {
  const tolerance = Math.max(label.heightHint ?? 0, 6) * 0.9;
  let best: { text: string; distance: number } | null = null;
  for (const candidate of texts) {
    if (candidate === label) continue;
    if (Math.abs(candidate.at.y - label.at.y) > tolerance) continue;
    if (candidate.at.x <= label.at.x) continue;
    if (!pattern.test(candidate.text)) continue;
    const distance = candidate.at.x - label.at.x;
    if (best === null || distance < best.distance) best = { text: candidate.text, distance };
  }
  return best?.text ?? null;
}

/**
 * Read a covered-area schedule off one sheet.
 *
 * Returns null when the sheet carries no schedule, which is every sheet but one
 * — the caller is expected to try them all and take the first that answers.
 */
export function readAreaSchedule(texts: readonly TextItem[]): DrawingAreas | null {
  const perStorey: StatedArea[] = [];
  let totalSqft: number | null = null;
  let plotSqft: number | null = null;
  let plotSize: string | null = null;

  for (const item of texts) {
    const text = item.text.trim();

    // `PLOT SIZE & AREA = 40'x45' (1800 sft)` — the figure may be in the same
    // run as the label or in the one beside it.
    if (/plot\s*(size|area)/i.test(text)) {
      const beside = valueBeside(item, texts, PLOT) ?? valueBeside(item, texts, SQFT) ?? text;
      const plot = PLOT.exec(beside);
      if (plot) {
        plotSize = plot[1]!.replace(/\s+/g, '');
        plotSqft = number(plot[2]!);
      } else {
        const only = SQFT.exec(beside);
        if (only) plotSqft = number(only[1]!);
      }
      continue;
    }

    const covered = /^(.*?)\s*(?:floor\s*)?cov(?:ered)?\.?\s*area\s*$/i.exec(text);
    if (!covered) continue;

    const who = covered[1]!.trim().toUpperCase();
    const beside = valueBeside(item, texts, SQFT);
    if (!beside) continue;
    const found = SQFT.exec(beside);
    if (!found) continue;
    const sqft = number(found[1]!);
    if (sqft === null || sqft <= 0) continue;

    if (/^total$/i.test(who) || who === '') {
      if (/^total$/i.test(who)) totalSqft = sqft;
      continue;
    }
    perStorey.push({ storey: who, sqft });
  }

  if (perStorey.length === 0 && totalSqft === null && plotSqft === null) return null;
  return { perStorey, totalSqft, plotSqft, plotSize };
}

/** Merge the schedules found across a set; later sheets fill gaps, never overwrite. */
export function mergeAreaSchedules(found: ReadonlyArray<DrawingAreas | null>): DrawingAreas | null {
  const real = found.filter((f): f is DrawingAreas => f !== null);
  if (real.length === 0) return null;

  const perStorey: StatedArea[] = [];
  const seen = new Set<string>();
  for (const one of real) {
    for (const area of one.perStorey) {
      if (seen.has(area.storey)) continue;
      seen.add(area.storey);
      perStorey.push(area);
    }
  }
  return {
    perStorey,
    totalSqft: real.find((r) => r.totalSqft !== null)?.totalSqft ?? null,
    plotSqft: real.find((r) => r.plotSqft !== null)?.plotSqft ?? null,
    plotSize: real.find((r) => r.plotSize !== null)?.plotSize ?? null,
  };
}

export interface AreaComparison {
  readonly storey: string;
  readonly statedSqft: number;
  readonly recognisedSqft: number;
  /** Recognised as a fraction of stated. 1 is agreement, 0.06 is not. */
  readonly ratio: number;
  readonly agrees: boolean;
}

/**
 * How far the recognised geometry may be from the drawing's own figure.
 *
 * A traced plan legitimately differs from a stated covered area: covered area is
 * measured to the outside of the external wall and includes the wall thickness,
 * a stair well and any shaft, while the sum of recognised room polygons is
 * measured to the inside faces and omits whatever failed to close. Fifteen per
 * cent of difference is ordinary. Being out by half is not a measurement at all.
 */
const AGREEMENT_BAND = 0.35;

/** Match a storey name from the schedule to one from a sheet title. */
function sameStorey(a: string, b: string): boolean {
  const tidy = (s: string) =>
    s
      .toUpperCase()
      .replace(/\bFLOOR\b|\bCOV\.?\b|\bAREA\b|[^A-Z0-9]/g, '')
      .replace(/^4TH$/, 'FOURTH')
      .replace(/^3RD$/, 'THIRD')
      .replace(/^2ND$/, 'SECOND')
      .replace(/^1ST$/, 'FIRST');
  return tidy(a) === tidy(b);
}

/**
 * Put the recognised areas beside the drawing's own, storey by storey.
 *
 * Only storeys the schedule names are compared. A storey the schedule omits —
 * a roof, usually — is left out rather than being reported as a disagreement
 * with a figure that was never stated.
 */
export function compareWithDrawing(
  stated: DrawingAreas,
  recognised: ReadonlyArray<{ storey: string; sqft: number }>,
): AreaComparison[] {
  const rows: AreaComparison[] = [];
  for (const one of recognised) {
    const match = stated.perStorey.find((s) => sameStorey(s.storey, one.storey));
    if (!match) continue;
    const ratio = match.sqft > 0 ? one.sqft / match.sqft : 0;
    rows.push({
      storey: one.storey,
      statedSqft: match.sqft,
      recognisedSqft: one.sqft,
      ratio,
      agrees: Math.abs(1 - ratio) <= AGREEMENT_BAND,
    });
  }
  return rows;
}
