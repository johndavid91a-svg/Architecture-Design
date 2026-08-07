/**
 * DXF DRAWING EXTRACTION.
 *
 * A DXF file is a drawing, not a building. It carries lines, arcs and text on
 * named layers, and nothing in it says "this is a wall" — that recognition
 * happens once, downstream, on the `LineWork` this module produces. The job
 * here is narrower, and it is entirely a job of fidelity: every entity that
 * could be part of a wall must arrive in drawing coordinates unaltered, or be
 * reported as missing.
 *
 * Silent loss is the failure that matters. A block reference left unexpanded,
 * an arc straightened because its bulge was inconvenient, a polyline dropped
 * because one vertex was malformed — each removes real building from the
 * drawing, and nothing downstream can tell that it is gone. So every entity
 * this module declines to translate is counted by type and surfaced as an
 * issue, and the counts are part of the return value rather than a log line.
 *
 * Nothing here converts to millimetres. `LineWork` keeps drawing coordinates
 * plus a `toMmScale` because the unit is routinely the least certain thing in
 * the file: authoring tools leave `$INSUNITS` at 0 as a matter of course, and
 * guessing wrong scales the whole building by 25.4 or 1000 while still looking
 * like a plausible plan. Unit resolution therefore travels with the result, and
 * an unconfident one is a review item the user settles before the geometry is
 * trusted.
 *
 * Coordinates here are typed `Point2`, whose members are nominally millimetres.
 * Inside `LineWork` they are *drawing* units until `toMmScale` is applied; the
 * contract defines the intermediate that way so that the scale is applied once,
 * by the recogniser, rather than twice by two importers.
 */

import DxfParser from 'dxf-parser';
import type {
  IArcEntity,
  ICircleEntity,
  IDxf,
  IEntity,
  IInsertEntity,
  ILineEntity,
  ILwpolylineEntity,
  IMtextEntity,
  IPoint,
  IPolylineEntity,
  ITextEntity,
} from 'dxf-parser';
import type { Point2 } from '../model/architecture.js';
import { toMm, type LengthUnit } from '../units.js';
import type { ArcSegment, ImportIssue, LineSegment, LineWork, TextItem, UnitResolution } from './contract.js';
import { SANITY } from './contract.js';

/**
 * The library's entity interfaces declare every field as present. Real files
 * omit them constantly — a LINE with no second vertex, an INSERT with no
 * position — so every field this module reads is re-declared optional and
 * checked. Trusting the published types here would turn a malformed file into
 * a thrown TypeError instead of an issue the user can act on.
 */
type Loose<T> = { [K in keyof T]?: T[K] };

