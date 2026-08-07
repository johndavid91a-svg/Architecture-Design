/**
 * PDF VECTOR IMPORT.
 *
 * A PDF drawing is the most common thing a client actually has, and the least
 * trustworthy thing to measure from. The file records marks on a page in points
 * (1/72 inch) and says nothing whatsoever about how many millimetres of building
 * a point represents. A "1:100" note in the title block is a claim about the
 * original plot, not about this file, and it is wrong the moment anyone prints
 * A1 content to A3 or exports with "fit to page" ticked.
 *
 * So this module extracts *page geometry only*. It never converts to
 * millimetres on its own authority. Without a calibration the resulting
 * `LineWork` carries `toMmScale: 0` and a blocking issue, because a scale of 0
 * collapses the drawing to a point — obviously broken — whereas the tempting
 * default of 1.0 would produce a plausible-looking building of entirely the
 * wrong size, and that is the failure this codebase exists to prevent.
 *
 * `inferScaleFromDimensionText` is offered as an assist. It reads dimension
 * strings and matches them to the geometry they annotate, and it returns `null`
 * far more readily than it returns a guess. The primary path remains the one
 * every professional takeoff tool uses: the user picks two points and types the
 * real distance between them (`calibrateFrom`).
 *
 * Pure: input is a `Uint8Array`, output is a value. pdfjs is loaded by dynamic
 * import so that a host without it gets an issue instead of a resolution crash.
 */

import { distance, distancePointToSegment } from '../geometry.js';
import type { Point2 } from '../model/architecture.js';
import type { Millimetres } from '../units.js';
import { parseLength, toMm } from '../units.js';
import {
  SANITY,
  scaleFromCalibration,
  type ImportIssue,
  type LineSegment,
  type LineWork,
  type ScaleCalibration,
  type TextItem,
  type UnitResolution,
} from './contract.js';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/**
 * Every threshold this module leans on, in one place so they can be argued
 * with. All the `Pt` values are in PDF points *after* the current transform has
 * been applied, i.e. in the coordinates of the printed sheet, because that is
 * the only frame we can reason about before calibration.
 */
export const PDF_TUNING = {
  /**
   * A cubic or quadratic segment whose control points sit within this distance
   * of its chord is emitted as the chord; anything bolder is discarded.
   *
   * A quarter of a point is roughly 0.09 mm on the sheet — comfortably under
   * the thinnest line weight anyone plots (0.13 mm), so a curve inside this
   * band is one an exporter produced for a line that was straight all along.
   * Anything visibly curved is not a wall, and approximating it would add
   * phantom geometry the recogniser would then try to pair into walls.
   */
  curveFlatnessPt: 0.25,
  /** Endpoints are snapped to this grid before de-duplication. */
  duplicateGridPt: 0.01,
  /** Shorter than this and the segment is a rounding artefact, not a line. */
  minSegmentLengthPt: 0.05,
  /**
   * Hard stop on segments per page. A poché-heavy or hatched sheet can emit
   * millions; past this point the page is not usable line work and the user
   * needs to know that rather than wait.
   */
  maxSegmentsPerPage: 100_000,
  /**
   * Largest real-world extent a single drawing sheet may cover.
   *
   * A 1:2000 masterplan on A0 spans about 2.4 km, so 5 km is beyond any real
   * sheet while still catching the factor-of-1000 calibration slips that
   * matter. Paired with `SANITY.minWallLengthMm` at the bottom end.
   */
  maxSheetExtentMm: 5_000_000,
  /** Dimension text sits within this many text heights of its dimension line. */
  dimensionTextSearchHeights: 2.5,
  /** Radius, in text heights, searched for a pair of extension lines. */
  extensionLineSearchHeights: 20,
  /** Extension lines are short; longer than this and it is drawing content. */
  extensionLineMaxHeights: 12,
  /** Two extension lines counting as "roughly parallel". */
  extensionParallelToleranceDeg: 5,
  /**
   * Dimension strings that must independently agree before a scale is returned.
   *
   * One agreement is a coincidence and two is a pair of coincidences; three
   * separate dimensions landing on the same ratio is a drawing that was
   * dimensioned consistently. Below this the function returns null.
   */
  minAgreeingDimensions: 3,
  /** Fractional spread allowed within the agreeing group. */
  dimensionAgreementTolerance: 0.02,
} as const;

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface PdfExtractOptions {
  /** Supplied by the caller once the user has calibrated. Absent = blocking. */
  readonly calibration?: ScaleCalibration;
}

/**
 * `LineWork` plus the per-page tally of what was seen and not translated.
 *
 * The counts are the honest half of the extraction: filled hatches, bezier
 * curves and clip paths all get dropped, and a user staring at a page that
 * produced forty segments needs to see that six thousand fills were skipped.
 */
export interface PdfLineWork extends LineWork {
  readonly stats: {
    /** Source constructs seen and not translated, by kind. */
    readonly skipped: Readonly<Record<string, number>>;
    /** Segments emitted before de-duplication. */
    readonly rawSegmentCount: number;
    readonly pageNumber: number;
  };
}

export interface PdfExtractResult {
  readonly pages: PdfLineWork[];
  readonly issues: ImportIssue[];
}

/**
 * Build a calibration from a two-point pick.
 *
 * Non-positive inputs cannot come from a real pick, so they are a caller bug
 * rather than a property of the drawing; they throw instead of producing a
 * `ScaleCalibration` that would quietly scale the building to nothing.
 */
export function calibrateFrom(pageDistance: number, realDistanceMm: Millimetres): ScaleCalibration {
  if (!Number.isFinite(pageDistance) || pageDistance <= 0) {
    throw new RangeError(`calibrateFrom: pageDistance must be a positive number, got ${pageDistance}`);
  }
  if (!Number.isFinite(realDistanceMm) || realDistanceMm <= 0) {
    throw new RangeError(`calibrateFrom: realDistanceMm must be a positive number, got ${realDistanceMm}`);
  }
  const mmPerPoint = realDistanceMm / pageDistance;
  return {
    method: 'known_distance',
    pageDistance,
    realDistanceMm,
    // A distance the user measured and typed is the strongest evidence
    // available, and it survives any re-scaling the file has been through.
    confident: true,
    note:
      `Calibrated from a picked distance of ${pageDistance.toFixed(3)} pt = ` +
      `${realDistanceMm.toFixed(0)} mm (${mmPerPoint.toFixed(4)} mm per point).`,
  };
}

