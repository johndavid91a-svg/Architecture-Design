/**
 * Reading DECLARED geometry out of IFC, rather than deriving it from meshes.
 *
 * An earlier version of the importer took every wall's evaluated mesh, projected
 * it to plan and fitted a minimum-area rectangle. Measured against the thickness
 * the files themselves declare, that method is exact for a straight wall — 240
 * mm read as 240 mm, 417 as 417 — and badly wrong for a wall that turns a
 * corner, where the rectangle enclosing an L reported 2,500 mm for a 240 mm
 * wall. Roughly a quarter of the walls in the reference models are bent, and
 * every one of them was either dropped by the sanity check or, worse, admitted
 * at ten times its real thickness.
 *
 * The fix is to stop deriving what the file already states. Every wall in every
 * model tested carries an `Axis` representation — an IfcPolyline centreline in
 * local coordinates — and its thickness in a material layer set. Reading those
 * gives the exact centreline, handles bent walls by emitting one run per
 * polyline segment, and lets the result be marked `verified` instead of
 * `extracted`.
 *
 * Mesh fitting stays as the fallback for the minority of elements with no
 * declared axis, and what it produces is still marked `extracted`.
 */

import type { Point2 } from '../model/architecture.js';

/** The subset of web-ifc this module needs. */
export interface IfcReader {
  GetLine(modelId: number, expressId: number, flatten?: boolean): Record<string, unknown>;
  GetLineIDsWithType(modelId: number, type: number): { size(): number; get(i: number): number };
}

export interface GeometryConstants {
  readonly IFCRELASSOCIATESMATERIAL: number;
}

// ---------------------------------------------------------------------------
// Value unwrapping
// ---------------------------------------------------------------------------