/** Structured result. `extractDxfLineWork` is the narrow view of this. */
export interface DxfExtraction {
  readonly work: LineWork | null;
  readonly issues: readonly ImportIssue[];
  /**
   * Entities seen but not translated, by type.
   *
   * Plain keys (`SPLINE`) are entity types the importer has no representation
   * for. Qualified keys (`INSERT:nested`, `ARC:non_uniform_scale`) are entities
   * of a supported type that a specific condition made untranslatable — those
   * are the dangerous ones, and each has an accompanying issue.
   */
  readonly skipped: Readonly<Record<string, number>>;
  readonly parseMs: number;
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

/**
 * `$INSUNITS` codes that map onto a length unit the model can store.
 *
 * Codes 21 and 22 are the US survey foot and inch, which differ from the
 * international foot by 2 parts per million. Over a 200 m building that is
 * 0.4 mm — below any construction tolerance and far below the precision of the
 * drawing — so they are treated as the international units rather than raised
 * as an unresolvable unit.
 */
const INSUNITS_SUPPORTED: Readonly<Record<number, LengthUnit>> = {
  1: 'in',
  2: 'ft',
  4: 'mm',
  5: 'cm',
  6: 'm',
  21: 'ft',
  22: 'in',
};

/** `$INSUNITS` codes we recognise but cannot store, named so the issue reads sensibly. */
const INSUNITS_UNSUPPORTED: Readonly<Record<number, string>> = {
  0: 'unitless',
  3: 'miles',
  7: 'kilometres',
  8: 'microinches',
  9: 'mils',
  10: 'yards',
  11: 'angstroms',
  12: 'nanometres',
  13: 'microns',
  14: 'decimetres',
  15: 'decametres',
  16: 'hectometres',
  17: 'gigametres',
  18: 'astronomical units',
  19: 'light years',
  20: 'parsecs',
  23: 'US survey yards',
  24: 'US survey miles',
};

/** Units the extent inference will consider, largest scale factor last. */
const CANDIDATE_UNITS: readonly LengthUnit[] = ['mm', 'cm', 'in', 'ft', 'm'];

/**
 * The band a building plan's longest dimension falls in.
 *
 * Five metres is about the smallest thing anyone draws a floor plan of; two
 * hundred is a large plaza or a whole apartment block, and beyond it a drawing
 * is a site or master plan rather than the building this platform models. The
 * band is deliberately wide: its purpose is to separate scale factors that
 * differ by 10x or 25.4x, not to judge the design.
 */
const PLAN_SPAN_MIN_M = 5;
const PLAN_SPAN_MAX_M = 200;

/**
 * Anchor for ranking inferences, the geometric mean of the band (~31.6 m).
 *
 * Ranking on the log ratio to this anchor, rather than on band membership
 * alone, matters because the bands of adjacent units overlap: a drawing 150
 * units across is a plausible 150 m plan and an equally plausible 45 m plan in
 * feet. The ranking picks one to *offer*; `confident` stays false either way.
 */
const PLAN_SPAN_ANCHOR_M = Math.sqrt(PLAN_SPAN_MIN_M * PLAN_SPAN_MAX_M);

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/**
 * Cap on instances materialised from one MINSERT array.
 *
 * A rectangular array of blocks is expanded because dropping it would drop
 * whatever it contains, but `columnCount * rowCount` is two unvalidated
 * integers from an untrusted file, and a corrupted pair can ask for millions of
 * copies. Four hundred is far more instances than any plan legitimately arrays
 * of a single block, so the cap only ever fires on nonsense.
 */
const MAX_BLOCK_INSTANCES = 400;

/**
 * Tolerance for calling an INSERT's x and y scales equal.
 *
 * A circle scaled non-uniformly is an ellipse, which `ArcSegment` cannot
 * represent. One part in a thousand is far below what any drafter enters
 * deliberately and comfortably above float noise in the file's decimal text.
 */
const UNIFORM_SCALE_TOLERANCE = 1e-3;

/** Entity types the parser has handlers for; used to keep the raw scan honest. */
const PARSER_SUPPORTED_TYPES: ReadonlySet<string> = new Set([
  '3DFACE',
  'ARC',
  'ATTDEF',
  'CIRCLE',
  'DIMENSION',
  'ELLIPSE',
  'INSERT',
  'LINE',
  'LWPOLYLINE',
  'MTEXT',
  'POINT',
  'POLYLINE',
  'SOLID',
  'SPLINE',
  'TEXT',
]);

/** DXF structural keywords that appear on a group-0 line but are not entities. */
const STRUCTURAL_KEYWORDS: ReadonlySet<string> = new Set([
  'SECTION',
  'ENDSEC',
  'EOF',
  'BLOCK',
  'ENDBLK',
  'TABLE',
  'ENDTAB',
  'SEQEND',
  'VERTEX',
  'CLASS',
]);

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/** Mutable working state for one extraction. */
interface Collector {
  readonly segments: LineSegment[];
  readonly arcs: ArcSegment[];
  readonly texts: TextItem[];
  readonly skipped: Record<string, number>;
  readonly issues: ImportIssue[];
  /** Block names referenced by an INSERT nested inside another block. */
  readonly nestedBlocks: Set<string>;
  /** Block names an INSERT referenced that the file does not define. */
  readonly missingBlocks: Set<string>;
  nonFinite: number;
  degenerate: number;
  paperSpace: number;
}

/**
 * A block insertion's placement: base-point removal, scale, rotation, offset.
 *
 * Held as one flat record rather than a matrix because the arc branch needs the
 * rotation and the scale signs separately — an arc's sweep direction survives a
 * rotation but reverses under a mirror, and a matrix would have hidden that.
 */
interface Placement {
  /** Insertion point in world coordinates. */
  readonly ox: number;
  readonly oy: number;
  /** Block base point, subtracted before scaling. */
  readonly bx: number;
  readonly by: number;
  readonly sx: number;
  readonly sy: number;
  readonly rotationDeg: number;
  readonly cos: number;
  readonly sin: number;
  /** Layer of the INSERT, which layer-0 entities inside the block inherit. */
  readonly layer?: string;
}

const IDENTITY: Placement = {
  ox: 0,
  oy: 0,
  bx: 0,
  by: 0,
  sx: 1,
  sy: 1,
  rotationDeg: 0,
  cos: 1,
  sin: 0,
};

/**
 * Read a DXF into line work.
 *
 * Returns `work: null` only where the drawing cannot yield usable geometry at
 * all — an unparseable file, an empty one, or one whose extent is impossible at
 * the unit it declares. Everything softer comes back as an issue attached to a
 * result the user can still review.
 */
export function extractDxfDrawing(text: string): DxfExtraction {
  const startedAt = Date.now();
  const collector: Collector = {
    segments: [],
    arcs: [],
    texts: [],
    skipped: {},
    issues: [],
    nestedBlocks: new Set(),
    missingBlocks: new Set(),
    nonFinite: 0,
    degenerate: 0,
    paperSpace: 0,
  };

  if (text.trim() === '') {
    return failure(collector, startedAt, {
      severity: 'blocking',
      code: 'dxf_empty',
      message: 'The DXF file is empty.',
      remedy: 'Re-export the drawing from the CAD application and upload it again.',
    });
  }

  // dxf-parser throws on a truncated file, on a group code it cannot cast, and
  // on an empty scan. Files in the wild are truncated by failed uploads and
  // mangled by mixed encodings often enough that a throw here is an ordinary
  // outcome, not an exceptional one.
  let dxf: IDxf | null;
  try {
    dxf = new DxfParser().parseSync(text);
  } catch (err) {
    return failure(collector, startedAt, {
      severity: 'blocking',
      code: 'dxf_parse_failed',
      message: `The DXF file could not be read: ${err instanceof Error ? err.message : String(err)}`,
      remedy:
        'The file is most likely truncated or was saved in a format this reader does not accept. ' +
        'Re-export it as ASCII DXF (R12 or later) and upload it again.',
    });
  }

  if (dxf === null) {
    return failure(collector, startedAt, {
      severity: 'blocking',
      code: 'dxf_parse_failed',
      message: 'The DXF file could not be read.',
      remedy: 'Re-export the drawing as ASCII DXF (R12 or later) and upload it again.',
    });
  }

  const blocks = dxf.blocks ?? {};
  const entities: readonly IEntity[] = Array.isArray(dxf.entities) ? dxf.entities : [];

  if (entities.length === 0) {
    return failure(collector, startedAt, {
      severity: 'blocking',
      code: 'dxf_no_entities',
      message: 'The DXF file parsed but contains no entities in model space.',
      remedy:
        'Check that the drawing was exported from model space with its geometry visible, ' +
        'not from a layout containing only an external reference.',
    });
  }

  // Entity types with no parser handler never reach us at all, so the skipped
  // report would otherwise claim a clean sweep on a drawing whose walls are
  // HATCH fills. A cheap line scan of the source recovers those names.
  for (const [type, count] of scanUnsupportedEntityTypes(text)) {
    collector.skipped[type] = (collector.skipped[type] ?? 0) + count;
  }

  translateEntities(entities, blocks, collector, IDENTITY, 0);
  summariseLosses(collector);

  if (collector.segments.length === 0 && collector.arcs.length === 0) {
    return failure(collector, startedAt, {
      severity: 'blocking',
      code: 'dxf_no_geometry',
      message: `The drawing contains ${String(entities.length)} entities but none of them produced geometry.`,
      remedy:
        'The drawing may consist entirely of entity types this importer cannot read (hatches, splines, ' +
        'external references). Explode the drawing to lines and polylines in the CAD application, then re-export.',
    });
  }

  const extent = measureExtent(collector);
  const units = resolveUnits(dxf.header, extent, collector.issues);
  const toMmScale = toMm(1, units.unit);

  // Sanity: the whole drawing, measured in millimetres at the resolved unit.
  // Checked on the overall extent rather than on individual segments, because a
  // single long segment is legitimately a grid line, a section marker or a
  // sheet border, whereas a drawing 900 m across at its own declared unit can
  // only mean the scale was misread. Only enforced where the header stated the
  // unit: an inferred unit was already chosen to land inside the plausible
  // band, so re-checking it here would only ever restate the inference.
  if (units.confident) {
    const spanMm = toMm(Math.max(extent.maxX - extent.minX, extent.maxY - extent.minY), units.unit);
    if (spanMm > SANITY.maxWallLengthMm) {
      return failure(collector, startedAt, {
        severity: 'blocking',
        code: 'dxf_extent_implausible',
        message:
          `The drawing declares ${units.unit} but is ${(spanMm / 1000).toFixed(1)} m across, ` +
          `beyond the ${String(SANITY.maxWallLengthMm / 1000)} m limit for a single building.`,
        remedy:
          'The unit in the file header is probably wrong, or the drawing is a site plan rather than a ' +
          'building plan. Confirm the drawing unit, or import only the building.',
      });
    }
    if (spanMm < SANITY.minWallLengthMm) {
      return failure(collector, startedAt, {
        severity: 'blocking',
        code: 'dxf_extent_implausible',
        message:
          `The drawing declares ${units.unit} but is only ${spanMm.toFixed(1)} mm across, ` +
          'which is smaller than the shortest wall the model can hold.',
        remedy: 'The unit in the file header is almost certainly wrong. Confirm the drawing unit and re-import.',
      });
    }
  }

  const work: LineWork = {
    segments: collector.segments,
    arcs: collector.arcs,
    texts: collector.texts,
    extent,
    toMmScale,
    units,
    issues: collector.issues,
  };

  return {
    work,
    issues: collector.issues,
    skipped: collector.skipped,
    parseMs: Date.now() - startedAt,
  };
}

/**
 * Read a DXF into line work.
 *
 * The published entry point. `extractDxfDrawing` returns the same run with the
 * skipped-entity tally attached, which the caller needs to fill `ImportStats`.
 */
export function extractDxfLineWork(text: string): { work: LineWork | null; issues: ImportIssue[] } {
  const result = extractDxfDrawing(text);
  return { work: result.work, issues: [...result.issues] };
}

function failure(collector: Collector, startedAt: number, issue: ImportIssue): DxfExtraction {
  collector.issues.push(issue);
  return {
    work: null,
    issues: collector.issues,
    skipped: collector.skipped,
    parseMs: Date.now() - startedAt,
  };
}

// ---------------------------------------------------------------------------
// Entity translation
// ---------------------------------------------------------------------------

function translateEntities(
  entities: readonly IEntity[],
  blocks: Readonly<Record<string, unknown>>,
  out: Collector,
  place: Placement,
  depth: number,
): void {
  for (const entity of entities) {
    if (entity === null || typeof entity !== 'object') continue;
    const type = typeof entity.type === 'string' ? entity.type : 'UNKNOWN';

    // Paper space holds the sheet layout — title block, border, viewport frame —
    // drawn at sheet scale in millimetres of paper. Mixing it into model-space
    // geometry corrupts the extent that the unit inference depends on, so it is
    // excluded. Reported as info rather than review because a border in paper
    // space is the normal, correct arrangement, not a loss of building.
    if (entity.inPaperSpace === true) {
      out.paperSpace++;
      count(out, `${type}:paper_space`);
      continue;
    }

    switch (type) {
      case 'LINE':
        translateLine(entity as Loose<ILineEntity>, out, place);
        break;
      case 'LWPOLYLINE':
        translatePolyline(entity as Loose<ILwpolylineEntity>, out, place);
        break;
      case 'POLYLINE':
        translatePolyline(entity as Loose<IPolylineEntity>, out, place);
        break;
      case 'ARC':
        translateArc(entity as Loose<IArcEntity>, out, place);
        break;
      case 'CIRCLE':
        translateCircle(entity as Loose<ICircleEntity>, out, place);
        break;
      case 'TEXT':
        translateText(entity as Loose<ITextEntity>, out, place);
        break;
      case 'MTEXT':
        translateMtext(entity as Loose<IMtextEntity>, out, place);
        break;
      case 'INSERT':
        translateInsert(entity as Loose<IInsertEntity>, blocks, out, place, depth);
        break;
      default:
        count(out, type);
        break;
    }
  }
}

function translateLine(entity: Loose<ILineEntity>, out: Collector, place: Placement): void {
  const vertices = entity.vertices;
  const a = readPoint(vertices?.[0], place);
  const b = readPoint(vertices?.[1], place);
  if (a === null || b === null) {
    out.nonFinite++;
    count(out, 'LINE:malformed');
    return;
  }
  pushSegment(out, a, b, layerOf(entity, place), undefined, refOf(entity));
}

/**
 * LWPOLYLINE and POLYLINE share this path.
 *
 * They differ only in how the parser presents their vertices; both are a vertex
 * run with an optional closing edge and a per-vertex bulge. Reading them
 * through one function means the closed flag and the bulge cannot be handled
 * correctly in one and forgotten in the other.
 */
function translatePolyline(
  entity: Loose<ILwpolylineEntity> | Loose<IPolylineEntity>,
  out: Collector,
  place: Placement,
): void {
  const raw = entity.vertices;
  if (!Array.isArray(raw) || raw.length < 2) {
    out.nonFinite++;
    count(out, 'POLYLINE:malformed');
    return;
  }

  const layer = layerOf(entity, place);
  const sourceRef = refOf(entity);
  // A polyline drawn with width is very often a wall drawn as a single stroke,
  // so the width is carried through as a hint for the recogniser rather than
  // discarded. It scales with the insertion like everything else.
  const constantWidth =
    'width' in entity && typeof entity.width === 'number' && entity.width > 0 ? entity.width : undefined;

  interface Vtx {
    readonly point: Point2;
    readonly bulge: number;
    readonly width?: number;
  }
  const vertices: Vtx[] = [];
  for (const v of raw) {
    const point = readPoint(v as IPoint | undefined, place);
    if (point === null) {
      // One bad vertex, not a bad polyline: dropping the whole run would remove
      // more building than the single edge that is genuinely unreadable.
      out.nonFinite++;
      continue;
    }
    const loose = v as { bulge?: number; startWidth?: number };
    const bulge = typeof loose.bulge === 'number' && Number.isFinite(loose.bulge) ? loose.bulge : 0;
    const startWidth =
      typeof loose.startWidth === 'number' && loose.startWidth > 0 ? loose.startWidth : undefined;
    vertices.push({ point, bulge, width: constantWidth ?? startWidth });
  }

  if (vertices.length < 2) {
    count(out, 'POLYLINE:malformed');
    return;
  }

  const closed = entity.shape === true;
  const edgeCount = closed ? vertices.length : vertices.length - 1;
  for (let i = 0; i < edgeCount; i++) {
    const from = vertices[i]!;
    const to = vertices[(i + 1) % vertices.length]!;
    if (from.bulge !== 0) {
      // A bulge is an arc. Straightening it would shorten a curved wall and
      // move both of its ends, so a bulge that cannot be turned into an arc is
      // reported rather than flattened.
      const arc = arcFromBulge(from.point, to.point, from.bulge, layer, sourceRef);
      if (arc !== null) {
        out.arcs.push(arc);
        continue;
      }
      count(out, 'POLYLINE:degenerate_bulge');
      out.degenerate++;
      continue;
    }
    pushSegment(out, from.point, to.point, layer, scaleWidth(from.width, place), sourceRef);
  }
}

function translateArc(entity: Loose<IArcEntity>, out: Collector, place: Placement): void {
  const centre = readPoint(entity.center, place);
  const radius = readRadius(entity.radius, place);
  if (centre === null || radius === null) {
    out.nonFinite++;
    count(out, 'ARC:malformed');
    return;
  }
  if (radius === 0) {
    out.nonFinite++;
    count(out, 'ARC:malformed');
    return;
  }
  if (!isUniform(place)) {
    // A non-uniformly scaled circle is an ellipse, and there is no ellipse in
    // `LineWork`. Emitting the unscaled arc would put a door swing or a column
    // in the wrong place at the wrong size, so it is dropped and reported.
    count(out, 'ARC:non_uniform_scale');
    return;
  }
  // The parser converts ARC angles to radians (unlike INSERT rotation, which it
  // leaves in degrees) — an asymmetry worth naming, because getting it wrong
  // rotates every arc in the drawing by a factor of 57.
  const start = degreesFromRadians(entity.startAngle);
  const end = degreesFromRadians(entity.endAngle);
  if (start === null || end === null) {
    out.nonFinite++;
    count(out, 'ARC:malformed');
    return;
  }
  out.arcs.push(placeArc(centre, radius, start, end, layerOf(entity, place), refOf(entity), place));
}

function translateCircle(entity: Loose<ICircleEntity>, out: Collector, place: Placement): void {
  const centre = readPoint(entity.center, place);
  const radius = readRadius(entity.radius, place);
  if (centre === null || radius === null || radius === 0) {
    out.nonFinite++;
    count(out, 'CIRCLE:malformed');
    return;
  }
  if (!isUniform(place)) {
    count(out, 'CIRCLE:non_uniform_scale');
    return;
  }
  // A full circle is a 0-360 arc; the placement transform leaves that unchanged
  // whichever way it mirrors, so it is pushed directly.
  out.arcs.push({
    centre,
    radius,
    startAngleDeg: 0,
    endAngleDeg: 360,
    layer: layerOf(entity, place),
    sourceRef: refOf(entity),
  });
}

function translateText(entity: Loose<ITextEntity>, out: Collector, place: Placement): void {
  const text = typeof entity.text === 'string' ? entity.text.trim() : '';
  if (text === '') {
    count(out, 'TEXT:empty');
    return;
  }
  // For left-aligned text the position is the first alignment point; for any
  // other justification DXF puts the real position in the second one and
  // frequently leaves the first at the origin. Taking the first regardless
  // would pile every centred room label on top of the drawing origin.
  const aligned =
    (typeof entity.halign === 'number' && entity.halign !== 0) ||
    (typeof entity.valign === 'number' && entity.valign !== 0);
  const at = (aligned ? readPoint(entity.endPoint, place) : null) ?? readPoint(entity.startPoint, place);
  if (at === null) {
    out.nonFinite++;
    count(out, 'TEXT:malformed');
    return;
  }
  out.texts.push(makeText(text, at, entity.textHeight, layerOf(entity, place), place));
}

function translateMtext(entity: Loose<IMtextEntity>, out: Collector, place: Placement): void {
  const text = stripMtextFormatting(typeof entity.text === 'string' ? entity.text : '');
  if (text === '') {
    count(out, 'MTEXT:empty');
    return;
  }
  const at = readPoint(entity.position, place);
  if (at === null) {
    out.nonFinite++;
    count(out, 'MTEXT:malformed');
    return;
  }
  out.texts.push(makeText(text, at, entity.height, layerOf(entity, place), place));
}

/**
 * Expand a block reference one level.
 *
 * Blocks are how doors, windows, columns and whole repeated room modules reach
 * a drawing, so a dropped INSERT is dropped building. One level is expanded
 * here; a block referencing another block is counted and raised for review
 * rather than followed, because the deeper the nesting the more likely the
 * transform composition is to be wrong in a way nobody notices.
 */
function translateInsert(
  entity: Loose<IInsertEntity>,
  blocks: Readonly<Record<string, unknown>>,
  out: Collector,
  place: Placement,
  depth: number,
): void {
  const name = typeof entity.name === 'string' ? entity.name : '';
  if (depth > 0) {
    out.nestedBlocks.add(name === '' ? '(unnamed)' : name);
    count(out, 'INSERT:nested');
    return;
  }
  if (name === '') {
    count(out, 'INSERT:malformed');
    return;
  }

  const block = blocks[name] as { entities?: IEntity[]; position?: IPoint } | undefined;
  if (block === undefined || !Array.isArray(block.entities)) {
    // The block is referenced but not defined — typically an external reference
    // that was not bound on export. Whatever it drew is simply absent.
    out.missingBlocks.add(name);
    count(out, 'INSERT:missing_block');
    return;
  }
  if (block.entities.length === 0) return;

  const position = entity.position;
  const ox = finite(position?.x) ?? 0;
  const oy = finite(position?.y) ?? 0;
  const sx = nonZeroFinite(entity.xScale) ?? 1;
  const sy = nonZeroFinite(entity.yScale) ?? 1;
  // INSERT rotation stays in degrees in the parser's output; ARC angles do not.
  const rotationDeg = finite(entity.rotation) ?? 0;
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const base = block.position;
  const bx = finite(base?.x) ?? 0;
  const by = finite(base?.y) ?? 0;

  // MINSERT: a rectangular array of the same block. The column and row offsets
  // are applied in the block's own rotated frame, which is why they go through
  // the same rotation as the geometry.
  const columns = Math.max(1, Math.trunc(finite(entity.columnCount) ?? 1));
  const rows = Math.max(1, Math.trunc(finite(entity.rowCount) ?? 1));
  const columnSpacing = finite(entity.columnSpacing) ?? 0;
  const rowSpacing = finite(entity.rowSpacing) ?? 0;
  const instances = columns * rows;
  if (instances > MAX_BLOCK_INSTANCES) {
    count(out, 'INSERT:array_too_large');
    out.issues.push({
      severity: 'review',
      code: 'dxf_block_array_too_large',
      message: `Block "${name}" is arrayed ${String(columns)} x ${String(rows)} times, which is not credible for a floor plan.`,
      remedy:
        'The row or column count in the file is probably corrupt. Explode the array in the CAD application ' +
        'and re-export, or confirm that this many copies are intended.',
      sourceRef: refOf(entity),
    });
    return;
  }

  const layer = layerOf(entity, place);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const dx = c * columnSpacing;
      const dy = r * rowSpacing;
      const instance: Placement = {
        ox: ox + dx * cos - dy * sin,
        oy: oy + dx * sin + dy * cos,
        bx,
        by,
        sx,
        sy,
        rotationDeg,
        cos,
        sin,
        layer,
      };
      translateEntities(block.entities, blocks, out, instance, depth + 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function applyPlacement(x: number, y: number, place: Placement): Point2 {
  const lx = (x - place.bx) * place.sx;
  const ly = (y - place.by) * place.sy;
  return {
    x: place.ox + lx * place.cos - ly * place.sin,
    y: place.oy + lx * place.sin + ly * place.cos,
  };
}

function readPoint(p: IPoint | undefined, place: Placement): Point2 | null {
  if (p === undefined || p === null) return null;
  const x = finite(p.x);
  const y = finite(p.y);
  if (x === null || y === null) return null;
  return applyPlacement(x, y, place);
}

function readRadius(radius: number | undefined, place: Placement): number | null {
  const r = finite(radius);
  if (r === null || r < 0) return null;
  return r * Math.abs(place.sx);
}

function isUniform(place: Placement): boolean {
  return Math.abs(Math.abs(place.sx) - Math.abs(place.sy)) <= UNIFORM_SCALE_TOLERANCE * Math.abs(place.sx);
}

/**
 * Place an arc that is already in block coordinates into world coordinates.
 *
 * `ArcSegment` carries no direction flag, so this module adopts the DXF ARC
 * convention throughout: the sweep runs counter-clockwise from `startAngleDeg`
 * to `endAngleDeg`. A mirroring insertion (one negative scale) reverses that
 * sense, so the angles are reflected *and* swapped; a plain rotation, or a
 * uniform negative scale, is a rotation of both angles. Getting this wrong
 * produces an arc that is the complement of the one drawn — the doorway on the
 * wrong side of its wall.
 */
function placeArc(
  centre: Point2,
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number,
  layer: string,
  sourceRef: string | undefined,
  place: Placement,
): ArcSegment {
  const mirrored = place.sx * place.sy < 0;
  // diag(-s, -s) is a 180-degree rotation, so a doubly negative scale adds half
  // a turn on top of the insertion's own rotation.
  const offset = place.rotationDeg + (place.sx < 0 ? 180 : 0);
  const start = mirrored ? normaliseDegrees(-endAngleDeg + offset) : normaliseDegrees(startAngleDeg + offset);
  const end = mirrored ? normaliseDegrees(-startAngleDeg + offset) : normaliseDegrees(endAngleDeg + offset);
  return { centre, radius, startAngleDeg: start, endAngleDeg: end, layer, sourceRef };
}

/**
 * Turn a polyline bulge into an arc.
 *
 * The bulge is the tangent of a quarter of the arc's included angle, signed
 * positive for a counter-clockwise sweep from the first vertex to the second.
 * From that: the perpendicular offset from the chord's midpoint to the centre
 * is `chord * (1 - b^2) / 4b`, measured along the chord's left normal, and the
 * radius is `chord * (1 + b^2) / 4|b|`. Both fall out of `b = tan(theta/4)`
 * with the half-angle identities, and both go to infinity as the bulge goes to
 * zero — which is the straight segment the caller has already handled.
 *
 * Returns null for a zero-length chord, where the circle is undetermined.
 */
function arcFromBulge(
  a: Point2,
  b: Point2,
  bulge: number,
  layer: string,
  sourceRef: string | undefined,
): ArcSegment | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const chord = Math.hypot(dx, dy);
  if (chord === 0 || !Number.isFinite(chord)) return null;

  const offset = (chord * (1 - bulge * bulge)) / (4 * bulge);
  const centre: Point2 = {
    x: a.x + dx / 2 - (dy / chord) * offset,
    y: a.y + dy / 2 + (dx / chord) * offset,
  };
  const radius = Math.abs((chord * (1 + bulge * bulge)) / (4 * bulge));
  if (!Number.isFinite(radius) || radius === 0) return null;

  const angleA = normaliseDegrees((Math.atan2(a.y - centre.y, a.x - centre.x) * 180) / Math.PI);
  const angleB = normaliseDegrees((Math.atan2(b.y - centre.y, b.x - centre.x) * 180) / Math.PI);
  // Arcs are stored counter-clockwise, so a negative bulge is recorded by
  // exchanging its endpoints rather than by a direction flag the type lacks.
  return bulge > 0
    ? { centre, radius, startAngleDeg: angleA, endAngleDeg: angleB, layer, sourceRef }
    : { centre, radius, startAngleDeg: angleB, endAngleDeg: angleA, layer, sourceRef };
}

function pushSegment(
  out: Collector,
  a: Point2,
  b: Point2,
  layer: string,
  width: number | undefined,
  sourceRef: string | undefined,
): void {
  if (a.x === b.x && a.y === b.y) {
    // Zero-length lines are drafting residue — a double-click, a trimmed
    // remnant. Dropping one cannot lose a wall, so this is counted but does not
    // rise above info.
    out.degenerate++;
    count(out, 'LINE:degenerate');
    return;
  }
  out.segments.push(width === undefined ? { a, b, layer, sourceRef } : { a, b, layer, width, sourceRef });
}

function makeText(
  text: string,
  at: Point2,
  height: number | undefined,
  layer: string,
  place: Placement,
): TextItem {
  const h = finite(height);
  const scaled = h === null || h <= 0 ? undefined : h * averageScale(place);
  return scaled === undefined ? { text, at, layer } : { text, at, heightHint: scaled, layer };
}

/** Widths and text heights are scalars, so a non-uniform insertion averages them. */
function averageScale(place: Placement): number {
  return (Math.abs(place.sx) + Math.abs(place.sy)) / 2;
}

function scaleWidth(width: number | undefined, place: Placement): number | undefined {
  if (width === undefined) return undefined;
  return width * averageScale(place);
}

function normaliseDegrees(deg: number): number {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

function degreesFromRadians(value: number | undefined): number | null {
  const v = finite(value);
  if (v === null) return null;
  return normaliseDegrees((v * 180) / Math.PI);
}

function finite(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonZeroFinite(value: number | undefined): number | null {
  const v = finite(value);
  return v === null || v === 0 ? null : v;
}

/**
 * The layer an entity's geometry belongs to.
 *
 * Entities drawn on layer 0 inside a block take the layer of the INSERT that
 * places them — that is the DXF rule, and it is how a single door block appears
 * on A-DOOR in one drawing and on 0 in another. Carrying the wrong one would
 * throw away the strongest hint the recogniser has.
 *
 * No filtering happens on the strength of the name. Plenty of drawings put the
 * whole building on layer 0, and a recogniser that trusted layer names would
 * import nothing at all from them.
 */
function layerOf(entity: { layer?: string }, place: Placement): string {
  const own = typeof entity.layer === 'string' && entity.layer !== '' ? entity.layer : '0';
  if (own === '0' && place.layer !== undefined && place.layer !== '') return place.layer;
  return own;
}

function refOf(entity: { handle?: unknown }): string | undefined {
  const handle = entity.handle;
  if (typeof handle === 'string' && handle !== '') return handle;
  if (typeof handle === 'number' && Number.isFinite(handle)) return String(handle);
  return undefined;
}

function count(out: Collector, key: string): void {
  out.skipped[key] = (out.skipped[key] ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// MTEXT
// ---------------------------------------------------------------------------

/** Control letters that take no argument and have no terminating semicolon. */
const MTEXT_FLAG_CODES: ReadonlySet<string> = new Set(['L', 'l', 'O', 'o', 'K', 'k', 'N', 'X']);

/** Control letters whose argument runs to the next semicolon. */
const MTEXT_ARG_CODES: ReadonlySet<string> = new Set([
  'A',
  'C',
  'c',
  'F',
  'f',
  'H',
  'Q',
  'T',
  'W',
  'p',
  'S',
]);

/**
 * Strip MTEXT inline formatting.
 *
 * MTEXT stores its text with formatting interleaved: `\A1;` sets alignment,
 * `\H2.5x;` a height, `\f Arial|b1;` a font, and `{...}` groups a run. A room
 * label reaching the recogniser as `{\fArial|b0;OFFICE 1}` matches nothing, so
 * the codes come out and the words stay.
 *
 * This is not a full MTEXT parser and does not try to be. It removes the codes
 * that carry no text and keeps everything else, so that the worst case is a
 * label with a stray character in it rather than a label with its text eaten.
 */
export function stripMtextFormatting(raw: string): string {
  if (raw === '') return '';
  let out = '';

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;

    // Braces group a formatting run and carry no text of their own. An escaped
    // brace is handled below, before control lookup, so a literal one survives.
    if (ch === '{' || ch === '}') continue;

    if (ch === '%' && raw[i + 1] === '%') {
      // The pre-Unicode symbol escapes, still emitted by older drawings.
      const symbol = raw[i + 2];
      if (symbol === 'd' || symbol === 'D') { out += '°'; i += 2; continue; }
      if (symbol === 'c' || symbol === 'C') { out += 'ø'; i += 2; continue; }
      if (symbol === 'p' || symbol === 'P') { out += '±'; i += 2; continue; }
      // Underline, overline and strike toggles: styling with no character.
      if (symbol === 'u' || symbol === 'U' || symbol === 'o' || symbol === 'O' || symbol === 'k' || symbol === 'K') {
        i += 2;
        continue;
      }
      out += ch;
      continue;
    }

    if (ch !== '\\') {
      out += ch;
      continue;
    }

    const next = raw[i + 1];
    if (next === undefined) break; // Trailing backslash: nothing it could escape.

    if (next === '\\' || next === '{' || next === '}') {
      out += next;
      i++;
      continue;
    }
    if (next === 'P') {
      out += '\n';
      i++;
      continue;
    }
    if (next === '~') {
      out += ' ';
      i++;
      continue;
    }
    if (MTEXT_FLAG_CODES.has(next)) {
      // Consumed before the argument-bearing codes below, because `\L` has no
      // terminator: reading it as an argument code would swallow the sentence
      // after it up to the first semicolon.
      i++;
      continue;
    }
    if (MTEXT_ARG_CODES.has(next)) {
      const end = raw.indexOf(';', i + 2);
      if (end === -1) {
        // Unterminated code — drop the two control characters and keep the
        // rest. Losing a label's text is worse than keeping a stray argument.
        i++;
        continue;
      }
      if (next === 'S') {
        // Stacked text: `\S1^2;` is a fraction, and the numbers in it are real
        // content (a door schedule reads "1/2"), so it is flattened, not cut.
        out += raw.slice(i + 2, end).replace(/[\^#]/g, '/');
      }
      i = end;
      continue;
    }

    // An escape this function does not know. Keeping the backslash is the safe
    // choice: it makes an unhandled code visible instead of eating text.
    out += ch;
  }

  return out.trim();
}

// ---------------------------------------------------------------------------
// Extent and units
// ---------------------------------------------------------------------------

function measureExtent(out: Collector): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = (x: number, y: number): void => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  for (const s of out.segments) {
    include(s.a.x, s.a.y);
    include(s.b.x, s.b.y);
  }
  for (const a of out.arcs) {
    // The arc's full circle rather than its swept extremes. It over-states the
    // extent of a minor arc by less than its radius, which for the arcs that
    // appear on a plan — door swings, column edges — is under a metre, far
    // below the resolution the unit inference works at.
    include(a.centre.x - a.radius, a.centre.y - a.radius);
    include(a.centre.x + a.radius, a.centre.y + a.radius);
  }
  // Text positions are deliberately excluded: a stray label or a legend parked
  // off to one side would inflate the extent and, with it, corrupt the unit
  // inference that depends on the extent being the building.
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/**
 * Resolve the drawing unit.
 *
 * The header is believed where it says something usable; `$INSUNITS` is an
 * explicit, unambiguous statement by the authoring tool, which is what
 * `verified`-grade provenance means downstream. Everything else is an offer,
 * never an application: `confident` stays false, and the note says what was
 * inferred and from what, so the user is confirming a stated proposition rather
 * than approving a number that appeared from nowhere.
 */
function resolveUnits(
  header: Readonly<Record<string, unknown>> | undefined,
  extent: { minX: number; minY: number; maxX: number; maxY: number },
  issues: ImportIssue[],
): UnitResolution {
  const raw = header?.['$INSUNITS'];
  const code = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;

  if (code !== null) {
    const unit = INSUNITS_SUPPORTED[code];
    if (unit !== undefined) {
      return {
        unit,
        source: 'file_header',
        confident: true,
        note: `$INSUNITS = ${String(code)} in the file header, which is ${unit}.`,
      };
    }
    if (code !== 0) {
      const name = INSUNITS_UNSUPPORTED[code] ?? 'an unrecognised unit';
      issues.push({
        severity: 'review',
        code: 'dxf_unsupported_unit_code',
        message: `The file header declares $INSUNITS = ${String(code)} (${name}), which is not a unit a building is drawn in.`,
        remedy: 'Confirm the drawing unit before the geometry is used, or re-export the drawing in millimetres.',
      });
    }
  }

  return inferUnitsFromExtent(extent, code, issues);
}

/**
 * Offer a unit based on how large the drawing would be if each were true.
 *
 * The reasoning is the one a person uses on an unlabelled drawing: a floor plan
 * is a building, buildings are between about 5 and 200 m across, so a drawing
 * 42,000 units wide is in millimetres and one 42 units wide is in metres. It is
 * a genuinely good inference and it is still never applied on its own, because
 * the bands overlap — 60 units is a believable 60 m plan and an equally
 * believable 18 m plan in feet — and because the cost of being wrong is a
 * building scaled by 25.4 that looks entirely normal.
 */
function inferUnitsFromExtent(
  extent: { minX: number; minY: number; maxX: number; maxY: number },
  code: number | null,
  issues: ImportIssue[],
): UnitResolution {
  const span = Math.max(extent.maxX - extent.minX, extent.maxY - extent.minY);
  const stated = code === 0 ? 'The file header declares $INSUNITS = 0 (unitless).' : 'The file header states no drawing unit.';

  if (!Number.isFinite(span) || span <= 0) {
    issues.push({
      severity: 'blocking',
      code: 'dxf_units_unknown',
      message: `${stated} The drawing has no measurable extent, so the unit cannot be inferred either.`,
      remedy: 'Set the drawing units in the CAD application before exporting, or supply the unit manually.',
    });
    return {
      unit: 'mm',
      source: 'unknown',
      confident: false,
      note: `${stated} No extent was available to infer from; millimetres is a placeholder, not a measurement.`,
    };
  }

  const candidates = CANDIDATE_UNITS.map((unit) => {
    const metres = toMm(span, unit) / 1000;
    return {
      unit,
      metres,
      plausible: metres >= PLAN_SPAN_MIN_M && metres <= PLAN_SPAN_MAX_M,
      // Ranked on the log ratio so that being 10x too big and 10x too small
      // are penalised equally; a linear distance would always prefer the
      // smaller unit.
      distance: Math.abs(Math.log(metres / PLAN_SPAN_ANCHOR_M)),
    };
  }).sort((a, b) => a.distance - b.distance);

  const best = candidates[0]!;
  const sizes = candidates
    .slice()
    .sort((a, b) => a.metres - b.metres)
    .map((c) => `${c.unit}: ${formatMetres(c.metres)} m`)
    .join(', ');
  const basis =
    `The drawing is ${formatSpan(span)} units across. Read as ${best.unit} that is a building ` +
    `${formatMetres(best.metres)} m across, which is a plausible floor plan ` +
    `(a building plan is typically ${String(PLAN_SPAN_MIN_M)}-${String(PLAN_SPAN_MAX_M)} m across). ` +
    `The alternatives would give — ${sizes}.`;

  if (!best.plausible) {
    issues.push({
      severity: 'blocking',
      code: 'dxf_units_uninferable',
      message:
        `${stated} No standard drawing unit makes this drawing building-sized: it is ` +
        `${formatSpan(span)} units across, giving ${sizes}.`,
      remedy:
        'Set the drawing units in the CAD application and re-export, or state the real distance between two ' +
        'known points so the scale can be calibrated.',
    });
    return {
      unit: best.unit,
      source: 'unknown',
      confident: false,
      note: `${stated} ${basis} None of these is a credible building, so the unit is unresolved.`,
    };
  }

  issues.push({
    severity: 'review',
    code: 'dxf_units_inferred',
    message: `${stated} ${basis}`,
    remedy:
      `Confirm that the drawing is in ${best.unit} before the geometry is used. ` +
      'Nothing has been scaled on the strength of this inference.',
  });
  return {
    unit: best.unit,
    source: 'inferred_from_extent',
    confident: false,
    note: `${stated} ${basis} Unconfirmed.`,
  };
}

function formatMetres(metres: number): string {
  return metres >= 100 ? metres.toFixed(0) : metres.toFixed(1);
}

function formatSpan(span: number): string {
  return span >= 100 ? span.toFixed(0) : span.toPrecision(3);
}

// ---------------------------------------------------------------------------
// Loss reporting
// ---------------------------------------------------------------------------

/**
 * Turn the tallies into issues.
 *
 * Aggregated rather than per-entity: a drawing with four hundred splines should
 * produce one issue saying so, not four hundred that bury the one about the
 * missing block. Severity follows what the loss can cost — a dropped block or
 * an unreadable coordinate can remove a wall, a dropped zero-length line
 * cannot.
 */
function summariseLosses(out: Collector): void {
  if (out.nestedBlocks.size > 0) {
    const names = [...out.nestedBlocks].sort().slice(0, 8).join(', ');
    out.issues.push({
      severity: 'review',
      code: 'dxf_nested_blocks_skipped',
      message:
        `${String(out.skipped['INSERT:nested'] ?? 0)} block references nested inside other blocks were not expanded ` +
        `(${names}${out.nestedBlocks.size > 8 ? ', …' : ''}). Anything they drew is missing from the import.`,
      remedy:
        'Explode nested blocks in the CAD application and re-export, then check the imported plan against the ' +
        'drawing for missing walls.',
    });
  }

  if (out.missingBlocks.size > 0) {
    const names = [...out.missingBlocks].sort().slice(0, 8).join(', ');
    out.issues.push({
      severity: 'review',
      code: 'dxf_missing_block_definition',
      message:
        `${String(out.missingBlocks.size)} block reference(s) point at definitions the file does not contain ` +
        `(${names}${out.missingBlocks.size > 8 ? ', …' : ''}).`,
      remedy:
        'These are usually unbound external references. Bind or explode the references in the CAD application ' +
        'and re-export.',
    });
  }

  const nonUniform =
    (out.skipped['ARC:non_uniform_scale'] ?? 0) + (out.skipped['CIRCLE:non_uniform_scale'] ?? 0);
  if (nonUniform > 0) {
    out.issues.push({
      severity: 'review',
      code: 'dxf_arc_non_uniform_scale',
      message:
        `${String(nonUniform)} arc(s) or circle(s) sit inside blocks inserted with different X and Y scales. ` +
        'A circle scaled that way is an ellipse, which this importer cannot represent, so they were not imported.',
      remedy: 'Explode the affected blocks in the CAD application and re-export, or redraw the curves at true scale.',
    });
  }

  if (out.nonFinite > 0) {
    out.issues.push({
      severity: 'review',
      code: 'dxf_unreadable_coordinates',
      message: `${String(out.nonFinite)} entit(ies) or vertices had missing or non-numeric coordinates and were dropped.`,
      remedy:
        'The file is probably damaged. Re-export it and compare the imported plan against the drawing for missing ' +
        'geometry before accepting the import.',
    });
  }

  if (out.degenerate > 0) {
    out.issues.push({
      severity: 'info',
      code: 'dxf_degenerate_segments',
      message: `${String(out.degenerate)} zero-length segment(s) were dropped.`,
    });
  }

  if (out.paperSpace > 0) {
    out.issues.push({
      severity: 'info',
      code: 'dxf_paper_space_ignored',
      message:
        `${String(out.paperSpace)} entit(ies) in paper space (sheet border, title block, viewport frames) were ignored.`,
      remedy: 'If the building itself was drawn in a layout rather than in model space, re-export it from model space.',
    });
  }

  const untranslated = Object.entries(out.skipped)
    .filter(([key]) => !key.includes(':'))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (untranslated.length > 0) {
    const total = untranslated.reduce((sum, [, n]) => sum + n, 0);
    out.issues.push({
      severity: 'review',
      code: 'dxf_untranslated_entities',
      message:
        `${String(total)} entit(ies) of types this importer does not read were skipped: ` +
        `${untranslated.map(([type, n]) => `${type} x${String(n)}`).join(', ')}.`,
      remedy:
        'Walls drawn as hatches, splines or solids will not appear. Check the imported plan against the drawing, ' +
        'and if geometry is missing, convert those entities to lines or polylines and re-export.',
    });
  }
}

/**
 * Count entity types the parser has no handler for.
 *
 * Types the parser cannot read never appear in its output at all, so the
 * skipped report built from parsed entities would give a drawing whose walls
 * are HATCH fills a clean bill of health. DXF is strictly line-oriented — a
 * group code on one line, its value on the next — so a direct scan for
 * `0`-coded values inside the entity-bearing sections recovers the names
 * cheaply and without a second parser.
 */
function scanUnsupportedEntityTypes(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  const lines = text.split(/\r\n|\r|\n/g);
  let section = '';
  for (let i = 0; i + 1 < lines.length; i++) {
    const code = lines[i]!.trim();
    if (code !== '0' && code !== '2') continue;
    const value = lines[i + 1]!.trim();
    if (code === '2') {
      // A section name only ever follows the `0 SECTION` pair that precedes it.
      if (i >= 2 && lines[i - 2]!.trim() === '0' && lines[i - 1]!.trim() === 'SECTION') section = value;
      continue;
    }
    if (value === 'SECTION') continue;
    if (section !== 'ENTITIES' && section !== 'BLOCKS') continue;
    if (STRUCTURAL_KEYWORDS.has(value)) continue;
    if (PARSER_SUPPORTED_TYPES.has(value)) continue;
    if (value === '') continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}