/**
 * Extract line work from every page of a PDF.
 *
 * One `LineWork` per page. Which page is which floor is a question about the
 * drawing set, not about the file, so the caller decides.
 */
export async function extractPdfLineWork(
  data: Uint8Array,
  opts: PdfExtractOptions = {},
): Promise<PdfExtractResult> {
  const issues: ImportIssue[] = [];

  if (data.length === 0) {
    return { pages: [], issues: [emptyFileIssue()] };
  }
  if (!looksLikePdf(data)) {
    return {
      pages: [],
      issues: [
        {
          severity: 'blocking',
          code: 'pdf_not_a_pdf',
          message: 'The supplied bytes do not begin with a %PDF header.',
          remedy: 'Check the file is a PDF and not a renamed image, DWG or ZIP.',
        },
      ],
    };
  }

  const pdfjs = await loadPdfjs();
  if (pdfjs === null) {
    return {
      pages: [],
      issues: [
        {
          severity: 'blocking',
          code: 'pdf_library_unavailable',
          message: 'The PDF engine (pdfjs-dist) could not be loaded in this environment.',
          remedy:
            'Install pdfjs-dist, or convert the drawing to DXF or IFC and import that instead.',
        },
      ],
    };
  }

  // --- Scale ---------------------------------------------------------------
  const resolved = resolveScale(opts.calibration);
  issues.push(...resolved.issues);

  // --- Document ------------------------------------------------------------
  let doc: PdfjsDocument;
  try {
    doc = await pdfjs.getDocument({
      data,
      useSystemFonts: false,
      isEvalSupported: false,
      // Errors only. pdfjs is chatty about missing standard-font data, which is
      // expected here: this module has no filesystem access by design.
      verbosity: 0,
    }).promise;
  } catch (err) {
    return {
      pages: [],
      issues: [
        ...issues,
        {
          severity: 'blocking',
          code: 'pdf_parse_failed',
          message: `The PDF could not be opened: ${errorText(err)}`,
          remedy:
            'The file may be corrupt or password-protected. Re-export it from the authoring tool, ' +
            'or supply a DXF or IFC export instead.',
        },
      ],
    };
  }

  let labels: readonly (string | null)[] | null = null;
  try {
    labels = await doc.getPageLabels();
  } catch {
    // Page labels are cosmetic; falling back to "Page N" costs nothing.
    labels = null;
  }

  const pages: PdfLineWork[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const label = labels?.[n - 1];
      const sheetName = typeof label === 'string' && label.trim() !== '' ? label.trim() : `Page ${n}`;
      pages.push(await extractPage(pdfjs, doc, n, sheetName, resolved.toMmScale, resolved.units));
    }
  } catch (err) {
    issues.push({
      severity: 'blocking',
      code: 'pdf_page_read_failed',
      message: `Reading page content failed after ${pages.length} page(s): ${errorText(err)}`,
      remedy: 'Re-export the PDF from the authoring tool and try again.',
    });
  } finally {
    await doc.destroy().catch(() => undefined);
  }

  if (pages.length > 0 && pages.every((p) => p.segments.length === 0)) {
    // Every page empty is the scanned-drawing case, and it is worth saying so
    // plainly: no amount of re-importing will make vectors appear.
    const anyImages = pages.some((p) => (p.stats.skipped['raster_image'] ?? 0) > 0);
    issues.push({
      severity: 'blocking',
      code: 'pdf_no_vector_geometry',
      message: anyImages
        ? 'No vector line work was found on any page; the drawing appears to be a scanned or ' +
          'rasterised image embedded in a PDF.'
        : 'No vector line work was found on any page.',
      remedy: anyImages
        ? 'Vector import cannot read a scan. Obtain the original DXF, DWG or IFC, or a PDF ' +
          'exported directly from the CAD tool rather than scanned from paper.'
        : 'Check the correct file was uploaded, and that the drawing is not hidden behind an ' +
          'unsupported optional-content (layer) configuration.',
    });
  }

  return { pages, issues };
}

// ---------------------------------------------------------------------------
// Scale resolution
// ---------------------------------------------------------------------------

interface ResolvedScale {
  readonly toMmScale: number;
  readonly units: UnitResolution;
  readonly issues: ImportIssue[];
}

/**
 * The whole point of the module in twenty lines.
 *
 * `UnitResolution.unit` cannot express "0.3528 mm of paper standing for 35 mm
 * of building", so it is always reported as `mm` and the honest number lives in
 * `toMmScale`. The `note` says so, because a field that cannot carry the truth
 * must not be allowed to imply something else.
 */
