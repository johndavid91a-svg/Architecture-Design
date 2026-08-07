/**
 * DRAWING IMPORT — shared contract.
 *
 * Both importers (IFC and DXF) produce the same thing: a *candidate* twin plus
 * a list of things a human must confirm. Neither produces an architecture layer
 * directly, and that separation is the whole design.
 *
 * The reason is the same one that shapes the pricing engine. A vectoriser
 * reading fifty dimensions off a drawing will read some of them wrong, and a
 * wrong wall is indistinguishable from a right one once it is in the model —
 * except that every quantity and every cost derived from it is now wrong too.
 * So extraction produces a proposal with its uncertainty attached, and the user
 * confirms it before it becomes the master record.
 *
 * IFC and DXF sit at opposite ends of that uncertainty. IFC carries walls and
 * spaces as *entities* with explicit dimensions, so most of what comes out is
 * `verified`. DXF carries lines and text, so walls have to be *inferred* from
 * parallel line pairs and rooms from closed regions — everything from DXF is
 * `extracted` and needs review.
 */

import type {
  DimensionConfidence,
  Opening,
  OpeningKind,
  Point2,
  Room,
  RoomUse,
  Wall,
  WallFunction,
} from '../model/architecture.js';
import type { Millimetres } from '../units.js';

export type ImportFormat = 'ifc' | 'dxf';

/** A wall as extracted, before it becomes part of the twin. */
export interface CandidateWall {
  readonly start: Point2;
  readonly end: Point2;
  readonly thickness: Millimetres;
  readonly height: Millimetres;
  readonly function: WallFunction;
  readonly loadBearing: boolean;
  readonly confidence: DimensionConfidence;
  /** Which source element this came from — an IFC GlobalId, a DXF handle. */
  readonly sourceRef?: string;
  /** Free text shown next to the item during review. */
  readonly note?: string;
  readonly openings: readonly CandidateOpening[];
}

export interface CandidateOpening {
  readonly kind: OpeningKind;
  readonly distanceAlongWall: Millimetres;
  readonly width: Millimetres;
  readonly height: Millimetres;
  readonly sillHeight: Millimetres;
  readonly confidence: DimensionConfidence;
  readonly sourceRef?: string;
  readonly note?: string;
}

export interface CandidateRoom {
  readonly name: string;
  readonly use: RoomUse;
  readonly boundary: readonly Point2[];
  readonly clearHeight: Millimetres;
  readonly confidence: DimensionConfidence;
  readonly sourceRef?: string;
  readonly note?: string;
}

export interface CandidateFloor {
  readonly name: string;
  readonly level: number;
  readonly elevation: Millimetres;
  readonly floorToFloor: Millimetres;
  readonly clearHeight: Millimetres;
  readonly confidence: DimensionConfidence;
  readonly sourceRef?: string;
  readonly rooms: readonly CandidateRoom[];
  readonly walls: readonly CandidateWall[];
}

/**
 * Something the importer could not settle on its own.
 *
 * Blocking issues stop the import; the rest are shown for review. The
 * distinction matters: a drawing with no discernible unit scale cannot produce
 * a usable model at all, whereas a room with no name is merely untidy.
 */
export interface ImportIssue {
  readonly severity: 'blocking' | 'review' | 'info';
  readonly code: string;
  readonly message: string;
  /** What the user should do about it. */
  readonly remedy?: string;
  readonly sourceRef?: string;
}

/**
 * Unit resolution.
 *
 * DXF stores a units code in its header that authoring tools frequently leave
 * as "unitless". Guessing wrong scales the entire building by 25.4 or 1000, and
 * the result still looks like a plausible plan — just of a different building.
 * So the resolved unit and how confident we are in it travel with the result,
 * and an unconfident one is a blocking issue the user resolves.
 */
export interface UnitResolution {
  readonly unit: 'mm' | 'cm' | 'm' | 'in' | 'ft';
  readonly source: 'file_header' | 'inferred_from_extent' | 'user_specified' | 'unknown';
  readonly confident: boolean;
  readonly note: string;
}

export interface ImportResultOk {
  readonly ok: true;
  readonly format: ImportFormat;
  readonly units: UnitResolution;
  readonly floors: readonly CandidateFloor[];
  readonly issues: readonly ImportIssue[];
  readonly stats: ImportStats;
}

export interface ImportResultFailed {
  readonly ok: false;
  readonly format: ImportFormat;
  readonly issues: readonly ImportIssue[];
}

export type DrawingImportResult = ImportResultOk | ImportResultFailed;

export interface ImportStats {
  readonly floorCount: number;
  readonly roomCount: number;
  readonly wallCount: number;
  readonly openingCount: number;
  /** Entities the parser saw but did not translate, by type. */
  readonly skipped: Readonly<Record<string, number>>;
  readonly parseMs: number;
}

/** Convenience: is anything in this result unconfirmed? */
export function needsReview(result: DrawingImportResult): boolean {
  if (!result.ok) return true;
  if (result.issues.some((i) => i.severity !== 'info')) return true;
  return result.floors.some(
    (f) =>
      f.confidence === 'extracted' ||
      f.confidence === 'inferred' ||
      f.rooms.some((r) => r.confidence === 'extracted' || r.confidence === 'inferred') ||
      f.walls.some((w) => w.confidence === 'extracted' || w.confidence === 'inferred'),
  );
}

