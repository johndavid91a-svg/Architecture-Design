/**
 * IFC IMPORT.
 *
 * The highest-fidelity way into the twin. IFC carries walls, spaces and storeys
 * as *entities* with names, elevations and explicit geometry, so most of what
 * comes out is `verified` rather than `extracted` — unlike PDF or DXF, where a
 * wall has to be inferred from a pair of lines that might equally be a kerb.
 *
 * The geometry is read through web-ifc's evaluated meshes rather than by walking
 * representation items. That is a deliberate trade. Walking the representations
 * would give exact centrelines and profile widths, but it means reimplementing
 * IFC's geometry kernel — extruded solids, boolean clipping, mapped items,
 * swept discrete solids — across IFC2X3 and IFC4, for every authoring tool's
 * particular dialect. web-ifc already does that, correctly, and the footprint of
 * an evaluated wall gives its centreline and thickness to well under a
 * millimetre. Where a derivation is geometric rather than declared, the result
 * is marked `extracted` so the distinction survives into the model.
 *
 * Everything here is async and stateful in the WASM heap. Every model that is
 * opened is closed in a `finally`, because a leaked model is a leaked megabyte
 * of heap per import and the process is long-lived.
 */

import type {
  CandidateFloor,
  CandidateOpening,
  CandidateRoom,
  CandidateWall,
  ImportIssue,
  ImportStats,
  UnitResolution,
} from './contract.js';
import { SANITY } from './contract.js';
import type { Point2, RoomUse } from '../model/architecture.js';
import {
  axisCentreline,
  declaredThicknessMap,
  hasAxisRepresentation,
  profileOutline,
  type IfcReader,
} from './ifc-geometry.js';

/** Minimal shape of the bits of the web-ifc API this module uses. */
interface IfcApiLike {
  SetWasmPath(path: string, absolute: boolean): void;
  Init(): Promise<void>;
  OpenModel(data: Uint8Array, settings?: Record<string, unknown>): number;
  CloseModel(modelId: number): void;
  GetModelSchema(modelId: number): string;
  GetLine(modelId: number, expressId: number, flatten?: boolean): Record<string, unknown>;
  GetLineIDsWithType(modelId: number, type: number): { size(): number; get(i: number): number };
  GetFlatMesh(modelId: number, expressId: number): FlatMeshLike;
  GetGeometry(modelId: number, geometryExpressId: number): GeometryLike;
  GetVertexArray(pointer: number, size: number): Float32Array;
  GetIndexArray(pointer: number, size: number): Uint32Array;
}

interface FlatMeshLike {
  expressID: number;
  geometries: { size(): number; get(i: number): PlacedGeometryLike };
}

interface PlacedGeometryLike {
  geometryExpressID: number;
  flatTransformation: number[];
}

interface GeometryLike {
  GetVertexData(): number;
  GetVertexDataSize(): number;
  GetIndexData(): number;
  GetIndexDataSize(): number;
  delete?(): void;
}

export interface IfcImportOptions {
  /** Absolute directory holding web-ifc's .wasm files, with a trailing slash. */
  readonly wasmPath: string;
  /** Supplied by the host so this module never imports web-ifc itself. */
  readonly api: IfcApiLike;
  readonly constants: IfcConstants;
  /** Storeys above this many are skipped; guards against a corrupt file. */
  readonly maxStoreys?: number;
}

/** Entity type numbers, passed in so this module has no direct web-ifc import. */
export interface IfcConstants {
  readonly IFCUNITASSIGNMENT: number;
  readonly IFCBUILDINGSTOREY: number;
  readonly IFCSPACE: number;
  readonly IFCWALL: number;
  readonly IFCWALLSTANDARDCASE: number;
  readonly IFCDOOR: number;
  readonly IFCWINDOW: number;
  readonly IFCCOLUMN: number;
  readonly IFCSTAIR: number;
  readonly IFCSLAB: number;
  readonly IFCRELCONTAINEDINSPATIALSTRUCTURE: number;
  readonly IFCRELAGGREGATES: number;
  readonly IFCRELASSOCIATESMATERIAL: number;
}

export interface IfcImportResult {
  readonly floors: readonly CandidateFloor[];
  readonly units: UnitResolution;
  readonly issues: readonly ImportIssue[];
  readonly stats: ImportStats;
  readonly schema: string;
}

// ---------------------------------------------------------------------------
// IFC value unwrapping
// ---------------------------------------------------------------------------

/**
 * Pull a plain value out of web-ifc's typed wrapper.
 *
 * Reals arrive as `{ type: 4, _internalValue: "0.", _representationValue: 0 }`
 * and strings as `{ type: 1, value: "Level 1" }`. The `_internalValue` is the
 * literal text from the file, which matters: a value written as `.` or `1.E1`
 * parses differently from its representation, and trusting only one of the two
 * fields loses values in files from at least one common authoring tool.
 */
function unwrap(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') return value;

  const v = value as Record<string, unknown>;
  if ('_representationValue' in v && typeof v['_representationValue'] === 'number') {
    return v['_representationValue'];
  }
  if ('_internalValue' in v) {
    const raw = v['_internalValue'];
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'string') {
      const parsed = Number(raw.replace(/\.$/, ''));
      return Number.isFinite(parsed) ? parsed : raw;
    }
  }
  if ('value' in v) return v['value'];
  return null;
}

function asString(value: unknown): string | null {
  const raw = unwrap(value);
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
}