function resolveScale(calibration: ScaleCalibration | undefined): ResolvedScale {
  if (calibration === undefined) {
    return {
      toMmScale: 0,
      units: {
        unit: 'mm',
        source: 'unknown',
        confident: false,
        note:
          'A PDF page is measured in points and carries no building scale. No calibration was ' +
          'supplied, so toMmScale is 0 and no millimetre dimension may be derived from this page.',
      },
      issues: [
        {
          severity: 'blocking',
          code: 'pdf_scale_not_calibrated',
          message:
            'The drawing scale is unknown. A PDF page records marks in points and states nothing ' +
            'about the size of the building, and a printed "1:100" note describes the original ' +
            'plot rather than this file.',
          remedy:
            'Calibrate the sheet: pick two points a known distance apart on the drawing — a ' +
            'dimensioned wall or a grid spacing is ideal — and enter that real distance. Do not ' +
            'accept an assumed scale.',
        },
      ],
    };
  }

  const scale = scaleFromCalibration(calibration);
  if (!Number.isFinite(scale) || scale <= 0) {
    return {
      toMmScale: 0,
      units: {
        unit: 'mm',
        source: 'user_specified',
        confident: false,
        note: `The supplied calibration is degenerate: ${calibration.note}`,
      },
      issues: [
        {
          severity: 'blocking',
          code: 'pdf_calibration_invalid',
          message:
            `The supplied calibration is unusable (page distance ${calibration.pageDistance}, ` +
            `real distance ${calibration.realDistanceMm} mm).`,
          remedy: 'Re-pick the two calibration points and re-enter the real distance between them.',
        },
      ],
    };
  }

  const issues: ImportIssue[] = [];
  if (!calibration.confident) {
    issues.push({
      severity: 'review',
      code: 'pdf_scale_not_confident',
      message:
        `The scale came from ${calibration.method.replace(/_/g, ' ')} and is not confirmed: ` +
        `${calibration.note}`,
      remedy:
        'Confirm the scale by picking two points on a dimensioned element and checking the ' +
        'reported distance matches the dimension printed on the drawing.',
    });
  }

  return {
    toMmScale: scale,
    units: {
      unit: 'mm',
      source: 'user_specified',
      confident: calibration.confident,
      note:
        `1 page point = ${scale.toFixed(4)} mm, from ${calibration.method.replace(/_/g, ' ')}. ` +
        `The unit label is nominal; the multiplier in toMmScale is the authoritative figure.`,
    },
    issues,
  };
}

// ---------------------------------------------------------------------------
// Page extraction
// ---------------------------------------------------------------------------

/**
 * Path op codes inside a `constructPath` coordinate stream.
 *
 * pdfjs does not export its internal `DrawOPS` enum, so the values are mirrored
 * here from `makePathFromDrawOPS` in the pdfjs build. They are a private
 * contract, hence `assertKnownPathOp` treats an unrecognised code as a reason
 * to abandon the subpath rather than to improvise.
 */
const DRAW_OP = {
  moveTo: 0,
  lineTo: 1,
  curveTo: 2,
  quadraticCurveTo: 3,
  closePath: 4,
} as const;

/** Number of coordinates each path op consumes. */
const DRAW_OP_ARITY: Readonly<Record<number, number>> = {
  [DRAW_OP.moveTo]: 2,
  [DRAW_OP.lineTo]: 2,
  [DRAW_OP.curveTo]: 6,
  [DRAW_OP.quadraticCurveTo]: 4,
  [DRAW_OP.closePath]: 0,
};