export function ifcNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v['_representationValue'] === 'number' && Number.isFinite(v['_representationValue'])) {
    return v['_representationValue'] as number;
  }
  const internal = v['_internalValue'];
  if (typeof internal === 'number' && Number.isFinite(internal)) return internal;
  if (typeof internal === 'string') {
    // IFC writes reals as `0.` and `1.E1`, neither of which Number() likes with
    // a trailing dot. Trimming it is safe: the value is unchanged.
    const parsed = Number(internal.replace(/\.$/, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof v['value'] === 'number' && Number.isFinite(v['value'])) return v['value'] as number;
  return null;
}

export function ifcString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() === '' ? null : value.trim();
  if (!value || typeof value !== 'object') return null;
  const v = (value as Record<string, unknown>)['value'];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

export function ifcRef(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (!value || typeof value !== 'object') return null;
  const v = (value as Record<string, unknown>)['value'];
  return typeof v === 'number' ? v : null;
}

export function ifcRefs(value: unknown): number[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  const out: number[] = [];
  for (const item of list) {
    const id = ifcRef(item);
    if (id !== null) out.push(id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

/**
 * A 3D rigid transform, held as a 3x3 basis and a translation.
 *
 * Enough for IFC placements, which are always rigid: IfcAxis2Placement3D gives
 * an origin, a Z axis and a reference X, and scaling never enters.
 */
export interface Transform {
  readonly xx: number;
  readonly xy: number;
  readonly xz: number;
  readonly yx: number;
  readonly yy: number;
  readonly yz: number;
  readonly zx: number;
  readonly zy: number;
  readonly zz: number;
  readonly ox: number;
  readonly oy: number;
  readonly oz: number;
}

export const IDENTITY: Transform = {
  xx: 1, xy: 0, xz: 0,
  yx: 0, yy: 1, yz: 0,
  zx: 0, zy: 0, zz: 1,
  ox: 0, oy: 0, oz: 0,
};

export function applyTransform(t: Transform, x: number, y: number, z: number): [number, number, number] {
  return [
    t.xx * x + t.yx * y + t.zx * z + t.ox,
    t.xy * x + t.yy * y + t.zy * z + t.oy,
    t.xz * x + t.yz * y + t.zz * z + t.oz,
  ];
}

/** `a` then `b`: the transform that applies `a` first. */
export function compose(b: Transform, a: Transform): Transform {
  const [xx, xy, xz] = applyDirection(b, a.xx, a.xy, a.xz);
  const [yx, yy, yz] = applyDirection(b, a.yx, a.yy, a.yz);
  const [zx, zy, zz] = applyDirection(b, a.zx, a.zy, a.zz);
  const [ox, oy, oz] = applyTransform(b, a.ox, a.oy, a.oz);
  return { xx, xy, xz, yx, yy, yz, zx, zy, zz, ox, oy, oz };
}

function applyDirection(t: Transform, x: number, y: number, z: number): [number, number, number] {
  return [
    t.xx * x + t.yx * y + t.zx * z,
    t.xy * x + t.yy * y + t.zy * z,
    t.xz * x + t.yz * y + t.zz * z,
  ];
}

function readCoordinates(reader: IfcReader, modelId: number, id: number | null): number[] {
  if (id === null) return [];
  try {
    const line = reader.GetLine(modelId, id);
    const raw = line['Coordinates'] ?? line['DirectionRatios'];
    if (!Array.isArray(raw)) return [];
    return raw.map((c) => ifcNumber(c) ?? 0);
  } catch {
    return [];
  }
}

/**
 * Build the transform for an IfcAxis2Placement3D or 2D.
 *
 * The Z axis and reference X are optional in IFC; when absent the placement is
 * axis-aligned. When present, X is orthogonalised against Z rather than used
 * raw, because the standard only requires RefDirection to be non-parallel to
 * Z, not perpendicular to it — and a file that supplies a merely non-parallel
 * X will otherwise produce a skewed basis.
 */
function readAxisPlacement(reader: IfcReader, modelId: number, id: number | null): Transform {
  if (id === null) return IDENTITY;
  let line: Record<string, unknown>;
  try {
    line = reader.GetLine(modelId, id);
  } catch {
    return IDENTITY;
  }

  const location = readCoordinates(reader, modelId, ifcRef(line['Location']));
  const ox = location[0] ?? 0;
  const oy = location[1] ?? 0;
  const oz = location[2] ?? 0;

  const axisRaw = readCoordinates(reader, modelId, ifcRef(line['Axis']));
  const refRaw = readCoordinates(reader, modelId, ifcRef(line['RefDirection']));

  let zx = axisRaw[0] ?? 0;
  let zy = axisRaw[1] ?? 0;
  let zz = axisRaw[2] ?? (axisRaw.length === 0 ? 1 : 0);
  const zLen = Math.hypot(zx, zy, zz);
  if (zLen < 1e-9) {
    zx = 0;
    zy = 0;
    zz = 1;
  } else {
    zx /= zLen;
    zy /= zLen;
    zz /= zLen;
  }

  let xx = refRaw[0] ?? (refRaw.length === 0 ? 1 : 0);
  let xy = refRaw[1] ?? 0;
  let xz = refRaw[2] ?? 0;
  if (Math.hypot(xx, xy, xz) < 1e-9) {
    // No reference direction: any vector perpendicular to Z will do, and the
    // choice only matters for elements whose local X is meaningful, which is
    // precisely the case where the file supplies one.
    if (Math.abs(zz) < 0.9) {
      xx = -zy;
      xy = zx;
      xz = 0;
    } else {
      xx = 1;
      xy = 0;
      xz = 0;
    }
  }

  const dot = xx * zx + xy * zy + xz * zz;
  xx -= dot * zx;
  xy -= dot * zy;
  xz -= dot * zz;
  const xLen = Math.hypot(xx, xy, xz);
  if (xLen < 1e-9) return { ...IDENTITY, ox, oy, oz };
  xx /= xLen;
  xy /= xLen;
  xz /= xLen;

  // Y completes a right-handed basis.
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  return { xx, xy, xz, yx, yy, yz, zx, zy, zz, ox, oy, oz };
}

/** Guard against a placement chain that references itself. */
const MAX_PLACEMENT_DEPTH = 64;

/**
 * Resolve an IfcLocalPlacement chain to a world transform.
 *
 * The chain is walked to the root and composed on the way back down. A cyclic
 * chain — which malformed exports do contain — is cut at a depth limit rather
 * than hanging the import.
 */
export function resolvePlacement(reader: IfcReader, modelId: number, placementId: number | null): Transform {
  const chain: number[] = [];
  let current = placementId;
  const seen = new Set<number>();

  while (current !== null && chain.length < MAX_PLACEMENT_DEPTH) {
    if (seen.has(current)) break;
    seen.add(current);
    chain.push(current);
    try {
      const line = reader.GetLine(modelId, current);
      current = ifcRef(line['PlacementRelTo']);
    } catch {
      break;
    }
  }

  let transform = IDENTITY;
  // Outermost first, so each local placement is composed onto its parent.
  for (let i = chain.length - 1; i >= 0; i--) {
    const id = chain[i]!;
    try {
      const line = reader.GetLine(modelId, id);
      const relative = readAxisPlacement(reader, modelId, ifcRef(line['RelativePlacement']));
      transform = compose(transform, relative);
    } catch {
      continue;
    }
  }
  return transform;
}

// ---------------------------------------------------------------------------
// Axis centreline
// ---------------------------------------------------------------------------

const IFC_POLYLINE_TYPE_NAMES = new Set(['IFCPOLYLINE']);

/**
 * The declared centreline of a wall, in world plan coordinates.
 *
 * Returns the polyline's points, so a wall that turns a corner yields three or
 * more points and can be split into one straight run per segment. Returning a
 * single start and end for such a wall is what produced diagonal walls cutting
 * across rooms in the first version.
 */
export function axisCentreline(
  reader: IfcReader,
  modelId: number,
  elementId: number,
): Point2[] | null {
  let line: Record<string, unknown>;
  try {
    line = reader.GetLine(modelId, elementId);
  } catch {
    return null;
  }

  const representationId = ifcRef(line['Representation']);
  if (representationId === null) return null;

  let axisItems: number[] = [];
  try {
    const product = reader.GetLine(modelId, representationId);
    for (const repId of ifcRefs(product['Representations'])) {
      const rep = reader.GetLine(modelId, repId);
      if (ifcString(rep['RepresentationIdentifier']) !== 'Axis') continue;
      axisItems = ifcRefs(rep['Items']);
      break;
    }
  } catch {
    return null;
  }
  if (axisItems.length === 0) return null;

  const local: Point2[] = [];
  for (const itemId of axisItems) {
    try {
      const item = reader.GetLine(modelId, itemId);
      const pointIds = ifcRefs(item['Points']);
      if (pointIds.length === 0) {
        // An IfcTrimmedCurve or a composite: not handled, and saying so by
        // returning null is better than emitting half a wall.
        continue;
      }
      for (const pointId of pointIds) {
        const coords = readCoordinates(reader, modelId, pointId);
        if (coords.length < 2) continue;
        local.push({ x: coords[0] ?? 0, y: coords[1] ?? 0 });
      }
    } catch {
      continue;
    }
  }
  if (local.length < 2) return null;

  const transform = resolvePlacement(reader, modelId, ifcRef(line['ObjectPlacement']));
  return local.map((p) => {
    const [x, y] = applyTransform(transform, p.x, p.y, 0);
    return { x, y };
  });
}

/** Marker so callers can tell "no axis" from "axis present but unusable". */
export function hasAxisRepresentation(reader: IfcReader, modelId: number, elementId: number): boolean {
  try {
    const line = reader.GetLine(modelId, elementId);
    const representationId = ifcRef(line['Representation']);
    if (representationId === null) return false;
    const product = reader.GetLine(modelId, representationId);
    for (const repId of ifcRefs(product['Representations'])) {
      const rep = reader.GetLine(modelId, repId);
      if (ifcString(rep['RepresentationIdentifier']) === 'Axis') return true;
    }
  } catch {
    return false;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Declared thickness
// ---------------------------------------------------------------------------

/**
 * Wall thickness from the material layer set.
 *
 * Verified against the reference models: where a layer set is present its total
 * matches the geometry exactly. The value is the sum of the layers, because a
 * wall's thickness is the whole build-up — a 92 mm stud with two 16 mm boards
 * occupies 124 mm of plan, and that is what has to be built.
 */
export function declaredThicknessMap(
  reader: IfcReader,
  modelId: number,
  constants: GeometryConstants,
): Map<number, number> {
  const byElement = new Map<number, number>();

  let relIds: number[] = [];
  try {
    const vector = reader.GetLineIDsWithType(modelId, constants.IFCRELASSOCIATESMATERIAL);
    relIds = Array.from({ length: vector.size() }, (_, i) => vector.get(i));
  } catch {
    return byElement;
  }

  for (const relId of relIds) {
    try {
      const rel = reader.GetLine(modelId, relId);
      const materialId = ifcRef(rel['RelatingMaterial']);
      if (materialId === null) continue;

      const total = layerSetTotal(reader, modelId, materialId, 0);
      if (total === null || total <= 0) continue;

      for (const elementId of ifcRefs(rel['RelatedObjects'])) {
        byElement.set(elementId, total);
      }
    } catch {
      continue;
    }
  }

  return byElement;
}

/** Walk IfcMaterialLayerSetUsage → IfcMaterialLayerSet → layers, summing thickness. */
function layerSetTotal(reader: IfcReader, modelId: number, id: number, depth: number): number | null {
  if (depth > 6) return null;
  let line: Record<string, unknown>;
  try {
    line = reader.GetLine(modelId, id);
  } catch {
    return null;
  }

  const layers = line['MaterialLayers'];
  if (Array.isArray(layers)) {
    let total = 0;
    for (const layerRef of layers) {
      const layerId = ifcRef(layerRef);
      if (layerId === null) continue;
      try {
        const layer = reader.GetLine(modelId, layerId);
        total += ifcNumber(layer['LayerThickness']) ?? 0;
      } catch {
        continue;
      }
    }
    return total > 0 ? total : null;
  }

  for (const key of ['ForLayerSet', 'MaterialLayerSet', 'Materials']) {
    const nested = ifcRef(line[key]);
    if (nested !== null) {
      const total = layerSetTotal(reader, modelId, nested, depth + 1);
      if (total !== null) return total;
    }
    // IfcMaterialList and IfcMaterialConstituentSet hold arrays.
    const nestedList = ifcRefs(line[key]);
    for (const nestedId of nestedList) {
      const total = layerSetTotal(reader, modelId, nestedId, depth + 1);
      if (total !== null) return total;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Declared room outline
// ---------------------------------------------------------------------------

/**
 * A space's plan outline from its extruded profile, when it has one.
 *
 * This is what makes an L-shaped room import as an L rather than as the convex
 * hull that swallows the notch. A hull of a re-entrant room over-reports its
 * area, and floor area is the number every quantity and every cost is built on.
 */
export function profileOutline(
  reader: IfcReader,
  modelId: number,
  elementId: number,
): Point2[] | null {
  let line: Record<string, unknown>;
  try {
    line = reader.GetLine(modelId, elementId);
  } catch {
    return null;
  }

  const representationId = ifcRef(line['Representation']);
  if (representationId === null) return null;

  let bodyItems: number[] = [];
  try {
    const product = reader.GetLine(modelId, representationId);
    for (const repId of ifcRefs(product['Representations'])) {
      const rep = reader.GetLine(modelId, repId);
      const identifier = ifcString(rep['RepresentationIdentifier']);
      if (identifier !== 'Body' && identifier !== 'FootPrint') continue;
      bodyItems = ifcRefs(rep['Items']);
      if (identifier === 'FootPrint') break; // A footprint is the better source.
    }
  } catch {
    return null;
  }
  if (bodyItems.length === 0) return null;

  const placement = resolvePlacement(reader, modelId, ifcRef(line['ObjectPlacement']));

  for (const itemId of bodyItems) {
    const outline = extrudedProfilePoints(reader, modelId, itemId, 0);
    if (outline && outline.length >= 3) {
      return outline.map((p) => {
        const [x, y] = applyTransform(placement, p.x, p.y, 0);
        return { x, y };
      });
    }
  }
  return null;
}

/**
 * Points of an extruded area solid's profile, in the element's local frame.
 *
 * Only closed polyline profiles are read. A circular or composite profile
 * returns null so the caller falls back rather than inventing a polygon — a
 * round room is rare enough that guessing at one is not worth the risk of
 * silently mis-measuring it.
 */
function extrudedProfilePoints(
  reader: IfcReader,
  modelId: number,
  itemId: number,
  depth: number,
): Point2[] | null {
  if (depth > 5) return null;
  let item: Record<string, unknown>;
  try {
    item = reader.GetLine(modelId, itemId);
  } catch {
    return null;
  }

  // IfcMappedItem indirection, used heavily by some authoring tools.
  const mappingSource = ifcRef(item['MappingSource']);
  if (mappingSource !== null) {
    try {
      const source = reader.GetLine(modelId, mappingSource);
      const mapped = ifcRef(source['MappedRepresentation']);
      if (mapped !== null) {
        const rep = reader.GetLine(modelId, mapped);
        for (const nested of ifcRefs(rep['Items'])) {
          const points = extrudedProfilePoints(reader, modelId, nested, depth + 1);
          if (points) return points;
        }
      }
    } catch {
      return null;
    }
  }

  // A boolean result: take the first operand, which is the base solid.
  const firstOperand = ifcRef(item['FirstOperand']);
  if (firstOperand !== null) {
    return extrudedProfilePoints(reader, modelId, firstOperand, depth + 1);
  }

  const profileId = ifcRef(item['SweptArea']);
  if (profileId === null) return null;

  let profile: Record<string, unknown>;
  try {
    profile = reader.GetLine(modelId, profileId);
  } catch {
    return null;
  }

  // A rectangle profile states its dimensions rather than its points.
  const xDim = ifcNumber(profile['XDim']);
  const yDim = ifcNumber(profile['YDim']);
  if (xDim !== null && yDim !== null && xDim > 0 && yDim > 0) {
    const position = readAxisPlacement(reader, modelId, ifcRef(profile['Position']));
    const half: Point2[] = [
      { x: -xDim / 2, y: -yDim / 2 },
      { x: xDim / 2, y: -yDim / 2 },
      { x: xDim / 2, y: yDim / 2 },
      { x: -xDim / 2, y: yDim / 2 },
    ];
    return half.map((p) => {
      const [x, y] = applyTransform(position, p.x, p.y, 0);
      return { x, y };
    });
  }

  const curveId = ifcRef(profile['OuterCurve']) ?? ifcRef(profile['Curve']);
  if (curveId === null) return null;

  let points: Point2[] = [];
  try {
    const curve = reader.GetLine(modelId, curveId);
    for (const pointId of ifcRefs(curve['Points'])) {
      const coords = readCoordinates(reader, modelId, pointId);
      if (coords.length >= 2) points.push({ x: coords[0] ?? 0, y: coords[1] ?? 0 });
    }
  } catch {
    return null;
  }
  if (points.length < 3) return null;

  // A closed IfcPolyline repeats its first point; the twin's polygons do not.
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-6) points = points.slice(0, -1);
  if (points.length < 3) return null;

  const position = readAxisPlacement(reader, modelId, ifcRef(profile['Position']));
  return points.map((p) => {
    const [x, y] = applyTransform(position, p.x, p.y, 0);
    return { x, y };
  });
}