export function countUnconfirmed(result: DrawingImportResult): number {
  if (!result.ok) return 0;
  let n = 0;
  for (const f of result.floors) {
    if (f.confidence === 'extracted' || f.confidence === 'inferred') n++;
    for (const r of f.rooms) if (r.confidence === 'extracted' || r.confidence === 'inferred') n++;
    for (const w of f.walls) {
      if (w.confidence === 'extracted' || w.confidence === 'inferred') n++;
      for (const o of w.openings) {
        if (o.confidence === 'extracted' || o.confidence === 'inferred') n++;
      }
    }
  }
  return n;
}

/**
 * Sanity limits.
 *
 * A drawing that produces a 900 m wall or a 4 mm room has been misread —
 * usually a unit-scale error. Catching it here turns a silently wrong building
 * into a blocking issue with a comprehensible message.
 */
export const SANITY = {
  minWallLengthMm: 100,
  maxWallLengthMm: 500_000, // 500 m
  minWallThicknessMm: 40,
  maxWallThicknessMm: 2_000,
  minRoomAreaMm2: 1_000_000, // 1 m²
  maxRoomAreaMm2: 100_000_000_000, // 100,000 m²
  minStoreyHeightMm: 1_800,
  maxStoreyHeightMm: 20_000,
  /**
   * How large the whole drawing must measure once scaled before it can be a
   * building at all. The smallest habitable room is around 1.2 x 2.1 m, and
   * with walls around it no real plan is under 3 m across. A drawing that comes
   * out smaller than this has been read at the wrong scale, and every dimension
   * taken from it would be wrong by the same factor.
   */
  minDrawingExtentMm: 3_000,
  /** Beyond this it is a site or survey plan, or the units are out by 1000. */
  maxDrawingExtentMm: 5_000_000, // 5 km
} as const;

/** Element type names the importers recognise, for the skipped-entity report. */
export type ElementRole = 'wall' | 'room' | 'door' | 'window' | 'storey' | 'column' | 'slab' | 'other';

// ---------------------------------------------------------------------------
// Line work — the common intermediate for drawing formats
// ---------------------------------------------------------------------------

/**
 * PDF and DXF both hand us the same thing: line segments, arcs and positioned
 * text in some page or drawing coordinate system. Neither knows what a wall is.
 *
 * So both reduce to `LineWork`, and one recognition pass turns line work into
 * walls and rooms. That keeps the hard, error-prone geometry in exactly one
 * place instead of two subtly different copies, and it means a fix to the
 * wall-pairing heuristic improves both formats at once.
 *
 * IFC does NOT go through here. IFC carries walls and spaces as entities with
 * explicit dimensions, and running them back through a recogniser would throw
 * away certainty we already have.
 */
export interface LineSegment {
  readonly a: Point2;
  readonly b: Point2;
  /** Source layer (DXF) or a synthetic layer per stroke style (PDF). */
  readonly layer?: string;
  /** Stroke width in source units, where the format records it. */
  readonly width?: number;
  readonly sourceRef?: string;
}

export interface ArcSegment {
  readonly centre: Point2;
  readonly radius: number;
  readonly startAngleDeg: number;
  readonly endAngleDeg: number;
  readonly layer?: string;
  readonly sourceRef?: string;
}

export interface TextItem {
  readonly text: string;
  readonly at: Point2;
  readonly heightHint?: number;
  readonly layer?: string;
}

export interface LineWork {
  readonly segments: readonly LineSegment[];
  readonly arcs: readonly ArcSegment[];
  readonly texts: readonly TextItem[];
  /** Bounding box of everything, in source units. */
  readonly extent: { minX: number; minY: number; maxX: number; maxY: number };
  /**
   * Multiplier from source units to millimetres.
   *
   * For DXF this comes from the header units code where present. For PDF it
   * comes from calibration — a page is in points and says nothing about how
   * many millimetres of building a point represents.
   */
  readonly toMmScale: number;
  readonly units: UnitResolution;
  /** A page or layout name, used to label the floor it becomes. */
  readonly sheetName?: string;
  readonly issues: readonly ImportIssue[];
}

/**
 * Scale calibration for a PDF.
 *
 * The crux of PDF import: page coordinates are in points and carry no building
 * scale. Three ways to resolve it, in descending order of reliability —
 *
 *   `known_distance` — the user picks two points and types the real distance
 *   between them. This is how professional PDF takeoff tools work, and it is
 *   the only method that cannot be defeated by a drawing that was printed to a
 *   non-standard size.
 *
 *   `dimension_text` — a dimension string such as 15'-0" is matched to the
 *   distance between the extension lines it annotates. Automatic, and usually
 *   right, but silently wrong if it latches onto the wrong pair of lines.
 *
 *   `stated_scale` — a "1:100" note plus the page size. Fails whenever the PDF
 *   was scaled on export or print, which is common.
 */
export interface ScaleCalibration {
  readonly method: 'known_distance' | 'dimension_text' | 'stated_scale';
  /** Distance in page units between the two calibration points. */
  readonly pageDistance: number;
  /** What that distance is in millimetres in the real building. */
  readonly realDistanceMm: number;
  readonly confident: boolean;
  readonly note: string;
}

export function scaleFromCalibration(c: ScaleCalibration): number {
  if (c.pageDistance <= 0) return 0;
  return c.realDistanceMm / c.pageDistance;
}

/** Materialise candidates into real domain objects. Ids are minted by the caller. */
export interface Materialised {
  readonly rooms: readonly Room[];
  readonly walls: readonly Wall[];
  readonly openings: readonly Opening[];
}
