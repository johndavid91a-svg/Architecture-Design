/**
 * THE SCALE A PDF STATES ABOUT ITSELF.
 *
 * A CAD-plotted PDF usually records its own plotting scale. Each page may carry
 * a `/VP` array of viewport dictionaries, and each of those a `/Measure` giving
 * how many real-world units one page point represents over a named rectangle:
 *
 *   /VP [ << /Type /Viewport /BBox [x0 y0 x1 y1]
 *            /Measure << /Type /Measure /Subtype /RL
 *                        /X [ << /Type /NumberFormat /C 0.0295 /U () >> ] >> >> ]
 *
 * This is the number the plotting tool wrote down, not an inference from how the
 * drawing looks, which makes it the best evidence a file can offer. It also
 * survives the thing that destroys a "1:100" note: re-plotting to a different
 * sheet size rescales the geometry and the `/C` factor together, so they stay
 * consistent, while the printed note silently becomes a lie.
 *
 * Measured across a real 56-sheet drawing set, the recorded scales ran from
 * 1:19.98 to 1:117.52 and **not one was a standard architectural ratio** — the
 * sheets were plotted fit-to-page. Any heuristic that snapped to 1:50 or 1:100
 * would have produced a building wrong by 5-11%, and one that assumed a single
 * scale for the document would have been wrong by up to 70%. That is why this
 * reads the file rather than guessing, and why it reports per viewport.
 *
 * pdf.js does not expose `/VP`, so this parses the page dictionary out of the
 * original bytes. `PDFPageProxy.ref` gives the object number, which is enough to
 * find it.
 */

import type { ImportIssue } from './contract.js';

export interface MeasuredViewport {
  /** Rectangle in page points over which this scale applies. */
  readonly bbox: { x0: number; y0: number; x1: number; y1: number };
  /** Real-world units per page point, straight from `/C`. */
  readonly unitsPerPoint: number;
  /** The `/U` unit string. Frequently blank, which is why it is not trusted. */
  readonly declaredUnit: string;
  /** Area of the bbox in square points, for choosing the dominant viewport. */
  readonly area: number;
}

export interface PageMeasure {
  readonly pageNumber: number;
  readonly viewports: readonly MeasuredViewport[];
}

/** 1 inch = 25.4 mm. The `/C` factor is in inches per point on every file seen. */
const MM_PER_INCH = 25.4;

/**
 * How close two scales must be to count as the same.
 *
 * Viewports placed by the same plot share a factor to many significant figures,
 * so anything looser than a fraction of a percent would merge genuinely
 * different scales — a 1:50 detail beside a 1:100 plan differ by 100%, but a
 * 1:33.59 and a 1:33.62 plan on the same sheet are the same plot.
 */
const SAME_SCALE_TOLERANCE = 0.005; // 0.5%

/** Read one PDF object's dictionary text by object number. */
function findObject(bytes: string, objectNumber: number): string | null {
  // Objects are `N G obj ... endobj`. Generation is almost always 0, but match
  // any digit rather than assuming.
  const pattern = new RegExp(`(^|[^0-9])${objectNumber}\\s+\\d+\\s+obj\\b`, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(bytes)) !== null) {
    const start = match.index + match[0].length;
    const end = bytes.indexOf('endobj', start);
    if (end > start) return bytes.slice(start, end);
  }
  return null;
}

/** Pull the balanced `<< … >>` dictionaries out of a `/VP [ … ]` array. */
function splitDictionaries(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] === '<' && text[i + 1] === '<') {
      if (depth === 0) start = i;
      depth++;
      i++;
    } else if (text[i] === '>' && text[i + 1] === '>') {
      depth--;
      i++;
      if (depth === 0 && start >= 0) {
        out.push(text.slice(start, i + 1));
        start = -1;
      }
      if (depth < 0) return out;
    }
  }
  return out;
}

