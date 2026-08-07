/**
 * Plan geometry.
 *
 * Every quantity in the BOQ ultimately comes from one of these functions, so
 * they are deliberately plain, total, and unit-tested. No dependency on a
 * geometry library: the operations needed are few, and a third-party library
 * would introduce its own floating-point conventions between the drawing and
 * the invoice.
 */

import type { Point2 } from './model/architecture.js';
import type { Millimetres, SquareMillimetres } from './units.js';

/**
 * Signed polygon area by the shoelace formula.
 *
 * Positive for counter-clockwise winding, negative for clockwise. The sign is
 * exposed rather than hidden because it is how `isCounterClockwise` and the
 * 3D extruder decide which way a wall face points.
 */
export function signedArea(polygon: readonly Point2[]): SquareMillimetres {
  const n = polygon.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % n]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/** Absolute polygon area. This is the number that becomes floor and ceiling quantity. */
export function polygonArea(polygon: readonly Point2[]): SquareMillimetres {
  return Math.abs(signedArea(polygon));
}

export function isCounterClockwise(polygon: readonly Point2[]): boolean {
  return signedArea(polygon) > 0;
}

/** Perimeter of a closed polygon. Becomes skirting and cornice quantity. */
export function polygonPerimeter(polygon: readonly Point2[]): Millimetres {
  const n = polygon.length;
  if (n < 2) return 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    total += distance(polygon[i]!, polygon[(i + 1) % n]!);
  }
  return total;
}

export function distance(a: Point2, b: Point2): Millimetres {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function centroid(polygon: readonly Point2[]): Point2 {
  const n = polygon.length;
  if (n === 0) return { x: 0, y: 0 };
  const a = signedArea(polygon);
  if (Math.abs(a) < 1e-9) {
    // Degenerate (collinear) polygon: fall back to the vertex average so
    // callers such as label placement still get a usable point.
    let sx = 0;
    let sy = 0;
    for (const p of polygon) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / n, y: sy / n };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const p = polygon[i]!;
    const q = polygon[(i + 1) % n]!;
    const cross = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

/** Axis-aligned bounding box. Used for viewport fitting and quick rejection tests. */
export interface Bounds {
  readonly minX: Millimetres;
  readonly minY: Millimetres;
  readonly maxX: Millimetres;
  readonly maxY: Millimetres;
}

export function boundsOf(points: readonly Point2[]): Bounds {
  if (points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function boundsWidth(b: Bounds): Millimetres {
  return b.maxX - b.minX;
}

export function boundsHeight(b: Bounds): Millimetres {
  return b.maxY - b.minY;
}

/**
 * Point-in-polygon by ray casting.
 *
 * Used to decide which room a placed furniture item belongs to and whether a
 * point the user clicked selects a room.
 */
export function pointInPolygon(point: Point2, polygon: readonly Point2[]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const pi = polygon[i]!;
    const pj = polygon[j]!;
    const intersects = pi.y > point.y !== pj.y > point.y;
    if (intersects) {
      const xCross = ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x;
      if (point.x < xCross) inside = !inside;
    }
  }
  return inside;
}

/** Shortest distance from a point to a segment. Drives wall snapping and clearance. */
export function distancePointToSegment(p: Point2, a: Point2, b: Point2): Millimetres {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return distance(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** A rectangle defined by centre, size and rotation — the furniture footprint shape. */
export interface OrientedRect {
  readonly centre: Point2;
  readonly width: Millimetres;
  readonly depth: Millimetres;
  readonly rotationDeg: number;
}

/** The four corners of an oriented rectangle, counter-clockwise. */
export function rectCorners(rect: OrientedRect): Point2[] {
  const rad = (rect.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hw = rect.width / 2;
  const hd = rect.depth / 2;
  const local: ReadonlyArray<readonly [number, number]> = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];
  return local.map(([lx, ly]) => ({
    x: rect.centre.x + lx * cos - ly * sin,
    y: rect.centre.y + lx * sin + ly * cos,
  }));
}

/**
 * Separating-axis test for two oriented rectangles.
 *
 * This is what stops the AI placing a conference table through a desk. Rectangles
 * are sufficient — furniture footprints are specified as bounding rectangles in
 * the catalogue, and using the true outline would report clearance the room does
 * not actually have once chairs are pulled out.
 */
export function rectsOverlap(a: OrientedRect, b: OrientedRect): boolean {
  const ca = rectCorners(a);
  const cb = rectCorners(b);
  for (const corners of [ca, cb]) {
    for (let i = 0; i < 4; i++) {
      const p = corners[i]!;
      const q = corners[(i + 1) % 4]!;
      // Axis perpendicular to this edge.
      const axisX = -(q.y - p.y);
      const axisY = q.x - p.x;
      const len = Math.hypot(axisX, axisY);
      if (len === 0) continue;
      const nx = axisX / len;
      const ny = axisY / len;
      const projA = project(ca, nx, ny);
      const projB = project(cb, nx, ny);
      if (projA.max < projB.min || projB.max < projA.min) return false;
    }
  }
  return true;
}

function project(corners: readonly Point2[], nx: number, ny: number): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const c of corners) {
    const v = c.x * nx + c.y * ny;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

/** True when every corner of `rect` lies inside `polygon`. */
export function rectInsidePolygon(rect: OrientedRect, polygon: readonly Point2[]): boolean {
  return rectCorners(rect).every((c) => pointInPolygon(c, polygon));
}

/**
 * Build a rectangular room boundary from a width and a depth.
 *
 * The direct path from "the user typed 15 x 20 ft" to a polygon. Kept here so
 * exactly one code path turns typed dimensions into geometry.
 */
export function rectangleBoundary(
  origin: Point2,
  width: Millimetres,
  depth: Millimetres,
): Point2[] {
  return [
    { x: origin.x, y: origin.y },
    { x: origin.x + width, y: origin.y },
    { x: origin.x + width, y: origin.y + depth },
    { x: origin.x, y: origin.y + depth },
  ];
}