type Matrix = readonly [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `apply(multiply(a, b), p)` equals `apply(a, apply(b, p))`. */
function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function apply(m: Matrix, x: number, y: number): Point2 {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/** Geometric mean of the matrix scale factors, for reporting stroke widths. */
function matrixScale(m: Matrix): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
}

interface GraphicsState {
  ctm: Matrix;
  strokeColour: string;
  lineWidth: number;
}

async function extractPage(
  pdfjs: PdfjsModule,
  doc: PdfjsDocument,
  pageNumber: number,
  sheetName: string,
  toMmScale: number,
  units: UnitResolution,
): Promise<PdfLineWork> {
  const page = await doc.getPage(pageNumber);
  const skipped: Record<string, number> = {};
  const issues: ImportIssue[] = [];
  const bump = (key: string, by = 1): void => {
    skipped[key] = (skipped[key] ?? 0) + by;
  };

  // The MediaBox origin is not necessarily (0, 0), and pdfjs reports both path
  // coordinates and text matrices in raw user space. Shifting once here keeps
  // geometry and labels in the same frame.
  const view = page.view;
  const originX = typeof view[0] === 'number' ? view[0] : 0;
  const originY = typeof view[1] === 'number' ? view[1] : 0;
  const base: Matrix = [1, 0, 0, 1, -originX, -originY];

  if (page.rotate % 360 !== 0) {
    // /Rotate is a rigid transform: it changes which way the sheet is viewed
    // and cannot change any distance measured on it. Applying it wrong is
    // worse than not applying it, so it is recorded and left alone.
    issues.push({
      severity: 'info',
      code: 'pdf_page_rotated',
      message: `Page ${pageNumber} carries /Rotate ${page.rotate}. Geometry is reported in unrotated page space.`,
      remedy: 'No action needed — rotation does not affect measured distances.',
    });
  }

  const rawSegments = await walkOperators(pdfjs, page, base, bump, issues, pageNumber);
  const segments = dedupe(rawSegments);

  if (rawSegments.length >= PDF_TUNING.maxSegmentsPerPage) {
    issues.push({
      severity: 'review',
      code: 'pdf_segment_cap_reached',
      message:
        `Page ${pageNumber} produced more than ${PDF_TUNING.maxSegmentsPerPage} stroked segments and ` +
        `extraction stopped early. The page is probably dense hatching rather than plan line work.`,
      remedy:
        'Import the plan sheet on its own, or turn off hatch and pattern layers before exporting the PDF.',
    });
  }

  const filled = skipped['filled_path'] ?? 0;
  if (filled > 0) {
    // Stroked and filled paths are distinguishable here — pdfjs tags each
    // constructPath with the painting operator that consumed it — so hatches
    // are dropped cleanly. The cost is real: CAD tools that draw walls as
    // solid poché produce no strokes at all, and the user must be told.
    issues.push({
      severity: filled > rawSegments.length ? 'review' : 'info',
      code: 'pdf_filled_paths_skipped',
      message:
        `Page ${pageNumber}: ${filled} filled path(s) were skipped in favour of stroked line work.`,
      remedy:
        'If walls are missing from the import, this drawing draws them as solid fill rather than ' +
        'outlines. Re-export with hatching as outlines, or import the DXF.',
    });
  }

  const curves = skipped['curve_too_curved'] ?? 0;
  if (curves > 0) {
    issues.push({
      severity: 'info',
      code: 'pdf_curves_skipped',
      message:
        `Page ${pageNumber}: ${curves} curved path segment(s) were skipped. Door swings, ` +
        `circles and text outlines are curves; walls are not.`,
      remedy: 'No action needed unless the plan genuinely contains curved walls.',
    });
  }

  const texts = await readText(page, base, bump, issues, pageNumber);

  if (segments.length === 0) {
    issues.push({
      severity: 'review',
      code: 'pdf_page_has_no_line_work',
      message: `Page ${pageNumber} produced no stroked line work.`,
      remedy:
        'This may be a cover sheet, a schedule, or a scanned image. Select a different page, or ' +
        'supply a vector export of the drawing.',
    });
  }

  const extent = extentOf(segments, texts);

  // ---- Sanity ------------------------------------------------------------
  // Applied to the sheet as a whole rather than to individual segments: a
  // title-block border legitimately spans the sheet, so a per-segment limit
  // would fire on every correctly calibrated drawing.
  let sane = true;
  if (toMmScale > 0 && segments.length > 0) {
    const spanMm = Math.max(extent.maxX - extent.minX, extent.maxY - extent.minY) * toMmScale;
    if (spanMm < SANITY.minWallLengthMm) {
      sane = false;
      issues.push({
        severity: 'blocking',
        code: 'pdf_scale_implausibly_small',
        message:
          `At the supplied calibration, page ${pageNumber} covers only ${spanMm.toFixed(1)} mm — ` +
          `less than the shortest permissible wall (${SANITY.minWallLengthMm} mm). The scale has ` +
          `been misread, most likely by a factor of 1000.`,
        remedy:
          'Re-calibrate: check the real distance was entered in millimetres, not metres or feet.',
      });
    } else if (spanMm > PDF_TUNING.maxSheetExtentMm) {
      sane = false;
      issues.push({
        severity: 'blocking',
        code: 'pdf_scale_implausibly_large',
        message:
          `At the supplied calibration, page ${pageNumber} covers ${(spanMm / 1000).toFixed(0)} m — ` +
          `beyond any real drawing sheet. The scale has been misread.`,
        remedy:
          'Re-calibrate: check the two picked points and that the real distance was entered in ' +
          'millimetres.',
      });
    }
  }

  return {
    // Geometry that fails the sanity check is withheld rather than published:
    // a wrong wall is indistinguishable from a right one downstream.
    segments: sane ? segments : [],
    // PDF has no arc primitive — circles and door swings arrive as beziers and
    // are handled (and mostly discarded) by the curve rule.
    arcs: [],
    texts: sane ? texts : [],
    extent: sane ? extent : { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    toMmScale,
    units,
    sheetName,
    issues,
    stats: { skipped, rawSegmentCount: rawSegments.length, pageNumber },
  };
}

/**
 * Walk the operator list, tracking the transform stack and emitting the stroked
 * paths.
 *
 * `save`/`restore`, `transform` and — crucially — `paintFormXObjectBegin`/`End`
 * all move the current transform. CAD exporters nest almost everything inside
 * form XObjects, so ignoring those would place most of a real drawing at the
 * page origin at the wrong size.
 */
async function walkOperators(
  pdfjs: PdfjsModule,
  page: PdfjsPage,
  base: Matrix,
  bump: (key: string, by?: number) => void,
  issues: ImportIssue[],
  pageNumber: number,
): Promise<LineSegment[]> {
  const ops = pdfjs.OPS;
  const strokingOps = new Set<number>(
    [ops['stroke'], ops['closeStroke'], ops['fillStroke'], ops['eoFillStroke'], ops['closeFillStroke'], ops['closeEOFillStroke']].filter(
      isNumber,
    ),
  );
  const fillingOps = new Set<number>([ops['fill'], ops['eoFill'], ops['rawFillPath']].filter(isNumber));
  const imageOps = new Set<number>(
    [ops['paintImageXObject'], ops['paintInlineImageXObject'], ops['paintImageXObjectRepeat'], ops['paintJpegXObject']].filter(
      isNumber,
    ),
  );

  const list = await page.getOperatorList({ annotationMode: pdfjs.AnnotationMode.DISABLE });

  let state: GraphicsState = { ctm: base, strokeColour: '#000000', lineWidth: 1 };
  const stack: GraphicsState[] = [];
  const out: LineSegment[] = [];

  for (let i = 0; i < list.fnArray.length; i++) {
    if (out.length >= PDF_TUNING.maxSegmentsPerPage) break;
    const fn = list.fnArray[i];
    const args = list.argsArray[i];
    if (fn === undefined) continue;

    if (fn === ops['save']) {
      stack.push({ ...state });
    } else if (fn === ops['restore']) {
      const popped = stack.pop();
      // An unbalanced Q is malformed content. Holding the current state is the
      // least destructive recovery; resetting to identity would relocate
      // everything that follows.
      if (popped !== undefined) state = popped;
      else bump('unbalanced_restore');
    } else if (fn === ops['transform']) {
      const m = asMatrix(args);
      if (m === null) bump('unreadable_transform');
      else state = { ...state, ctm: multiply(state.ctm, m) };
    } else if (fn === ops['paintFormXObjectBegin']) {
      // pdfjs implements this as save + transform(matrix).
      stack.push({ ...state });
      const m = asMatrix(Array.isArray(args) ? args[0] : undefined);
      if (m !== null) state = { ...state, ctm: multiply(state.ctm, m) };
    } else if (fn === ops['paintFormXObjectEnd']) {
      const popped = stack.pop();
      if (popped !== undefined) state = popped;
      else bump('unbalanced_restore');
    } else if (fn === ops['beginGroup']) {
      stack.push({ ...state });
      // A transparency group may carry its own matrix, and pdfjs applies it in
      // only some of its rendering paths. Rather than pick one and be wrong
      // half the time, the matrix is recorded and the group treated as a plain
      // save. Non-identity group matrices are rare in CAD output.
      const group = Array.isArray(args) ? args[0] : undefined;
      const gm = asMatrix((group as { matrix?: unknown } | undefined)?.matrix);
      if (gm !== null && !isIdentity(gm)) bump('transparency_group_matrix');
    } else if (fn === ops['endGroup']) {
      const popped = stack.pop();
      if (popped !== undefined) state = popped;
      else bump('unbalanced_restore');
    } else if (fn === ops['setLineWidth']) {
      const w = Array.isArray(args) ? args[0] : undefined;
      if (typeof w === 'number' && Number.isFinite(w)) state = { ...state, lineWidth: w };
    } else if (fn === ops['setStrokeRGBColor']) {
      // pdfjs normalises every stroke colour space to an RGB hex string.
      const c = Array.isArray(args) ? args[0] : undefined;
      if (typeof c === 'string') state = { ...state, strokeColour: c };
    } else if (imageOps.has(fn)) {
      bump('raster_image');
    } else if (fn === ops['constructPath']) {
      const painting = Array.isArray(args) ? args[0] : undefined;
      if (typeof painting !== 'number') {
        bump('unreadable_path');
        continue;
      }
      if (!strokingOps.has(painting)) {
        // Fills, clips and endPath. Clips and endPath leave no mark at all; a
        // fill is a hatch, a poché or a solid symbol.
        bump(fillingOps.has(painting) ? 'filled_path' : 'clip_or_invisible_path');
        continue;
      }
      const coords = normalisePathCoords(Array.isArray(args) ? args[1] : undefined);
      if (coords === null) {
        bump('unreadable_path');
        continue;
      }
      emitSubpaths(coords, state, out, bump, issues, pageNumber);
    }
  }

  return out;
}

/**
 * Normalise the `constructPath` coordinate stream.
 *
 * In pdfjs 6 the argument is an array whose first element holds the interleaved
 * op/coordinate stream, and that element is a `Float32Array` in-process. It can
 * arrive as a plain object with numeric keys once it has been through a
 * structured clone, and older shapes pass the stream directly rather than
 * wrapped, so all four forms are accepted.
 */
function normalisePathCoords(arg: unknown): number[] | null {
  if (arg === null || arg === undefined) return null;

  if (ArrayBuffer.isView(arg) && !(arg instanceof DataView)) {
    return Array.from(arg as unknown as ArrayLike<number>);
  }
  if (Array.isArray(arg)) {
    if (arg.length === 0) return [];
    const first = arg[0];
    // Wrapped form: [stream]. Unwrapped form: a flat numeric array.
    if (typeof first === 'number') return arg.filter(isNumber);
    return normalisePathCoords(first);
  }
  if (typeof arg === 'object') {
    const bag = arg as Record<string, unknown>;
    const length = typeof bag['length'] === 'number' ? bag['length'] : undefined;
    if (length !== undefined) {
      const out: number[] = [];
      for (let i = 0; i < length; i++) {
        const v = bag[String(i)];
        if (typeof v !== 'number' || !Number.isFinite(v)) return null;
        out.push(v);
      }
      return out;
    }
    // Numeric-keyed object with no length: take the contiguous run from 0.
    const out: number[] = [];
    for (let i = 0; ; i++) {
      const v = bag[String(i)];
      if (typeof v !== 'number' || !Number.isFinite(v)) break;
      out.push(v);
    }
    return out.length > 0 ? out : null;
  }
  return null;
}

/** Decode one path's op/coordinate stream into transformed segments. */
function emitSubpaths(
  coords: readonly number[],
  state: GraphicsState,
  out: LineSegment[],
  bump: (key: string, by?: number) => void,
  issues: ImportIssue[],
  pageNumber: number,
): void {
  const layer = `stroke:${state.strokeColour}/${(state.lineWidth * matrixScale(state.ctm)).toFixed(2)}`;
  const width = state.lineWidth * matrixScale(state.ctm);

  // Kept in *path* space; the transform is applied only as points are emitted,
  // which is what makes nested form geometry land correctly.
  let cur: Point2 | null = null;
  let subpathStart: Point2 | null = null;

  const push = (a: Point2, b: Point2): void => {
    if (out.length >= PDF_TUNING.maxSegmentsPerPage) return;
    const ta = apply(state.ctm, a.x, a.y);
    const tb = apply(state.ctm, b.x, b.y);
    if (distance(ta, tb) < PDF_TUNING.minSegmentLengthPt) return;
    out.push({ a: ta, b: tb, layer, width });
  };

  for (let i = 0; i < coords.length; ) {
    const op = coords[i++];
    if (op === undefined) break;
    const arity = DRAW_OP_ARITY[op];
    if (arity === undefined) {
      // An unrecognised op means the stream is being read out of phase, and
      // every coordinate after it would be nonsense. Abandon the path.
      bump('unknown_path_op');
      issues.push({
        severity: 'review',
        code: 'pdf_unknown_path_op',
        message: `Page ${pageNumber}: unrecognised path operator ${op} — the rest of that path was discarded.`,
        remedy: 'Check whether geometry is missing from the imported drawing.',
      });
      return;
    }
    if (i + arity > coords.length) {
      bump('truncated_path');
      return;
    }

    switch (op) {
      case DRAW_OP.moveTo: {
        cur = { x: coords[i]!, y: coords[i + 1]! };
        subpathStart = cur;
        break;
      }
      case DRAW_OP.lineTo: {
        const next = { x: coords[i]!, y: coords[i + 1]! };
        if (cur !== null) push(cur, next);
        cur = next;
        if (subpathStart === null) subpathStart = next;
        break;
      }
      case DRAW_OP.curveTo:
      case DRAW_OP.quadraticCurveTo: {
        const end =
          op === DRAW_OP.curveTo
            ? { x: coords[i + 4]!, y: coords[i + 5]! }
            : { x: coords[i + 2]!, y: coords[i + 3]! };
        const controls: Point2[] =
          op === DRAW_OP.curveTo
            ? [
                { x: coords[i]!, y: coords[i + 1]! },
                { x: coords[i + 2]!, y: coords[i + 3]! },
              ]
            : [{ x: coords[i]!, y: coords[i + 1]! }];
        if (cur !== null) {
          if (chordDeviation(state.ctm, cur, controls, end) <= PDF_TUNING.curveFlatnessPt) {
            push(cur, end);
          } else {
            bump('curve_too_curved');
          }
        }
        // The current point advances whether or not the curve was emitted; a
        // skipped curve must not leave the pen behind, or the next lineTo would
        // draw a segment that exists nowhere on the sheet.
        cur = end;
        if (subpathStart === null) subpathStart = end;
        break;
      }
      case DRAW_OP.closePath: {
        if (cur !== null && subpathStart !== null) push(cur, subpathStart);
        cur = subpathStart;
        break;
      }
      default:
        break;
    }
    i += arity;
  }
}

/**
 * Largest departure of a bezier from its chord, measured on the sheet.
 *
 * Bounded by the control points' distance from the chord, which over-estimates
 * the true deviation — the safe direction, since over-estimating only discards
 * a curve we might have kept.
 */
function chordDeviation(ctm: Matrix, start: Point2, controls: readonly Point2[], end: Point2): number {
  const a = apply(ctm, start.x, start.y);
  const b = apply(ctm, end.x, end.y);
  let worst = 0;
  for (const c of controls) {
    const t = apply(ctm, c.x, c.y);
    worst = Math.max(worst, distancePointToSegment(t, a, b));
  }
  return worst;
}

/**
 * Collapse repeated strokes.
 *
 * CAD exporters redraw the same line once per view, once per layer and once per
 * clip region, and a plan can carry an order of magnitude more segments than it
 * has lines. Direction is normalised so a line and its reverse collapse too.
 */
function dedupe(segments: readonly LineSegment[]): LineSegment[] {
  const grid = PDF_TUNING.duplicateGridPt;
  const snap = (v: number): number => Math.round(v / grid) * grid;
  const seen = new Set<string>();
  const out: LineSegment[] = [];
  for (const s of segments) {
    const ax = snap(s.a.x);
    const ay = snap(s.a.y);
    const bx = snap(s.b.x);
    const by = snap(s.b.y);
    const forward = ax < bx || (ax === bx && ay <= by);
    const key = forward ? `${ax},${ay},${bx},${by}` : `${bx},${by},${ax},${ay}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

async function readText(
  page: PdfjsPage,
  base: Matrix,
  bump: (key: string, by?: number) => void,
  issues: ImportIssue[],
  pageNumber: number,
): Promise<TextItem[]> {
  let content: { items: unknown[] };
  try {
    content = await page.getTextContent();
  } catch (err) {
    issues.push({
      severity: 'review',
      code: 'pdf_text_unreadable',
      message: `Page ${pageNumber}: text could not be read (${errorText(err)}). Room names and dimension strings will be missing.`,
      remedy: 'Re-export the PDF with fonts embedded, or label the rooms manually after import.',
    });
    return [];
  }

  const out: TextItem[] = [];
  for (const raw of content.items) {
    const item = raw as PdfjsTextItem;
    if (typeof item.str !== 'string') {
      // Marked-content boundaries have no string and no position.
      bump('text_marked_content');
      continue;
    }
    const text = item.str.trim();
    if (text === '') continue;

    const t = item.transform;
    if (!Array.isArray(t) || t.length < 6) {
      bump('text_without_position');
      continue;
    }
    const x = t[4];
    const y = t[5];
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
      bump('text_without_position');
      continue;
    }

    // Height falls back to the text matrix's vertical scale, which is what
    // pdfjs derives `height` from anyway; some producers leave it at zero.
    const scaleY = typeof t[3] === 'number' && typeof t[2] === 'number' ? Math.hypot(t[2], t[3]) : 0;
    const height = typeof item.height === 'number' && item.height > 0 ? item.height : scaleY;

    out.push({
      text,
      at: apply(base, x, y),
      heightHint: height > 0 ? height : undefined,
      layer: typeof item.fontName === 'string' ? item.fontName : undefined,
    });
  }
  return out;
}

function extentOf(
  segments: readonly LineSegment[],
  texts: readonly TextItem[],
): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const take = (p: Point2): void => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  };
  for (const s of segments) {
    take(s.a);
    take(s.b);
  }
  for (const t of texts) take(t.at);
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

// ---------------------------------------------------------------------------
// Scale inference from dimension text — an assist, never the primary path
// ---------------------------------------------------------------------------

/**
 * Parse a dimension string as an architect writes it on a drawing.
 *
 * Accepts `15'-0"`, `15' 6"`, `15'`, `4572`, `4572mm`, `4.5m`, `18"`.
 *
 * The bare-number case is the delicate one. Metric construction drawings
 * dimension in millimetres without a suffix, so `4572` must be read — but so
 * must a room number `203` be refused. The rule is: whole numbers of three or
 * more digits only. A number with a decimal point and no unit is rejected
 * outright, because `4.5` is equally defensible as metres, as millimetres and
 * as a drawing note.
 *
 * Returns `null` for anything it cannot read with certainty. Exported because
 * the review UI shows the user what it understood from each label.
 */
export function parseDimensionText(input: string): Millimetres | null {
  const raw = input
    // Typographic quotes are what a PDF actually contains; the ASCII forms are
    // what every regex is written against.
    .replace(/[‘’ʼʹ′]/g, "'")
    .replace(/[“”ʺ″]/g, '"')
    .replace(/[   ]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  if (raw === '') return null;

  // Feet and inches, with the hyphen the American convention inserts.
  const ftIn = raw.match(/^(\d+(?:\.\d+)?)\s*'\s*-?\s*(\d+(?:\.\d+)?)\s*"?$/);
  if (ftIn) {
    const feet = Number(ftIn[1]);
    const inches = Number(ftIn[2]);
    if (!Number.isFinite(feet) || !Number.isFinite(inches)) return null;
    return plausibleDimension(toMm(feet, 'ft') + toMm(inches, 'in'));
  }

  // Feet alone, and any form units.ts already understands (mm, cm, m, in, ft).
  const withUnit = raw.match(/^(\d+(?:\.\d+)?)\s*(mm|cm|m|in|ft|'|")$/i);
  if (withUnit) {
    const parsed = parseLength(`${withUnit[1]}${withUnit[2]}`);
    return parsed === null ? null : plausibleDimension(parsed);
  }

  const bare = raw.match(/^(\d{3,})$/);
  if (bare) {
    const value = Number(bare[1]);
    if (!Number.isFinite(value)) return null;
    return plausibleDimension(toMm(value, 'mm'));
  }

  return null;
}

/** A dimension outside the range a building is drawn at is not a dimension. */
function plausibleDimension(mm: Millimetres): Millimetres | null {
  if (mm < SANITY.minWallLengthMm || mm > SANITY.maxWallLengthMm) return null;
  return mm;
}

interface DimensionMatch {
  readonly text: string;
  readonly realDistanceMm: Millimetres;
  readonly pageDistance: number;
  readonly via: 'dimension_line' | 'extension_lines';
}

/**
 * Try to recover the drawing scale from its own dimension strings.
 *
 * Each dimension string is matched to the geometry it annotates — first the
 * dimension line it sits on, then failing that the pair of extension lines it
 * spans — and each match yields a candidate millimetres-per-point ratio. A
 * ratio is returned only when at least `minAgreeingDimensions` independent
 * dimensions land on it within `dimensionAgreementTolerance`.
 *
 * The corroboration requirement is the entire safety mechanism. A single match
 * is trivially fooled: a dimension string sitting near a grid line, a hatch
 * boundary or a leader produces a confident-looking ratio that is wrong by an
 * arbitrary factor. Three unrelated dimensions agreeing to 2% do not happen by
 * accident on a drawing that was not dimensioned consistently.
 *
 * Returns `null` rather than a weak answer, and never returns `confident: true`
 * — a scale nobody looked at is not a scale anybody should build against.
 */
export function inferScaleFromDimensionText(work: LineWork): ScaleCalibration | null {
  const matches: DimensionMatch[] = [];

  for (const t of work.texts) {
    const realDistanceMm = parseDimensionText(t.text);
    if (realDistanceMm === null) continue;
    const height = t.heightHint !== undefined && t.heightHint > 0 ? t.heightHint : 0;
    if (height <= 0) continue; // No text height, no search radius, no match.

    const online = matchDimensionLine(t.at, height, work.segments);
    if (online !== null) {
      matches.push({ text: t.text, realDistanceMm, pageDistance: online, via: 'dimension_line' });
      continue;
    }
    const spanned = matchExtensionLines(t.at, height, work.segments);
    if (spanned !== null) {
      matches.push({ text: t.text, realDistanceMm, pageDistance: spanned, via: 'extension_lines' });
    }
  }

  if (matches.length < PDF_TUNING.minAgreeingDimensions) return null;

  const ratios = matches.map((m) => m.realDistanceMm / m.pageDistance).sort((a, b) => a - b);
  const median = ratios[Math.floor(ratios.length / 2)];
  if (median === undefined || !Number.isFinite(median) || median <= 0) return null;

  const agreeing = matches.filter(
    (m) =>
      Math.abs(m.realDistanceMm / m.pageDistance - median) / median <=
      PDF_TUNING.dimensionAgreementTolerance,
  );
  if (agreeing.length < PDF_TUNING.minAgreeingDimensions) return null;
  // A drawing where most dimensions disagree has been mis-matched somewhere,
  // and there is no way to tell which half is the right half.
  if (agreeing.length * 2 <= matches.length) return null;

  // Report the calibration in terms of one real match rather than a synthesised
  // pair of numbers, so scaleFromCalibration reproduces exactly this ratio and
  // the user can find the dimension it came from on the sheet.
  let best = agreeing[0]!;
  let bestError = Infinity;
  for (const m of agreeing) {
    const err = Math.abs(m.realDistanceMm / m.pageDistance - median);
    if (err < bestError) {
      bestError = err;
      best = m;
    }
  }

  return {
    method: 'dimension_text',
    pageDistance: best.pageDistance,
    realDistanceMm: best.realDistanceMm,
    // Never confident: this method is silently wrong when it latches onto the
    // wrong geometry, and the user is the only one who can tell.
    confident: false,
    note:
      `${agreeing.length} of ${matches.length} dimension string(s) agree on ` +
      `${(best.realDistanceMm / best.pageDistance).toFixed(4)} mm per point. ` +
      `Anchor dimension "${best.text}" matched via ${best.via.replace(/_/g, ' ')}. ` +
      `Confirm against a dimension printed on the drawing before relying on it.`,
  };
}

/**
 * The segment a dimension string is sitting on.
 *
 * Dimension text is placed just clear of its dimension line and centred along
 * it, so the test is: the text's foot of perpendicular falls inside the
 * segment, and the perpendicular distance is within a couple of text heights.
 * The nearest such segment wins — deliberately not the segment whose length
 * best explains the dimension, which would be circular reasoning that always
 * "succeeds".
 */
function matchDimensionLine(
  at: Point2,
  textHeight: number,
  segments: readonly LineSegment[],
): number | null {
  const radius = textHeight * PDF_TUNING.dimensionTextSearchHeights;
  let bestDistance = Infinity;
  let bestLength: number | null = null;

  for (const s of segments) {
    const length = distance(s.a, s.b);
    // A dimension line is at least as long as the text it carries; anything
    // shorter is a tick, an arrowhead or an extension line.
    if (length < textHeight) continue;
    const d = distancePointToSegment(at, s.a, s.b);
    if (d > radius) continue;
    // Reject a near miss past the end of the segment: the perpendicular foot
    // must actually fall within the span.
    if (!footInsideSegment(at, s.a, s.b)) continue;
    if (d < bestDistance) {
      bestDistance = d;
      bestLength = length;
    }
  }
  return bestLength;
}

function footInsideSegment(p: Point2, a: Point2, b: Point2): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return false;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  return t >= 0 && t <= 1;
}

/**
 * The distance between the two extension lines a dimension spans.
 *
 * Extension (witness) lines are the short strokes dropped from the two features
 * being dimensioned. They are near-parallel to each other and perpendicular to
 * the dimension line, so the measurement wanted is their perpendicular
 * separation, not the distance between their endpoints.
 *
 * This runs only when no dimension line was found under the text — a drawing
 * with dimension lines gives a far cleaner answer.
 */
function matchExtensionLines(
  at: Point2,
  textHeight: number,
  segments: readonly LineSegment[],
): number | null {
  const searchRadius = textHeight * PDF_TUNING.extensionLineSearchHeights;
  const maxLength = textHeight * PDF_TUNING.extensionLineMaxHeights;

  const candidates = segments.filter((s) => {
    const length = distance(s.a, s.b);
    if (length < textHeight || length > maxLength) return false;
    return distancePointToSegment(at, s.a, s.b) <= searchRadius;
  });
  if (candidates.length < 2) return null;

  const tolerance = (PDF_TUNING.extensionParallelToleranceDeg * Math.PI) / 180;
  let bestSeparation: number | null = null;
  let bestProximity = Infinity;

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const p = candidates[i]!;
      const q = candidates[j]!;
      if (!roughlyParallel(p, q, tolerance)) continue;
      // Perpendicular separation: how far q's midpoint lies off p's infinite line.
      const qMid = { x: (q.a.x + q.b.x) / 2, y: (q.a.y + q.b.y) / 2 };
      const separation = perpendicularDistanceToLine(qMid, p.a, p.b);
      if (separation < textHeight) continue; // Coincident lines, not a dimension.
      // Prefer the pair whose midpoint sits closest to the text, which is where
      // the dimension it labels actually is.
      const pMid = { x: (p.a.x + p.b.x) / 2, y: (p.a.y + p.b.y) / 2 };
      const centre = { x: (pMid.x + qMid.x) / 2, y: (pMid.y + qMid.y) / 2 };
      const proximity = distance(at, centre);
      if (proximity < bestProximity) {
        bestProximity = proximity;
        bestSeparation = separation;
      }
    }
  }
  return bestSeparation;
}

function roughlyParallel(p: LineSegment, q: LineSegment, toleranceRad: number): boolean {
  const ap = Math.atan2(p.b.y - p.a.y, p.b.x - p.a.x);
  const aq = Math.atan2(q.b.y - q.a.y, q.b.x - q.a.x);
  // Direction is irrelevant — an extension line drawn upward and one drawn
  // downward are still parallel — so compare modulo pi.
  let delta = Math.abs(ap - aq) % Math.PI;
  if (delta > Math.PI / 2) delta = Math.PI - delta;
  return delta <= toleranceRad;
}

function perpendicularDistanceToLine(p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return distance(p, a);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / length;
}

// ---------------------------------------------------------------------------
// pdfjs plumbing
// ---------------------------------------------------------------------------

/**
 * A structural view of the slice of pdfjs this module uses.
 *
 * Declared locally rather than imported so the dynamic import can stay inside a
 * try/catch and so a change to pdfjs's published typings cannot break the build
 * of a module that only ever touches five methods.
 */
interface PdfjsModule {
  readonly OPS: Readonly<Record<string, number>>;
  readonly AnnotationMode: { readonly DISABLE: number };
  getDocument(src: unknown): { readonly promise: Promise<PdfjsDocument> };
}

interface PdfjsDocument {
  readonly numPages: number;
  getPage(pageNumber: number): Promise<PdfjsPage>;
  getPageLabels(): Promise<(string | null)[] | null>;
  destroy(): Promise<void>;
}

interface PdfjsPage {
  readonly view: number[];
  readonly rotate: number;
  getOperatorList(params?: unknown): Promise<{ fnArray: number[]; argsArray: unknown[] }>;
  getTextContent(params?: unknown): Promise<{ items: unknown[] }>;
}

interface PdfjsTextItem {
  readonly str?: string;
  readonly transform?: number[];
  readonly height?: number;
  readonly fontName?: string;
}

/**
 * pdfjs 6 is ESM-only and pulls in a fair amount of environment detection, so a
 * host that has not installed it (or that cannot evaluate it) must get an
 * `ImportIssue` rather than an unhandled module-resolution rejection at import
 * time. Hence the dynamic import behind a try/catch.
 */
async function loadPdfjs(): Promise<PdfjsModule | null> {
  try {
    const mod = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const candidate = mod as unknown as PdfjsModule;
    if (typeof candidate.getDocument !== 'function' || typeof candidate.OPS !== 'object') return null;
    return candidate;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function looksLikePdf(data: Uint8Array): boolean {
  // The header need not be at byte 0 — the specification allows leading junk,
  // and plenty of real files have it — so scan the first kilobyte for "%PDF-".
  const limit = Math.min(data.length, 1024);
  for (let i = 0; i + 4 < limit; i++) {
    if (
      data[i] === 0x25 && // %
      data[i + 1] === 0x50 && // P
      data[i + 2] === 0x44 && // D
      data[i + 3] === 0x46 && // F
      data[i + 4] === 0x2d // -
    ) {
      return true;
    }
  }
  return false;
}

function emptyFileIssue(): ImportIssue {
  return {
    severity: 'blocking',
    code: 'pdf_empty',
    message: 'The supplied PDF is empty (zero bytes).',
    remedy: 'Re-upload the drawing; the transfer may have failed.',
  };
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isIdentity(m: Matrix): boolean {
  return IDENTITY.every((v, i) => m[i] === v);
}

function asMatrix(value: unknown): Matrix | null {
  const arr = ArrayBuffer.isView(value) && !(value instanceof DataView)
    ? Array.from(value as unknown as ArrayLike<number>)
    : value;
  if (!Array.isArray(arr) || arr.length < 6) return null;
  const m: number[] = [];
  for (let i = 0; i < 6; i++) {
    const v = arr[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    m.push(v);
  }
  return [m[0]!, m[1]!, m[2]!, m[3]!, m[4]!, m[5]!];
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