/** The `/VP [ … ]` array of a page dictionary, as text. */
function viewportArray(dictionary: string): string | null {
  const at = dictionary.search(/\/VP\s*\[/);
  if (at < 0) return null;
  const open = dictionary.indexOf('[', at);
  let depth = 0;
  for (let i = open; i < dictionary.length; i++) {
    if (dictionary[i] === '[') depth++;
    else if (dictionary[i] === ']') {
      depth--;
      if (depth === 0) return dictionary.slice(open + 1, i);
    }
  }
  return null;
}

/**
 * Read the measured viewports of one page.
 *
 * `pageObjectNumber` comes from `PDFPageProxy.ref.num`. Returns an empty list
 * for a page that records nothing, which is the normal case for a PDF that was
 * printed rather than plotted.
 */
export function readPageMeasures(
  bytes: string,
  pageNumber: number,
  pageObjectNumber: number,
): PageMeasure {
  const dictionary = findObject(bytes, pageObjectNumber);
  if (!dictionary) return { pageNumber, viewports: [] };

  const array = viewportArray(dictionary);
  if (!array) return { pageNumber, viewports: [] };

  const viewports: MeasuredViewport[] = [];
  for (const entry of splitDictionaries(array)) {
    const box = /\/BBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/.exec(entry);
    if (!box) continue;

    // The factor must come from the `/X` number format, not from the first
    // `/C` in the dictionary. A real `/Measure` looks like
    //   /Measure<< /A[<</C 1>>] /D[<</C 1>>] /R( ) /X[<</C 0.47105>>] >>
    // where `/A` is the area conversion and `/D` the depth: both are 1 and both
    // come first. Taking the first `/C` therefore reads 1 on every viewport of
    // every page — a scale of one point per unit — which is not a parse failure
    // but a plausible-looking wrong answer, the worst kind.
    const xArray = /\/X\s*\[(.*?)\]/s.exec(entry);
    if (!xArray) continue;
    const factor = /\/C\s+(-?[\d.eE+]+)/.exec(xArray[1]!);
    if (!factor) continue;

    const unitsPerPoint = Number(factor[1]);
    if (!Number.isFinite(unitsPerPoint) || unitsPerPoint <= 0) continue;

    const x0 = Math.min(Number(box[1]), Number(box[3]));
    const x1 = Math.max(Number(box[1]), Number(box[3]));
    const y0 = Math.min(Number(box[2]), Number(box[4]));
    const y1 = Math.max(Number(box[2]), Number(box[4]));
    const unit = /\/U\s*\(([^)]*)\)/.exec(entry);

    viewports.push({
      bbox: { x0, y0, x1, y1 },
      unitsPerPoint,
      declaredUnit: unit ? unit[1]! : '',
      area: Math.max(0, x1 - x0) * Math.max(0, y1 - y0),
    });
  }

  return { pageNumber, viewports };
}

export interface MeasureVerdict {
  /** Millimetres of building per page point, or null when unusable. */
  readonly mmPerPoint: number | null;
  /** The viewport chosen, for reporting. */
  readonly chosen?: MeasuredViewport;
  readonly issues: readonly ImportIssue[];
  /** How many genuinely different scales this page carries. */
  readonly distinctScales: number;
}

/**
 * Decide the scale for one page from its measured viewports.
 *
 * Two traps, both found in real files and both silent:
 *
 * 1. **The sheet-wide viewport.** Every page of the measured set carried an
 *    identical viewport covering the whole media box, whose factor described the
 *    title-block border rather than the drawing — on the plan sheets it said
 *    1:56.6 where the drawing was 1:34, a 66% error. It is identified by
 *    covering essentially the entire page.
 *
 * 2. **Sheets with more than one scale.** A key plan at 1:117 beside a plan at
 *    1:31, or a section stack at three different factors. One number cannot
 *    describe such a page, so rather than pick one and be quietly wrong over
 *    most of the sheet, this refuses and says why.
 */
export function verdictFromMeasures(
  measure: PageMeasure,
  mediaBox: { widthPt: number; heightPt: number },
): MeasureVerdict {
  const issues: ImportIssue[] = [];
  if (measure.viewports.length === 0) {
    return { mmPerPoint: null, issues, distinctScales: 0 };
  }

  const pageArea = Math.max(1, mediaBox.widthPt * mediaBox.heightPt);
  const content = measure.viewports.filter((v) => v.area / pageArea < 0.92);

  if (content.length === 0) {
    issues.push({
      severity: 'review',
      code: 'PDF_MEASURE_SHEET_ONLY',
      message:
        `Page ${measure.pageNumber} records a scale for the sheet as a whole but not for any ` +
        `drawing on it. A sheet-wide factor describes the title-block border, not the building.`,
      remedy: 'Calibrate this sheet against a known dimension instead.',
    });
    return { mmPerPoint: null, issues, distinctScales: 0 };
  }

  // Cluster by factor so several viewports of one plot count once.
  const clusters: { unitsPerPoint: number; area: number; member: MeasuredViewport }[] = [];
  for (const v of [...content].sort((a, b) => b.area - a.area)) {
    const near = clusters.find(
      (c) => Math.abs(c.unitsPerPoint - v.unitsPerPoint) / c.unitsPerPoint < SAME_SCALE_TOLERANCE,
    );
    if (near) near.area += v.area;
    else clusters.push({ unitsPerPoint: v.unitsPerPoint, area: v.area, member: v });
  }

  if (clusters.length > 1) {
    const ratios = clusters
      .map((c) => `1:${(c.unitsPerPoint * 72).toFixed(1)}`)
      .join(', ');
    issues.push({
      severity: 'review',
      code: 'PDF_MULTIPLE_SCALES',
      message:
        `Page ${measure.pageNumber} carries ${clusters.length} different drawing scales (${ratios}). ` +
        `A single scale cannot describe it, so nothing was measured from this page.`,
      remedy:
        'Export the one drawing you want as its own sheet, or import a DXF or IFC where each ' +
        'drawing keeps its own coordinates.',
    });
    return { mmPerPoint: null, issues, distinctScales: clusters.length };
  }

  const chosen = clusters[0]!;
  // `/U` is routinely blank, so the unit is not declared and cannot be read off.
  // Inches is what every CAD plotter writes here, and the caller corroborates
  // the result against the drawn geometry before anything is measured.
  const mmPerPoint = chosen.unitsPerPoint * MM_PER_INCH;

  return { mmPerPoint, chosen: chosen.member, issues, distinctScales: 1 };
}