function asNumber(value: unknown): number | null {
  const raw = unwrap(value);
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/** Express ids referenced by a property, whether single or a list. */
function refIds(value: unknown): number[] {
  if (value === null || value === undefined) return [];
  const list = Array.isArray(value) ? value : [value];
  const ids: number[] = [];
  for (const item of list) {
    if (typeof item === 'number') ids.push(item);
    else if (item && typeof item === 'object' && 'value' in (item as Record<string, unknown>)) {
      const v = (item as Record<string, unknown>)['value'];
      if (typeof v === 'number') ids.push(v);
    }
  }
  return ids;
}

function typeIds(api: IfcApiLike, modelId: number, type: number): number[] {
  try {
    const vector = api.GetLineIDsWithType(modelId, type);
    const size = vector.size();
    const out: number[] = new Array(size);
    for (let i = 0; i < size; i++) out[i] = vector.get(i);
    return out;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

const SI_PREFIX_TO_METRES: Record<string, number> = {
  KILO: 1000,
  HECTO: 100,
  DECA: 10,
  DECI: 0.1,
  CENTI: 0.01,
  MILLI: 0.001,
  MICRO: 1e-6,
};

/**
 * Resolve the file's length unit.
 *
 * IFC states it, so this is a read rather than a guess — and if it cannot be
 * read the import is blocked rather than defaulted. Assuming metres for a file
 * authored in millimetres produces a building a thousand times too large, which
 * every downstream sanity check would catch, but assuming millimetres for a
 * file in metres produces one a thousand times too small, which is subtler and
 * lands as a plausible-looking cupboard.
 */
function resolveUnits(
  api: IfcApiLike,
  modelId: number,
  constants: IfcConstants,
): { units: UnitResolution; toMm: number; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];

  for (const id of typeIds(api, modelId, constants.IFCUNITASSIGNMENT)) {
    let assignment: Record<string, unknown>;
    try {
      assignment = api.GetLine(modelId, id, true);
    } catch {
      continue;
    }

    const units = assignment['Units'];
    if (!Array.isArray(units)) continue;

    for (const entry of units as Array<Record<string, unknown>>) {
      if (!entry || typeof entry !== 'object') continue;
      if (asString(entry['UnitType']) !== 'LENGTHUNIT') continue;

      const name = asString(entry['Name']);
      const prefix = asString(entry['Prefix']);

      if (name === 'METRE') {
        const metres = prefix ? (SI_PREFIX_TO_METRES[prefix] ?? null) : 1;
        if (metres === null) {
          issues.push({
            severity: 'blocking',
            code: 'UNIT_PREFIX',
            message: `The file declares an unrecognised SI prefix "${prefix}" on its length unit.`,
            remedy: 'Re-export the model in metres or millimetres.',
          });
          continue;
        }
        return {
          units: {
            unit: metres === 0.001 ? 'mm' : metres === 0.01 ? 'cm' : 'm',
            source: 'file_header',
            confident: true,
            note: `IFCSIUNIT LENGTHUNIT ${prefix ?? ''}METRE`,
          },
          toMm: metres * 1000,
          issues,
        };
      }

      // A conversion-based unit: inches and feet appear in models from US tools.
      const conversion = entry['ConversionFactor'];
      if (conversion && typeof conversion === 'object') {
        const factor = asNumber((conversion as Record<string, unknown>)['ValueComponent']);
        if (factor !== null && factor > 0) {
          return {
            units: {
              unit: Math.abs(factor - 0.0254) < 1e-6 ? 'in' : Math.abs(factor - 0.3048) < 1e-6 ? 'ft' : 'm',
              source: 'file_header',
              confident: true,
              note: `IFCCONVERSIONBASEDUNIT, ${factor} m per unit`,
            },
            toMm: factor * 1000,
            issues,
          };
        }
      }
    }
  }

  issues.push({
    severity: 'blocking',
    code: 'UNIT_UNREADABLE',
    message: 'The file does not declare a readable length unit.',
    remedy:
      'Re-export the model with a unit assignment, or import it as DXF and calibrate the scale by hand.',
  });
  return {
    units: { unit: 'm', source: 'unknown', confident: false, note: 'No IFCUNITASSIGNMENT found.' },
    toMm: 0,
    issues,
  };
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

interface Triangle {
  readonly a: [number, number, number];
  readonly b: [number, number, number];
  readonly c: [number, number, number];
}

/**
 * Evaluated triangles for one element, already placed in world coordinates.
 *
 * web-ifc interleaves position and normal, six floats per vertex, and hands
 * back a column-major 4x4 for the placement.
 */
function elementTriangles(api: IfcApiLike, modelId: number, expressId: number): Triangle[] {
  const triangles: Triangle[] = [];
  let mesh: FlatMeshLike;
  try {
    mesh = api.GetFlatMesh(modelId, expressId);
  } catch {
    return triangles;
  }

  const count = mesh.geometries.size();
  for (let g = 0; g < count; g++) {
    const placed = mesh.geometries.get(g);
    const m = placed.flatTransformation;
    let geometry: GeometryLike;
    try {
      geometry = api.GetGeometry(modelId, placed.geometryExpressID);
    } catch {
      continue;
    }

    try {
      const verts = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
      const indices = api.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());

      const at = (index: number): [number, number, number] => {
        const o = index * 6;
        const x = verts[o] ?? 0;
        const y = verts[o + 1] ?? 0;
        const z = verts[o + 2] ?? 0;
        // Column-major 4x4, as three.js and web-ifc both use.
        const wx = (m[0] ?? 1) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z + (m[12] ?? 0);
        const wy = (m[1] ?? 0) * x + (m[5] ?? 1) * y + (m[9] ?? 0) * z + (m[13] ?? 0);
        const wz = (m[2] ?? 0) * x + (m[6] ?? 0) * y + (m[10] ?? 1) * z + (m[14] ?? 0);

        // web-ifc hands back meshes in the Y-UP frame renderers want, not the
        // Z-up frame IFC stores. Converting back here is not cosmetic: read as
        // Z-up, a room's ceiling height is mistaken for its depth, and every
        // area is wrong. Measured against the quantities the files declare, a
        // bedroom came out at 10.1 m² instead of 22.1 — and the error is not a
        // constant factor, so nothing downstream could have caught it.
        //
        // Verified against AC20-FZK-Haus: with this conversion the imported
        // areas match the declared Qto_SpaceBaseQuantities exactly.
        return [wx, -wz, wy];
      };

      for (let i = 0; i + 2 < indices.length; i += 3) {
        triangles.push({
          a: at(indices[i]!),
          b: at(indices[i + 1]!),
          c: at(indices[i + 2]!),
        });
      }
    } catch {
      continue;
    } finally {
      geometry.delete?.();
    }
  }

  return triangles;
}

/**
 * IFC's world is Z-up; the twin's plan is X-Y with Y running north.
 *
 * The mapping is the identity on X and Y with Z becoming the vertical, which is
 * the same convention the rest of the application uses.
 */
interface Extent3 {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

function extentOf(triangles: readonly Triangle[]): Extent3 | null {
  if (triangles.length === 0) return null;
  const e: Extent3 = {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
  };
  for (const t of triangles) {
    for (const p of [t.a, t.b, t.c]) {
      if (p[0] < e.minX) e.minX = p[0];
      if (p[1] < e.minY) e.minY = p[1];
      if (p[2] < e.minZ) e.minZ = p[2];
      if (p[0] > e.maxX) e.maxX = p[0];
      if (p[1] > e.maxY) e.maxY = p[1];
      if (p[2] > e.maxZ) e.maxZ = p[2];
    }
  }
  return e;
}

/**
 * The minimum-area oriented rectangle enclosing a set of plan points.
 *
 * Rotating-callipers over the convex hull. This is what turns an evaluated wall
 * mesh back into a centreline and a thickness: a wall's plan footprint is a long
 * thin rectangle, so the rectangle's long axis is the centreline and its short
 * side is the thickness. An axis-aligned box would be wrong for any wall not
 * running due north or east, which in a real building is most of them.
 */
interface OrientedBox {
  readonly centre: Point2;
  readonly axis: Point2;
  readonly length: number;
  readonly width: number;
}

function convexHull(points: readonly Point2[]): Point2[] {
  if (points.length < 3) return [...points];
  const sorted = [...points].sort((p, q) => (p.x === q.x ? p.y - q.y : p.x - q.x));
  const cross = (o: Point2, a: Point2, b: Point2) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: Point2[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Point2[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function minimumAreaRectangle(points: readonly Point2[]): OrientedBox | null {
  const hull = convexHull(points);
  if (hull.length < 2) return null;

  let best: OrientedBox | null = null;
  let bestArea = Infinity;

  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!;
    const b = hull[(i + 1) % hull.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;

    const ux = dx / len;
    const uy = dy / len;

    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const p of hull) {
      const u = p.x * ux + p.y * uy;
      const v = -p.x * uy + p.y * ux;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }

    const width = maxU - minU;
    const height = maxV - minV;
    const area = width * height;
    if (area < bestArea) {
      bestArea = area;
      const cu = (minU + maxU) / 2;
      const cv = (minV + maxV) / 2;
      const long = width >= height;
      best = {
        centre: { x: cu * ux - cv * uy, y: cu * uy + cv * ux },
        axis: long ? { x: ux, y: uy } : { x: -uy, y: ux },
        length: long ? width : height,
        width: long ? height : width,
      };
    }
  }

  return best;
}

/**
 * Plan outline of an element's lowest horizontal face.
 *
 * Taking the bottom face rather than the whole mesh matters for anything with a
 * varying section — a stepped wall, a space bounded by a sloping soffit — where
 * projecting every vertex would report a footprint the element does not have at
 * floor level.
 */
function bottomFacePoints(triangles: readonly Triangle[], toleranceMm: number): Point2[] {
  const extent = extentOf(triangles);
  if (!extent) return [];

  // Mesh coordinates are metres, so the tolerance converts against MESH_TO_MM
  // rather than against the file's own unit scale.
  const tolerance = toleranceMm / MESH_TO_MM;
  const points: Point2[] = [];
  for (const t of triangles) {
    for (const p of [t.a, t.b, t.c]) {
      if (p[2] <= extent.minZ + tolerance) points.push({ x: p[0], y: p[1] });
    }
  }
  // A mesh with no flat bottom (a pure solid of revolution, say) falls back to
  // the full projection rather than returning nothing.
  if (points.length < 3) {
    for (const t of triangles) for (const p of [t.a, t.b, t.c]) points.push({ x: p[0], y: p[1] });
  }
  return points;
}

// ---------------------------------------------------------------------------
// Room use inference
// ---------------------------------------------------------------------------

const USE_PATTERNS: ReadonlyArray<readonly [RegExp, RoomUse]> = [
  [/reception|foyer|entrance|entry|vestibul/i, 'reception'],
  [/lobby|atrium/i, 'lobby'],
  [/conferen|boardroom|board room/i, 'conference'],
  [/meeting|huddle/i, 'meeting'],
  [/open.?plan|open.?office/i, 'open_office'],
  [/executive|director|ceo|manager/i, 'executive_office'],
  [/office|bureau|kantoor|büro|buro/i, 'office'],
  [/lab|laborator/i, 'laboratory'],
  [/server|comms|data.?room|it.?room/i, 'server_room'],
  [/train|classroom|class|lecture|seminar/i, 'training'],
  [/lounge|break|staff.?room|canteen/i, 'lounge'],
  [/corridor|hall(way)?|passage|gang|circulation/i, 'corridor'],
  [/stair|trap|treppe|escalier/i, 'stair'],
  [/lift|elevator|aufzug/i, 'lift'],
  [/toilet|wc|bath|rest.?room|shower|sanitair|badezimmer|bad\b/i, 'toilet'],
  [/kitchen|keuken|küche|kuche/i, 'kitchen'],
  [/pantry|tea.?point/i, 'pantry'],
  [/stor(e|age)|closet|berging|abstell/i, 'store'],
  [/plant|mechanical|mep|boiler|technische/i, 'plant'],
  [/park/i, 'parking'],
  [/retail|shop|store.?front/i, 'retail'],
  [/bed.?room|slaapkamer|schlafzimmer|bedroom/i, 'bedroom'],
  [/living|woonkamer|wohnzimmer|lounge|sitting/i, 'living'],
  [/dining|eetkamer|esszimmer/i, 'dining'],
];

function inferUse(name: string): RoomUse {
  for (const [pattern, use] of USE_PATTERNS) {
    if (pattern.test(name)) return use;
  }
  return 'other';
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/**
 * Millimetres per unit of web-ifc's MESH output.
 *
 * There are two different scales in play, and confusing them is the subtlest
 * trap in this importer. Values read straight out of the file — axis
 * coordinates, storey elevations, material layer thicknesses — are in whatever
 * unit the file declares, so they scale by `toMm`. Values that come back from
 * web-ifc's evaluated geometry are ALWAYS in metres, whatever the file says.
 *
 * Verified: schependomlaan.ifc declares MILLI/METRE and carries storey
 * elevations of 0, 3000 and 6000, yet its evaluated mesh spans 23 units across
 * a building 23 metres wide. Applying the file's millimetre scale to that mesh
 * made every wall 23 mm long, which is why 580 of its walls were rejected as
 * implausibly thin and 94 of its spaces produced no usable geometry.
 */
const MESH_TO_MM = 1000;

/** Default clear height where a storey does not imply one. */
const FALLBACK_CLEAR_HEIGHT_MM = 2700;
const FALLBACK_FLOOR_TO_FLOOR_MM = 3200;
/** Below this, an oriented box is too square to be a wall. */
const MIN_WALL_ASPECT = 1.6;

export async function importIfcModel(
  data: Uint8Array,
  options: IfcImportOptions,
): Promise<IfcImportResult> {
  const started = Date.now();
  const { api, constants } = options;
  const issues: ImportIssue[] = [];
  const skipped: Record<string, number> = {};
  const note = (key: string) => {
    skipped[key] = (skipped[key] ?? 0) + 1;
  };

  let modelId = -1;
  try {
    try {
      modelId = api.OpenModel(data, { COORDINATE_TO_ORIGIN: false });
    } catch (error) {
      return failed(
        [
          {
            severity: 'blocking',
            code: 'OPEN_FAILED',
            message: `The file could not be opened as IFC: ${(error as Error).message}`,
            remedy: 'Check the file is a valid IFC SPF export and is not truncated.',
          },
        ],
        started,
      );
    }

    let schema = 'unknown';
    try {
      schema = api.GetModelSchema(modelId);
    } catch {
      /* schema is informational only */
    }

    const unitResult = resolveUnits(api, modelId, constants);
    issues.push(...unitResult.issues);
    if (unitResult.toMm <= 0) {
      return { floors: [], units: unitResult.units, issues, stats: emptyStats(started), schema };
    }
    const toMm = unitResult.toMm;

    // ---- Spatial containment ------------------------------------------
    // Which storey each element belongs to. Read from the relationship rather
    // than inferred from elevation, because a wall spanning two storeys belongs
    // to exactly one of them and only the relationship says which.
    const storeyOfElement = new Map<number, number>();
    for (const relId of typeIds(api, modelId, constants.IFCRELCONTAINEDINSPATIALSTRUCTURE)) {
      try {
        const rel = api.GetLine(modelId, relId);
        const structure = refIds(rel['RelatingStructure'])[0];
        if (structure === undefined) continue;
        for (const element of refIds(rel['RelatedElements'])) {
          storeyOfElement.set(element, structure);
        }
      } catch {
        continue;
      }
    }
    // IFCSPACE hangs off a storey through IFCRELAGGREGATES rather than
    // containment, which is a distinction that costs an hour to discover.
    for (const relId of typeIds(api, modelId, constants.IFCRELAGGREGATES)) {
      try {
        const rel = api.GetLine(modelId, relId);
        const parent = refIds(rel['RelatingObject'])[0];
        if (parent === undefined) continue;
        for (const child of refIds(rel['RelatedObjects'])) {
          if (!storeyOfElement.has(child)) storeyOfElement.set(child, parent);
        }
      } catch {
        continue;
      }
    }

    // ---- Storeys -------------------------------------------------------
    const storeyIds = typeIds(api, modelId, constants.IFCBUILDINGSTOREY);
    if (storeyIds.length === 0) {
      issues.push({
        severity: 'blocking',
        code: 'NO_STOREYS',
        message: 'The model contains no IFCBUILDINGSTOREY, so there is nothing to place elements on.',
        remedy: 'Re-export with the building storeys included.',
      });
      return { floors: [], units: unitResult.units, issues, stats: emptyStats(started), schema };
    }

    const maxStoreys = options.maxStoreys ?? 60;
    interface StoreyInfo {
      id: number;
      name: string;
      elevationMm: number;
      globalId: string | null;
    }
    const storeys: StoreyInfo[] = [];
    for (const id of storeyIds) {
      try {
        const line = api.GetLine(modelId, id);
        const elevation = asNumber(line['Elevation']) ?? 0;
        storeys.push({
          id,
          name: asString(line['Name']) ?? asString(line['LongName']) ?? `Storey ${storeys.length}`,
          elevationMm: elevation * toMm,
          globalId: asString(line['GlobalId']),
        });
      } catch {
        note('IfcBuildingStorey (unreadable)');
      }
    }
    storeys.sort((a, b) => a.elevationMm - b.elevationMm);

    if (storeys.length > maxStoreys) {
      issues.push({
        severity: 'review',
        code: 'STOREY_LIMIT',
        message: `The model declares ${storeys.length} storeys; only the lowest ${maxStoreys} were imported.`,
      });
      storeys.length = maxStoreys;
    }

    // A ground storey is the one at or nearest zero elevation, so level indices
    // match how a user talks about the building rather than the file's order.
    let groundIndex = 0;
    let smallest = Infinity;
    for (let i = 0; i < storeys.length; i++) {
      const d = Math.abs(storeys[i]!.elevationMm);
      if (d < smallest) {
        smallest = d;
        groundIndex = i;
      }
    }

    // ---- Rooms ---------------------------------------------------------
    const roomsByStorey = new Map<number, CandidateRoom[]>();
    for (const spaceId of typeIds(api, modelId, constants.IFCSPACE)) {
      let line: Record<string, unknown>;
      try {
        line = api.GetLine(modelId, spaceId);
      } catch {
        note('IfcSpace (unreadable)');
        continue;
      }

      const longName = asString(line['LongName']);
      const shortName = asString(line['Name']);
      const name = longName ?? shortName ?? 'Room';

      // The declared profile is tried FIRST, before any mesh is asked for.
      // Ordering it the other way — bailing out when the mesh is empty — lost
      // 94 of schependomlaan's 100 rooms, because web-ifc does not evaluate
      // geometry for every space and the declared outline was never consulted.
      // It is also the better outline when both exist: an L-shaped room imports
      // as an L rather than as the convex hull that swallows the notch and
      // over-reports the floor area every quantity is built on.
      const declaredOutline = profileOutline(api as unknown as IfcReader, modelId, spaceId);

      const triangles = elementTriangles(api, modelId, spaceId);
      const points = bottomFacePoints(triangles, 50);

      let outline: Point2[];
      let outlineNote: string;
      if (declaredOutline && declaredOutline.length >= 3) {
        outline = declaredOutline.map((p) => ({ x: p.x * toMm, y: p.y * toMm }));
        outlineNote = 'Outline read from the declared profile.';
      } else if (points.length >= 3) {
        outline = convexHull(points).map((p) => ({ x: p.x * MESH_TO_MM, y: p.y * MESH_TO_MM }));
        outlineNote =
          'Outline is the convex hull of the space solid; a re-entrant room reads slightly large.';
      } else {
        note('IfcSpace (neither a declared profile nor usable geometry)');
        continue;
      }
      if (outline.length < 3) {
        note('IfcSpace (degenerate outline)');
        continue;
      }

      const extent = extentOf(triangles);
      const heightMm = extent ? (extent.maxZ - extent.minZ) * MESH_TO_MM : FALLBACK_CLEAR_HEIGHT_MM;

      const storeyId = storeyOfElement.get(spaceId) ?? nearestStoreyId(storeys, extent);
      const list = roomsByStorey.get(storeyId) ?? [];
      list.push({
        name,
        use: inferUse(`${longName ?? ''} ${shortName ?? ''}`),
        boundary: outline,
        clearHeight:
          heightMm > 1500 && heightMm < SANITY.maxStoreyHeightMm ? heightMm : FALLBACK_CLEAR_HEIGHT_MM,
        // The name and the extent are stated by the file; the outline is a hull
        // of evaluated geometry, so the room as a whole is 'extracted'.
        confidence: declaredOutline ? 'verified' : 'extracted',
        sourceRef: asString(line['GlobalId']) ?? String(spaceId),
        note: outlineNote,
      });
      roomsByStorey.set(storeyId, list);
    }

    // ---- Openings, indexed by their host wall ---------------------------
    // Collected before walls so each wall can pick up its own.
    interface RawOpening {
      kind: 'door' | 'window';
      centre: Point2;
      widthMm: number;
      heightMm: number;
      sillMm: number;
      sourceRef: string;
      storeyId: number | undefined;
    }
    const rawOpenings: RawOpening[] = [];
    for (const [type, kind] of [
      [constants.IFCDOOR, 'door'],
      [constants.IFCWINDOW, 'window'],
    ] as const) {
      for (const id of typeIds(api, modelId, type)) {
        const triangles = elementTriangles(api, modelId, id);
        const extent = extentOf(triangles);
        if (!extent) {
          note(`${kind} (no geometry)`);
          continue;
        }
        const points = bottomFacePoints(triangles, 100);
        const box = minimumAreaRectangle(points);
        if (!box) {
          note(`${kind} (no footprint)`);
          continue;
        }
        let ref = String(id);
        try {
          ref = asString(api.GetLine(modelId, id)['GlobalId']) ?? ref;
        } catch {
          /* the express id is a sufficient reference */
        }
        rawOpenings.push({
          kind,
          centre: { x: box.centre.x * MESH_TO_MM, y: box.centre.y * MESH_TO_MM },
          widthMm: box.length * MESH_TO_MM,
          heightMm: (extent.maxZ - extent.minZ) * MESH_TO_MM,
          sillMm: 0, // set below, relative to the storey the wall lands on
          sourceRef: ref,
          storeyId: storeyOfElement.get(id),
        });
        // Sill is the opening's own base above the storey it belongs to.
        rawOpenings[rawOpenings.length - 1] = {
          ...rawOpenings[rawOpenings.length - 1]!,
          sillMm: extent.minZ * MESH_TO_MM,
        };
      }
    }

    // ---- Walls ---------------------------------------------------------
    // Declared geometry first. Every wall in every reference model tested
    // carries an Axis polyline and a material layer set, which give the exact
    // centreline and thickness. Mesh fitting is the fallback, and what it
    // produces is marked `extracted` rather than `verified`.
    const declaredThickness = declaredThicknessMap(
      api as unknown as IfcReader,
      modelId,
      { IFCRELASSOCIATESMATERIAL: constants.IFCRELASSOCIATESMATERIAL },
    );

    const wallsByStorey = new Map<number, CandidateWall[]>();
    const wallTypes = [constants.IFCWALLSTANDARDCASE, constants.IFCWALL];
    const seenWalls = new Set<number>();
    let fromAxis = 0;
    let fromMesh = 0;

    interface WallRun {
      start: Point2;
      end: Point2;
      thickness: number;
      height: number;
      storeyId: number;
      confidence: 'verified' | 'extracted';
      sourceRef: string;
      name: string | null;
      baseZmm: number;
    }
    const runs: WallRun[] = [];

    for (const type of wallTypes) {
      for (const wallId of typeIds(api, modelId, type)) {
        if (seenWalls.has(wallId)) continue;
        seenWalls.add(wallId);

        const triangles = elementTriangles(api, modelId, wallId);
        const extent = extentOf(triangles);

        let name: string | null = null;
        let globalId: string | null = null;
        try {
          const line = api.GetLine(modelId, wallId);
          name = asString(line['Name']);
          globalId = asString(line['GlobalId']);
        } catch {
          /* geometry alone is enough to place the wall */
        }
        const ref = globalId ?? String(wallId);

        const heightMm = extent ? (extent.maxZ - extent.minZ) * MESH_TO_MM : FALLBACK_CLEAR_HEIGHT_MM;
        const baseZmm = extent ? extent.minZ * MESH_TO_MM : 0;
        const storeyId = storeyOfElement.get(wallId) ?? nearestStoreyId(storeys, extent);

        // --- Declared path ---
        const axis = axisCentreline(api as unknown as IfcReader, modelId, wallId);
        const declared = declaredThickness.get(wallId);

        if (axis && axis.length >= 2) {
          // Thickness: declared where available, else fitted from the mesh, else
          // a nominal value. Each drops the confidence a step.
          let thicknessMm = declared !== undefined ? declared * toMm : NaN;
          let confidence: 'verified' | 'extracted' = 'verified';

          if (!Number.isFinite(thicknessMm) || thicknessMm <= 0) {
            const box = minimumAreaRectangle(bottomFacePoints(triangles, 50));
            // Only trust a fitted thickness when the footprint is a single
            // straight run; for a bent wall the enclosing rectangle is the
            // width of the whole L, which is how a 240 mm wall read as 2,500.
            const straight =
              box !== null && axis.length === 2 && box.length / Math.max(box.width, 1e-9) >= MIN_WALL_ASPECT;
            thicknessMm = straight && box ? box.width * MESH_TO_MM : NaN;
            confidence = 'extracted';
          }

          if (!Number.isFinite(thicknessMm) || thicknessMm <= 0) {
            note('IfcWall (no declared or derivable thickness)');
            continue;
          }

          fromAxis++;
          // One straight run per polyline segment, so a wall that turns a corner
          // becomes two walls instead of one diagonal cutting across a room.
          for (let i = 0; i + 1 < axis.length; i++) {
            const a = axis[i]!;
            const b = axis[i + 1]!;
            runs.push({
              start: { x: a.x * toMm, y: a.y * toMm },
              end: { x: b.x * toMm, y: b.y * toMm },
              thickness: thicknessMm,
              height: heightMm > 300 ? heightMm : FALLBACK_CLEAR_HEIGHT_MM,
              storeyId,
              confidence,
              sourceRef: axis.length > 2 ? `${ref}#${i}` : ref,
              name,
              baseZmm,
            });
          }
          continue;
        }

        // --- Mesh fallback ---
        if (!extent) {
          note('IfcWall (no geometry and no axis)');
          continue;
        }
        if (hasAxisRepresentation(api as unknown as IfcReader, modelId, wallId)) {
          note('IfcWall (axis present but unreadable)');
        }
        const box = minimumAreaRectangle(bottomFacePoints(triangles, 50));
        if (!box) {
          note('IfcWall (no footprint)');
          continue;
        }
        const lengthMm = box.length * MESH_TO_MM;
        // Declared thickness is a file value and scales by the file's unit;
        // a fitted one comes from the mesh and scales by MESH_TO_MM.
        const fittedThickness =
          declared !== undefined ? declared * toMm : box.width * MESH_TO_MM;
        if (lengthMm / Math.max(box.width * MESH_TO_MM, 1) < MIN_WALL_ASPECT) {
          note('IfcWall (too square to be a wall)');
          continue;
        }
        const half = box.length / 2;
        fromMesh++;
        runs.push({
          start: {
            x: (box.centre.x - box.axis.x * half) * MESH_TO_MM,
            y: (box.centre.y - box.axis.y * half) * MESH_TO_MM,
          },
          end: {
            x: (box.centre.x + box.axis.x * half) * MESH_TO_MM,
            y: (box.centre.y + box.axis.y * half) * MESH_TO_MM,
          },
          thickness: fittedThickness,
          height: heightMm > 300 ? heightMm : FALLBACK_CLEAR_HEIGHT_MM,
          storeyId,
          confidence: 'extracted',
          sourceRef: ref,
          name,
          baseZmm,
        });
      }
    }

    // ---- Openings assigned to exactly one wall --------------------------
    // Each opening belongs to a single wall. Matching every wall it happens to
    // sit near duplicated 171 doors and windows into 546 openings, and every
    // duplicate then failed the overlap check on the way into the twin.
    const openingsByRun = new Map<number, CandidateOpening[]>();
    for (const opening of rawOpenings) {
      let bestIndex = -1;
      let bestDistance = Infinity;
      let bestAlong = 0;

      for (let i = 0; i < runs.length; i++) {
        const run = runs[i]!;
        const dx = run.end.x - run.start.x;
        const dy = run.end.y - run.start.y;
        const length = Math.hypot(dx, dy);
        if (length < 1) continue;
        const ux = dx / length;
        const uy = dy / length;

        const along = (opening.centre.x - run.start.x) * ux + (opening.centre.y - run.start.y) * uy;
        const across = Math.abs(
          -(opening.centre.x - run.start.x) * uy + (opening.centre.y - run.start.y) * ux,
        );
        // Must sit within the run, and within half its thickness plus a margin
        // for the frame reveal.
        if (along < -50 || along > length + 50) continue;
        if (across > run.thickness / 2 + 200) continue;
        // Vertically within the wall, so a first-floor window does not attach to
        // the ground-floor wall directly below it.
        if (opening.sillMm < run.baseZmm - 200 || opening.sillMm > run.baseZmm + run.height + 200) {
          continue;
        }

        if (across < bestDistance) {
          bestDistance = across;
          bestIndex = i;
          bestAlong = along;
        }
      }

      if (bestIndex < 0) {
        note(`${opening.kind} (no host wall found)`);
        continue;
      }

      const run = runs[bestIndex]!;
      const length = Math.hypot(run.end.x - run.start.x, run.end.y - run.start.y);
      const width = Math.min(opening.widthMm, length);
      const along = Math.min(Math.max(bestAlong, width / 2), length - width / 2);
      // Clamp the sill as well as the height. An opening whose base sits above
      // its wall's head — which happens where a window was matched to a wall
      // whose mesh height is shorter than the storey — would otherwise arrive
      // with sill + height past the top of the wall and be rejected on the way
      // into the twin, losing an opening that is really there.
      const sill = Math.min(Math.max(0, opening.sillMm - run.baseZmm), Math.max(0, run.height - 100));
      const height = Math.min(opening.heightMm, Math.max(100, run.height - sill));

      const list = openingsByRun.get(bestIndex) ?? [];
      list.push({
        kind: opening.kind,
        distanceAlongWall: along,
        width,
        height,
        sillHeight: sill,
        confidence: 'inferred',
        sourceRef: opening.sourceRef,
        note: 'Matched to this wall by position.',
      });
      openingsByRun.set(bestIndex, list);
    }

    // Drop overlaps within a wall here rather than letting them fail later, so
    // the count reported to the user is the count that will be imported.
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i]!;
      const lengthMm = Math.hypot(run.end.x - run.start.x, run.end.y - run.start.y);

      if (lengthMm < SANITY.minWallLengthMm || lengthMm > SANITY.maxWallLengthMm) {
        note('IfcWall (length outside sanity limits)');
        continue;
      }
      if (
        run.thickness < SANITY.minWallThicknessMm ||
        run.thickness > SANITY.maxWallThicknessMm
      ) {
        note('IfcWall (thickness outside sanity limits)');
        continue;
      }

      const candidates = (openingsByRun.get(i) ?? []).sort(
        (a, b) => a.distanceAlongWall - b.distanceAlongWall,
      );
      const openings: CandidateOpening[] = [];
      let lastEnd = -Infinity;
      for (const o of candidates) {
        if (o.distanceAlongWall - o.width / 2 < lastEnd) {
          note(`${o.kind} (overlapped another opening on the same wall)`);
          continue;
        }
        lastEnd = o.distanceAlongWall + o.width / 2;
        openings.push(o);
      }

      const list = wallsByStorey.get(run.storeyId) ?? [];
      list.push({
        start: run.start,
        end: run.end,
        thickness: run.thickness,
        height: run.height,
        function: run.thickness >= 200 ? 'exterior' : 'partition',
        loadBearing: run.thickness >= 200,
        confidence: run.confidence,
        sourceRef: run.sourceRef,
        note: run.name ?? undefined,
        openings,
      });
      wallsByStorey.set(run.storeyId, list);
    }

    if (fromMesh > 0) {
      issues.push({
        severity: 'review',
        code: 'WALL_FROM_MESH',
        message:
          `${fromMesh} wall(s) had no readable centreline and were fitted from their geometry. ` +
          `Their position and thickness are approximate.`,
        remedy: 'Check them in the plan editor before relying on quantities.',
      });
    }
    if (fromAxis > 0) {
      skipped[`walls from declared axis`] = fromAxis;
    }

    // Count what was seen but not translated, so the report is honest about it.
    for (const [type, label] of [
      [constants.IFCCOLUMN, 'IfcColumn'],
      [constants.IFCSTAIR, 'IfcStair'],
      [constants.IFCSLAB, 'IfcSlab'],
    ] as const) {
      const n = typeIds(api, modelId, type).length;
      if (n > 0) skipped[`${label} (not yet imported)`] = n;
    }

    // ---- Assemble floors ------------------------------------------------
    const floors: CandidateFloor[] = [];
    for (let i = 0; i < storeys.length; i++) {
      const storey = storeys[i]!;
      const rooms = roomsByStorey.get(storey.id) ?? [];
      const walls = wallsByStorey.get(storey.id) ?? [];
      if (rooms.length === 0 && walls.length === 0) continue;

      const next = storeys[i + 1];
      const floorToFloor = next
        ? next.elevationMm - storey.elevationMm
        : (floors[floors.length - 1]?.floorToFloor ?? FALLBACK_FLOOR_TO_FLOOR_MM);

      const usableFloorToFloor =
        floorToFloor >= SANITY.minStoreyHeightMm && floorToFloor <= SANITY.maxStoreyHeightMm
          ? floorToFloor
          : FALLBACK_FLOOR_TO_FLOOR_MM;

      const clearHeights = rooms.map((r) => r.clearHeight).filter((h) => h > 1500);
      const clearHeight =
        clearHeights.length > 0
          ? clearHeights.reduce((a, b) => a + b, 0) / clearHeights.length
          : Math.max(2100, usableFloorToFloor - 400);

      floors.push({
        name: storey.name,
        level: i - groundIndex,
        elevation: storey.elevationMm,
        floorToFloor: usableFloorToFloor,
        clearHeight,
        confidence: 'verified',
        sourceRef: storey.globalId ?? String(storey.id),
        rooms,
        walls,
      });
    }

    if (floors.length === 0) {
      issues.push({
        severity: 'blocking',
        code: 'NO_GEOMETRY',
        message: 'No storey carried any usable walls or spaces.',
        remedy:
          'The model may contain only structural or services elements. Re-export with the architectural discipline included.',
      });
    }

    const roomCount = floors.reduce((n, f) => n + f.rooms.length, 0);
    const wallCount = floors.reduce((n, f) => n + f.walls.length, 0);
    const openingCount = floors.reduce(
      (n, f) => n + f.walls.reduce((m, w) => m + w.openings.length, 0),
      0,
    );

    if (roomCount === 0 && wallCount > 0) {
      issues.push({
        severity: 'review',
        code: 'NO_SPACES',
        message:
          'The model has walls but no IFCSPACE entities, so no rooms could be created. ' +
          'Areas and finishes cannot be quantified without rooms.',
        remedy: 'Re-export with spaces, or draw the rooms in the plan editor.',
      });
    }

    return {
      floors,
      units: unitResult.units,
      issues,
      schema,
      stats: {
        floorCount: floors.length,
        roomCount,
        wallCount,
        openingCount,
        skipped,
        parseMs: Date.now() - started,
      },
    };
  } finally {
    // A leaked model is a leaked megabyte of WASM heap per import, in a process
    // that stays open all day.
    if (modelId >= 0) {
      try {
        api.CloseModel(modelId);
      } catch {
        /* already closed */
      }
    }
  }
}

function nearestStoreyId(
  storeys: ReadonlyArray<{ id: number; elevationMm: number }>,
  extent: Extent3 | null,
): number {
  if (storeys.length === 0) return -1;
  if (!extent) return storeys[0]!.id;
  const baseMm = extent.minZ * MESH_TO_MM;
  let best = storeys[0]!;
  let bestDistance = Infinity;
  for (const storey of storeys) {
    const d = Math.abs(storey.elevationMm - baseMm);
    if (d < bestDistance) {
      bestDistance = d;
      best = storey;
    }
  }
  return best.id;
}

function emptyStats(started: number): ImportStats {
  return {
    floorCount: 0,
    roomCount: 0,
    wallCount: 0,
    openingCount: 0,
    skipped: {},
    parseMs: Date.now() - started,
  };
}

function failed(issues: ImportIssue[], started: number): IfcImportResult {
  return {
    floors: [],
    units: { unit: 'm', source: 'unknown', confident: false, note: 'Import failed.' },
    issues,
    stats: emptyStats(started),
    schema: 'unknown',
  };
}
