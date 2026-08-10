/**
 * TURNING LINE WORK INTO A BUILDING.
 *
 * PDF and DXF both hand over line segments and positioned text. Neither knows
 * what a wall is. This module infers walls from pairs of parallel lines, rooms
 * from the faces those walls enclose, and openings from the gaps in them.
 *
 * Everything it produces is a guess, and it says so: every wall and room comes
 * out `extracted` or `inferred`, never `verified`. That is the honest difference
 * between this and the IFC importer, where a wall is an entity with a declared
 * centreline. A pair of parallel lines 100 mm apart might be a wall; it might
 * equally be a kerb, a duct, a hatch boundary or a dimension line. The
 * recogniser cannot tell, so it reports what it did and leaves the decision
 * with the user.
 *
 * Every threshold is an option with a documented default, because drawing
 * conventions vary between offices and a tolerance that suits one CAD standard
 * fails another.
 */

import { polygonArea, polygonPerimeter, signedArea } from '../geometry.js';
import type { Point2, RoomUse } from '../model/architecture.js';
import type {
  CandidateFloor,
  CandidateOpening,
  CandidateRoom,
  CandidateWall,
  ImportIssue,
  ImportStats,
  LineWork,
  TextItem,
} from './contract.js';
import { SANITY } from './contract.js';

export interface RecogniseOptions {
  /** A plan carries no heights; this is what rooms and walls get. */
  readonly defaultClearHeightMm?: number;
  readonly defaultFloorToFloorMm?: number;
  /** How far off parallel two lines may be and still pair into a wall. */
  readonly parallelToleranceDeg?: number;
  /** Endpoints closer than this are treated as the same junction. */
  readonly snapToleranceMm?: number;
  /** Fraction of the shorter line that must overlap for a pair to count. */
  readonly minOverlapFraction?: number;
  /** Thickness given to a wall drawn as a single line. */
  readonly singleLineWallThicknessMm?: number;
  /** Unpaired lines shorter than this are treated as annotation, not walls. */
  readonly minSingleLineWallMm?: number;
  /**
   * Shortest paired-line run that may be a wall.
   *
   * Defaults to the sanity floor, because a DXF can be filtered by layer and a
   * genuine 300 mm wall stub should survive. A PDF has no layers, and hatching
   * is *precisely* a field of short parallel line pairs a wall-thickness apart —
   * so on a PDF this is raised, and the drawing's poche stops being read as
   * hundreds of tiny walls.
   */
  readonly minWallRunMm?: number;
  /**
   * Largest gap between two collinear wall runs that will be treated as an
   * opening in one wall rather than a genuine break between two.
   */
  readonly maxOpeningGapMm?: number;
  readonly floorName?: string;
  readonly level?: number;
}

const DEFAULTS = {
  defaultClearHeightMm: 3000,
  defaultFloorToFloorMm: 3400,
  parallelToleranceDeg: 2,
  snapToleranceMm: 25,
  minOverlapFraction: 0.6,
  singleLineWallThicknessMm: 114,
  minSingleLineWallMm: 1500,
  minWallRunMm: SANITY.minWallLengthMm,
  // Wide enough for a double door or a picture window, short of the 3 m-plus
  // spans where an "opening" is more likely to be a genuinely open side.
  maxOpeningGapMm: 2500,
  floorName: 'Imported floor',
  level: 0,
} as const;

export interface RecogniseResult {
  readonly floor: CandidateFloor | null;
  readonly issues: readonly ImportIssue[];
  readonly stats: ImportStats;
}

// ---------------------------------------------------------------------------
// Segment preparation
// ---------------------------------------------------------------------------

interface Seg {
  a: Point2;
  b: Point2;
  length: number;
  /** Unit direction, normalised so angle is in [0, 180) — a line has no sense. */
  ux: number;
  uy: number;
  angle: number;
  layer?: string;
  used: boolean;
}

function makeSeg(a: Point2, b: Point2, layer?: string): Seg | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return null;
  let ux = dx / length;
  let uy = dy / length;
  // Canonical direction, so two lines drawn in opposite senses compare equal.
  if (ux < 0 || (Math.abs(ux) < 1e-9 && uy < 0)) {
    ux = -ux;
    uy = -uy;
  }
  const angle = ((Math.atan2(uy, ux) * 180) / Math.PI + 180) % 180;
  return { a, b, length, ux, uy, angle, layer, used: false };
}

function angleDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 180;
  return d > 90 ? 180 - d : d;
}

/**
 * Merge collinear segments that touch or overlap.
 *
 * CAD exports routinely split one wall line into dozens of pieces — at every
 * door, every dimension witness line, every layer change. Left alone, each
 * fragment pairs separately and one wall becomes twenty, which then produces
 * twenty rooms out of one. Merging first is what makes the rest tractable.
 */
function mergeCollinear(segments: Seg[], toleranceMm: number, parallelDeg: number): Seg[] {
  const buckets = new Map<string, Seg[]>();
  for (const s of segments) {
    // Bucket by direction and by perpendicular offset from the origin, so only
    // segments that could possibly be collinear are ever compared.
    const angleKey = Math.round(s.angle / Math.max(parallelDeg, 0.5));
    const offset = -s.a.x * s.uy + s.a.y * s.ux;
    const offsetKey = Math.round(offset / Math.max(toleranceMm, 1));
    for (const nudge of [-1, 0, 1]) {
      const key = `${angleKey}|${offsetKey + nudge}`;
      const list = buckets.get(key);
      if (list) {
        list.push(s);
        break;
      }
      if (nudge === 1) buckets.set(`${angleKey}|${offsetKey}`, [s]);
    }
  }

  const merged: Seg[] = [];
  for (const bucket of buckets.values()) {
    // Project onto the shared direction and merge overlapping intervals.
    const first = bucket[0];
    if (!first) continue;
    const ux = first.ux;
    const uy = first.uy;

    const intervals = bucket
      .map((s) => {
        const ta = s.a.x * ux + s.a.y * uy;
        const tb = s.b.x * ux + s.b.y * uy;
        return { lo: Math.min(ta, tb), hi: Math.max(ta, tb), seg: s };
      })
      .sort((p, q) => p.lo - q.lo);

    let current = intervals[0];
    if (!current) continue;
    let lo = current.lo;
    let hi = current.hi;
    let layer = current.seg.layer;
    const offset = -current.seg.a.x * uy + current.seg.a.y * ux;

    const flush = () => {
      const a: Point2 = { x: ux * lo - uy * offset, y: uy * lo + ux * offset };
      const b: Point2 = { x: ux * hi - uy * offset, y: uy * hi + ux * offset };
      const s = makeSeg(a, b, layer);
      if (s) merged.push(s);
    };

    for (let i = 1; i < intervals.length; i++) {
      const next = intervals[i]!;
      if (next.lo <= hi + toleranceMm) {
        hi = Math.max(hi, next.hi);
      } else {
        flush();
        lo = next.lo;
        hi = next.hi;
        layer = next.seg.layer;
      }
    }
    flush();
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

/**
 * What a layer name says about whether its line work is building fabric.
 *
 * Layer naming is the one piece of structure a DXF reliably carries beyond raw
 * geometry, and every CAD office uses it -- the AIA CAD Layer Guidelines and
 * ISO 13567 both exist to standardise it. A villa drawing measured here put its
 * walls on `wall low` and `wall high`, and its trees, contours, furniture and
 * surface hatching on `plants`, `topography`, `equipment` and `texture`. Fed to
 * the wall recogniser undifferentiated, a contour line pairs with a paving joint
 * into a plausible 43 m wall, and the real rooms drown in the noise.
 *
 * Names are matched in several languages because drawings travel, and the terms
 * that matter are few. A layer nobody recognises is kept, not discarded: an
 * unfamiliar naming scheme should cost accuracy, never whole walls.
 */
export type LayerRole = 'wall' | 'excluded' | 'unknown';

const WALL_LAYER =
  /(^|[^a-z])(wall|walls|partition|mur|muro|muros|pared|paredes|parede|wand|waende|mauer)([^a-z]|$)/i;

/**
 * Stems are kept short deliberately, to catch the AIA abbreviations that most
 * drawings actually use -- `A-FURN`, `A-EQPM`, `A-ANNO`, `A-PLNT` -- as well as
 * the words spelled out.
 */
const NOT_WALL_LAYER = new RegExp(
  [
    // Landscape and site
    'plant|plnt|tree|arbol|shrub|grass|lawn|garden|jardin|landscap|topograf|topograph',
    'terrain|contour|curva|nivel|survey|road|kerb|curb|paving|park|site',
    // Contents rather than fabric
    'furn|mobil|eqpm|equip|fixture|sanit|applian',
    // Services
    'elec|plumb|hvac|duct|pipe|cable|light|lumin|drain|sewer',
    // Joinery and glazing symbols: they sit inside a wall, they are not one
    'door|window|glaz|vent',
    // Not the floor plan
    'clng|ceil|roof|sect|elev',
    // Annotation and presentation
    'dimens|dims|acot|text|note|anno|label|title|sheet|legend|logo|north|scale',
    'grid|axis|hatch|texture|pattern|defpoint|viewport|image|raster|projection',
  ].join('|'),
  'i',
);

export function classifyLayer(name: string | undefined): LayerRole {
  if (!name) return 'unknown';
  const trimmed = name.trim();
  if (trimmed === '') return 'unknown';
  // A wall layer wins over an exclusion: `wall hatch` is still a wall layer,
  // and drawings do name layers that way.
  if (WALL_LAYER.test(trimmed)) return 'wall';
  if (NOT_WALL_LAYER.test(trimmed)) return 'excluded';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Wall pairing
// ---------------------------------------------------------------------------

interface WallRun {
  start: Point2;
  end: Point2;
  thickness: number;
  confidence: 'extracted' | 'inferred';
  note: string;
}

/**
 * Pair parallel lines into walls.
 *
 * A wall in a plan is two parallel lines a wall-thickness apart. Each line may
 * belong to at most one pair, chosen greedily by score, because a line shared
 * between two rooms would otherwise be consumed twice and produce two
 * overlapping walls where there is one.
 */
function pairWalls(
  segments: Seg[],
  options: Required<RecogniseOptions>,
): { walls: WallRun[]; unpaired: Seg[] } {
  const walls: WallRun[] = [];

  interface Candidate {
    i: number;
    j: number;
    score: number;
    thickness: number;
    overlapLo: number;
    overlapHi: number;
  }
  const candidates: Candidate[] = [];

  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!;
    for (let j = i + 1; j < segments.length; j++) {
      const t = segments[j]!;
      if (angleDelta(s.angle, t.angle) > options.parallelToleranceDeg) continue;

      // Perpendicular separation, measured from s's line to t's start.
      const thickness = Math.abs(-(t.a.x - s.a.x) * s.uy + (t.a.y - s.a.y) * s.ux);
      if (thickness < SANITY.minWallThicknessMm || thickness > SANITY.maxWallThicknessMm) continue;

      // Overlap along the shared direction.
      const sa = s.a.x * s.ux + s.a.y * s.uy;
      const sb = s.b.x * s.ux + s.b.y * s.uy;
      const ta = t.a.x * s.ux + t.a.y * s.uy;
      const tb = t.b.x * s.ux + t.b.y * s.uy;
      const lo = Math.max(Math.min(sa, sb), Math.min(ta, tb));
      const hi = Math.min(Math.max(sa, sb), Math.max(ta, tb));
      const overlap = hi - lo;
      if (overlap <= 0) continue;

      const shorter = Math.min(s.length, t.length);
      if (overlap < shorter * options.minOverlapFraction) continue;

      // Prefer long overlaps, near-perfect parallelism and plausible thickness.
      // 230 mm is a one-brick wall and the commonest thickness in the region
      // this product targets, so it anchors the plausibility term.
      const parallelScore = 1 - angleDelta(s.angle, t.angle) / options.parallelToleranceDeg;
      const thicknessScore = 1 / (1 + Math.abs(thickness - 230) / 230);
      candidates.push({
        i,
        j,
        score: overlap * (1 + parallelScore) * (1 + thicknessScore),
        thickness,
        overlapLo: lo,
        overlapHi: hi,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  for (const c of candidates) {
    const s = segments[c.i]!;
    const t = segments[c.j]!;
    if (s.used || t.used) continue;
    s.used = true;
    t.used = true;

    // The centreline is the midline of the pair, over the overlapping span.
    const offsetS = -s.a.x * s.uy + s.a.y * s.ux;
    const offsetT = -t.a.x * s.uy + t.a.y * s.ux;
    const mid = (offsetS + offsetT) / 2;

    walls.push({
      start: { x: s.ux * c.overlapLo - s.uy * mid, y: s.uy * c.overlapLo + s.ux * mid },
      end: { x: s.ux * c.overlapHi - s.uy * mid, y: s.uy * c.overlapHi + s.ux * mid },
      thickness: c.thickness,
      confidence: 'extracted',
      note: `Paired from two parallel lines ${c.thickness.toFixed(0)} mm apart.`,
    });
  }

  return { walls, unpaired: segments.filter((s) => !s.used) };
}

/**
 * Weld wall centrelines together at their junctions.
 *
 * Without this there are no rooms at all. A paired centreline runs only as far
 * as the two source lines overlap, which stops short of the corner: the outer
 * line of a wall runs past the junction, the inner line stops before it, and
 * the overlap — and therefore the centreline — ends somewhere in between. Two
 * walls meeting at a corner end up a hundred millimetres apart, the graph never
 * closes, and a drawing with 356 perfectly good walls yields zero rooms.
 *
 * So each wall's ends are extended or trimmed to where its line actually
 * crosses its neighbours. This is the same cleanup a drafter does by hand, and
 * it is what turns a heap of line segments into an enclosure.
 */
function weldWalls(walls: WallRun[], toleranceMm: number): { welded: WallRun[]; junctions: number } {
  interface Line {
    ox: number;
    oy: number;
    ux: number;
    uy: number;
    length: number;
  }

  const lines: Line[] = walls.map((w) => {
    const dx = w.end.x - w.start.x;
    const dy = w.end.y - w.start.y;
    const length = Math.hypot(dx, dy) || 1;
    return { ox: w.start.x, oy: w.start.y, ux: dx / length, uy: dy / length, length };
  });

  // How far past its own end a wall may reach to find a junction. Generous,
  // because the shortfall scales with the thickness of the wall it meets.
  const reach = (w: WallRun) => Math.max(toleranceMm * 8, w.thickness * 3);

  const startTargets: Point2[][] = walls.map(() => []);
  const endTargets: Point2[][] = walls.map(() => []);
  let junctions = 0;

  for (let i = 0; i < walls.length; i++) {
    const li = lines[i]!;
    for (let j = i + 1; j < walls.length; j++) {
      const lj = lines[j]!;

      // Parallel lines have no single crossing point.
      const denominator = li.ux * lj.uy - li.uy * lj.ux;
      if (Math.abs(denominator) < 0.08) continue; // roughly within 4.5° of parallel

      const dx = lj.ox - li.ox;
      const dy = lj.oy - li.oy;
      const ti = (dx * lj.uy - dy * lj.ux) / denominator;
      const tj = (dx * li.uy - dy * li.ux) / denominator;

      const ri = reach(walls[i]!);
      const rj = reach(walls[j]!);
      // The crossing must be at or near an end of at least one wall, and within
      // the span (plus reach) of the other. A crossing in the middle of both is
      // two walls passing through each other, which is not a junction.
      if (ti < -ri || ti > li.length + ri) continue;
      if (tj < -rj || tj > lj.length + rj) continue;

      const point: Point2 = { x: li.ox + li.ux * ti, y: li.oy + li.uy * ti };

      if (ti <= ri) startTargets[i]!.push(point);
      else if (ti >= li.length - ri) endTargets[i]!.push(point);

      if (tj <= rj) startTargets[j]!.push(point);
      else if (tj >= lj.length - rj) endTargets[j]!.push(point);

      junctions++;
    }
  }

  const nearest = (from: Point2, options: readonly Point2[]): Point2 | null => {
    let best: Point2 | null = null;
    let bestDistance = Infinity;
    for (const option of options) {
      const d = Math.hypot(option.x - from.x, option.y - from.y);
      if (d < bestDistance) {
        bestDistance = d;
        best = option;
      }
    }
    return best;
  };

  const welded = walls.map((wall, index) => {
    const start = nearest(wall.start, startTargets[index]!) ?? wall.start;
    const end = nearest(wall.end, endTargets[index]!) ?? wall.end;
    // A weld that would collapse or invert the wall is worse than no weld.
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length < SANITY.minWallLengthMm) return wall;
    return { ...wall, start, end };
  });

  return { welded, junctions };
}

/**
 * Rejoin wall runs that a drawing interrupts at every opening.
 *
 * Most CAD plans draw a wall with a door in it as two lines that stop either
 * side of the door, not as one wall carrying an opening. Paired up, that gives
 * two collinear wall runs with a door-sized hole between them -- and a hole in
 * a wall is a hole in the room boundary, so no loop closes and the floor comes
 * out with no rooms in it at all. Measured across a real 43 x 33 m plan, 331
 * pairs of wall runs sat collinear with a sub-4 m gap, clustered hard at
 * 750-999 mm and 1750-1999 mm: single doors and double doors.
 *
 * Rejoining them changes no quantity. The bridged span is a gap in the source
 * line work, so `findOpenings` reads it straight back as an opening on the
 * merged wall, and the takeoff deducts openings from the masonry. What changes
 * is only the topology -- which is the thing standing between a drawing and a
 * set of rooms.
 *
 * The gap limit matters, because bridging a span that is genuinely open builds
 * a wall that does not exist. It is capped at a width an opening can plausibly
 * be; anything wider is left as two walls for the user to judge.
 */
function bridgeOpenings(
  walls: readonly WallRun[],
  options: Required<RecogniseOptions>,
): { walls: WallRun[]; bridged: number } {
  interface Member {
    wall: WallRun;
    lo: number;
    hi: number;
  }
  interface Cluster {
    ux: number;
    uy: number;
    offset: number;
    members: Member[];
  }

  const clusters: Cluster[] = [];

  for (const wall of walls) {
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) continue;

    // Canonical direction, so a wall drawn right-to-left clusters with one
    // drawn left-to-right along the same line.
    let ux = dx / length;
    let uy = dy / length;
    if (ux < 0 || (Math.abs(ux) < 1e-9 && uy < 0)) {
      ux = -ux;
      uy = -uy;
    }
    const angle = ((Math.atan2(uy, ux) * 180) / Math.PI + 180) % 180;
    const offset = -wall.start.x * uy + wall.start.y * ux;

    const found = clusters.find((c) => {
      const cAngle = ((Math.atan2(c.uy, c.ux) * 180) / Math.PI + 180) % 180;
      if (angleDelta(cAngle, angle) > options.parallelToleranceDeg) return false;
      if (Math.abs(c.offset - offset) > options.snapToleranceMm * 2) return false;
      // Two walls of different thickness are two different walls, even when
      // they line up: a 230 mm outside wall meeting a 114 mm partition end-on
      // must not be merged into one run.
      const thickness = c.members[0]!.wall.thickness;
      return Math.abs(thickness - wall.thickness) <= Math.max(30, thickness * 0.25);
    });

    const project = (p: Point2) => p.x * ux + p.y * uy;
    const ta = project(wall.start);
    const tb = project(wall.end);
    const member: Member = { wall, lo: Math.min(ta, tb), hi: Math.max(ta, tb) };

    if (found) {
      // Re-project onto the cluster's own direction so the intervals compare.
      const pc = (p: Point2) => p.x * found.ux + p.y * found.uy;
      const ca = pc(wall.start);
      const cb = pc(wall.end);
      found.members.push({ wall, lo: Math.min(ca, cb), hi: Math.max(ca, cb) });
    } else {
      clusters.push({ ux, uy, offset, members: [member] });
    }
  }

  const result: WallRun[] = [];
  let bridged = 0;

  for (const cluster of clusters) {
    if (cluster.members.length === 1) {
      result.push(cluster.members[0]!.wall);
      continue;
    }

    const sorted = [...cluster.members].sort((a, b) => a.lo - b.lo);
    let run = sorted[0]!;
    let parts = 1;
    let holes = 0;

    const flush = () => {
      const at = (t: number): Point2 => ({
        x: cluster.ux * t - cluster.uy * cluster.offset,
        y: cluster.uy * t + cluster.ux * cluster.offset,
      });
      if (parts === 1) {
        result.push(run.wall);
        return;
      }
      bridged += holes;
      result.push({
        ...run.wall,
        start: at(run.lo),
        end: at(run.hi),
        note:
          `${run.wall.note} Rejoined from ${parts} runs across ${holes} opening-sized ` +
          `gap(s), which are read back as openings.`,
      });
    };

    for (let i = 1; i < sorted.length; i++) {
      const next = sorted[i]!;
      const gap = next.lo - run.hi;
      if (gap <= options.maxOpeningGapMm) {
        if (gap > options.snapToleranceMm) holes++;
        run = { wall: run.wall, lo: run.lo, hi: Math.max(run.hi, next.hi) };
        parts++;
      } else {
        flush();
        run = next;
        parts = 1;
        holes = 0;
      }
    }
    flush();
  }

  return { walls: result, bridged };
}

/**
 * Cut walls where another wall meets them part-way along.
 *
 * Face tracing walks a planar graph, and a planar graph has a node wherever two
 * edges touch. A partition landing in the middle of an outside wall is the
 * commonest arrangement in any plan: welding moves the partition's end onto the
 * wall, but unless the wall is also cut at that point the junction carries no
 * node. The partition is then a dangling spur, the walk passes straight through
 * the T, and the two rooms either side of the partition trace as one room --
 * with the partition's own floor area counted as habitable space.
 *
 * Cutting changes no quantity: two 4.5 m runs carry the same masonry, plaster
 * and paint as one 9 m run, and a wall interrupted by another wall is how the
 * junction is usually modelled anyway.
 */
function splitAtJunctions(walls: readonly WallRun[], toleranceMm: number): WallRun[] {
  const count = walls.length;
  const cuts: number[][] = walls.map(() => []);

  const geometry = walls.map((w) => {
    const dx = w.end.x - w.start.x;
    const dy = w.end.y - w.start.y;
    const length = Math.hypot(dx, dy) || 1;
    return { ux: dx / length, uy: dy / length, length };
  });

  // A cut this close to an end is the end, and slicing a stub off a wall only
  // creates a fragment too short to survive the sanity check.
  const margin = Math.max(toleranceMm, SANITY.minWallLengthMm);

  const cutAt = (index: number, t: number) => {
    const { length } = geometry[index]!;
    if (t <= margin || t >= length - margin) return;
    cuts[index]!.push(t);
  };

  for (let i = 0; i < count; i++) {
    const gi = geometry[i]!;
    const wi = walls[i]!;

    for (let j = 0; j < count; j++) {
      if (i === j) continue;

      // Where wall j ends against the body of wall i: the T-junction.
      for (const point of [walls[j]!.start, walls[j]!.end]) {
        const along = (point.x - wi.start.x) * gi.ux + (point.y - wi.start.y) * gi.uy;
        const across = Math.abs(
          -(point.x - wi.start.x) * gi.uy + (point.y - wi.start.y) * gi.ux,
        );
        if (across > toleranceMm) continue;
        cutAt(i, along);
      }

      // Where two walls cross in the body of both: the X-junction. Welding
      // leaves these alone, correctly -- neither endpoint moves -- but the
      // crossing is still a node, and a corridor crossing a spine wall makes
      // four rooms out of what would otherwise trace as none.
      if (j <= i) continue;
      const gj = geometry[j]!;
      const denominator = gi.ux * gj.uy - gi.uy * gj.ux;
      if (Math.abs(denominator) < 0.08) continue; // within ~4.5° of parallel
      const dx = walls[j]!.start.x - wi.start.x;
      const dy = walls[j]!.start.y - wi.start.y;
      const ti = (dx * gj.uy - dy * gj.ux) / denominator;
      const tj = (dx * gi.uy - dy * gi.ux) / denominator;
      if (ti <= margin || ti >= gi.length - margin) continue;
      if (tj <= margin || tj >= gj.length - margin) continue;
      cutAt(i, ti);
      cutAt(j, tj);
    }
  }

  const result: WallRun[] = [];
  for (let i = 0; i < count; i++) {
    const wall = walls[i]!;
    const { ux, uy, length } = geometry[i]!;
    const stops = [...new Set(cuts[i]!)].sort((a, b) => a - b);

    if (stops.length === 0) {
      result.push(wall);
      continue;
    }

    let previous = 0;
    const at = (t: number): Point2 => ({ x: wall.start.x + ux * t, y: wall.start.y + uy * t });
    for (const stop of [...stops, length]) {
      if (stop - previous < SANITY.minWallLengthMm) continue;
      result.push({
        ...wall,
        start: previous === 0 ? wall.start : at(previous),
        end: stop >= length ? wall.end : at(stop),
      });
      previous = stop;
    }
    // Every cut fell too close to another one: keep the wall whole rather than
    // dropping it.
    if (previous === 0) result.push(wall);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Rooms from enclosed faces
// ---------------------------------------------------------------------------

interface Node {
  point: Point2;
  edges: number[];
}

/**
 * Find the bounded faces of the wall graph.
 *
 * Walks each directed half-edge, always taking the most clockwise turn at each
 * node, which enumerates the minimal cycles. The outer face comes out with the
 * opposite winding to the rest and is discarded by area sign.
 */
interface FaceRejections {
  /** Traced clockwise: the unbounded face wrapping the drawing, or a hole. */
  outerFacing: number;
  tooSmall: number;
  tooLarge: number;
  /** The walk hit its edge limit without closing — a tangled or open graph. */
  runaway: number;
}

interface FaceResult {
  readonly faces: Point2[][];
  readonly rejected: FaceRejections;
  readonly nodeCount: number;
}

function findFaces(walls: readonly WallRun[], snapMm: number): FaceResult {
  const rejected: FaceRejections = { outerFacing: 0, tooSmall: 0, tooLarge: 0, runaway: 0 };
  const nodes: Node[] = [];
  const nodeIndex = new Map<string, number>();

  const key = (p: Point2) =>
    `${Math.round(p.x / snapMm)}:${Math.round(p.y / snapMm)}`;

  const nodeFor = (p: Point2): number => {
    const k = key(p);
    const existing = nodeIndex.get(k);
    if (existing !== undefined) return existing;
    const index = nodes.length;
    nodes.push({ point: p, edges: [] });
    nodeIndex.set(k, index);
    return index;
  };

  interface HalfEdge {
    from: number;
    to: number;
    angle: number;
    visited: boolean;
  }
  const halfEdges: HalfEdge[] = [];

  // The walk below relies on each node's edges being in true cyclic order
  // around the node, so both directions have to land in the same [0, 2pi)
  // range. `atan2` returns (-pi, pi] and the reverse edge adds pi, which puts
  // the two halves of a wall on different scales: a node with three or more
  // edges then sorts into an order that is not a rotation of the real one, the
  // walk takes a wrong turn, and the face never closes. That is invisible on a
  // single rectangular room -- every node has exactly two edges, where any
  // order is cyclically the same -- and breaks on the first T-junction, which
  // is to say on every internal partition in a real building.
  const TWO_PI = Math.PI * 2;
  const bearing = (radians: number) => ((radians % TWO_PI) + TWO_PI) % TWO_PI;

  for (const wall of walls) {
    const a = nodeFor(wall.start);
    const b = nodeFor(wall.end);
    if (a === b) continue;
    const pa = nodes[a]!.point;
    const pb = nodes[b]!.point;
    const ab = Math.atan2(pb.y - pa.y, pb.x - pa.x);

    nodes[a]!.edges.push(halfEdges.length);
    halfEdges.push({ from: a, to: b, angle: bearing(ab), visited: false });
    nodes[b]!.edges.push(halfEdges.length);
    halfEdges.push({ from: b, to: a, angle: bearing(ab + Math.PI), visited: false });
  }

  // Sort each node's outgoing edges by angle for the clockwise walk.
  for (const node of nodes) {
    node.edges.sort((x, y) => halfEdges[x]!.angle - halfEdges[y]!.angle);
  }

  const faces: Point2[][] = [];
  const MAX_FACE_EDGES = 512;

  for (let start = 0; start < halfEdges.length; start++) {
    if (halfEdges[start]!.visited) continue;

    const loop: Point2[] = [];
    let current = start;
    let guard = 0;

    while (!halfEdges[current]!.visited && guard++ < MAX_FACE_EDGES) {
      halfEdges[current]!.visited = true;
      loop.push(nodes[halfEdges[current]!.from]!.point);

      // The twin of this half-edge is its pair; step to the next edge
      // clockwise around the node we just arrived at. Clockwise means the
      // *previous* entry in a list sorted by increasing bearing, and it is what
      // makes bounded faces come out counter-clockwise. Stepping the other way
      // traces the same loop on a plain rectangle -- where every node has two
      // edges and both directions pick the only alternative -- and goes wrong
      // at the first node with three, which is any T-junction: the walk carries
      // straight on through the junction instead of turning into the room, and
      // the rooms either side of a partition trace as one.
      const twin = current % 2 === 0 ? current + 1 : current - 1;
      const arrived = halfEdges[twin]!.from;
      const outgoing = nodes[arrived]!.edges;
      const position = outgoing.indexOf(twin);
      if (position < 0) break;
      current = outgoing[(position - 1 + outgoing.length) % outgoing.length]!;
    }

    if (guard >= MAX_FACE_EDGES) rejected.runaway++;
    if (loop.length >= 3) faces.push(loop);
  }

  // Every bounded face comes out of this walk counter-clockwise; the one
  // unbounded face that wraps the whole drawing comes out clockwise. Dropping
  // it by the sign of the area is the only thing separating the rooms from the
  // building outline -- keep it and a single-room drawing reports two rooms of
  // identical area, doubling the floor area and with it every quantity and
  // every cost derived from it.
  //
  // The counts are kept because "no rooms were found" is a useless thing to
  // tell someone holding a drawing that plainly has rooms in it. Whether the
  // walk found nothing at all, or found faces and threw them away as too small,
  // points at different problems and different remedies.
  const kept: Point2[][] = [];
  for (const face of faces) {
    if (signedArea(face) <= 0) {
      rejected.outerFacing++;
      continue;
    }
    const area = polygonArea(face);
    if (area < SANITY.minRoomAreaMm2) {
      rejected.tooSmall++;
      continue;
    }
    if (area > SANITY.maxRoomAreaMm2) {
      rejected.tooLarge++;
      continue;
    }
    kept.push(face);
  }

  return { faces: kept, rejected, nodeCount: nodes.length };
}

/**
 * Inset a face by half the thickness of the walls that form it.
 *
 * A face traced along wall centrelines is bigger than the room: half a wall on
 * every side. On a 4 m room with 230 mm walls that is 12% of the floor area,
 * and floor area is what the whole estimate rests on.
 */
function insetFace(face: readonly Point2[], insetMm: number): Point2[] {
  const n = face.length;
  if (n < 3 || insetMm <= 0) return [...face];

  // Positive area means counter-clockwise, so the interior is to the left.
  // This has to read the *signed* area: `polygonArea` is absolute, so asking it
  // for a sign always answers "counter-clockwise" and a clockwise face would be
  // pushed outwards by half a wall instead of inwards -- a room reported 12%
  // too large rather than 12% too small.
  const sign = signedArea(face) > 0 ? 1 : -1;
  const result: Point2[] = [];

  for (let i = 0; i < n; i++) {
    const prev = face[(i - 1 + n) % n]!;
    const curr = face[i]!;
    const next = face[(i + 1) % n]!;

    const inward = (from: Point2, to: Point2): Point2 => {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.hypot(dx, dy) || 1;
      return { x: (-dy / len) * insetMm * sign, y: (dx / len) * insetMm * sign };
    };

    const o1 = inward(prev, curr);
    const o2 = inward(curr, next);

    // Intersect the two offset edges -- a mitre join -- rather than averaging
    // the offsets. Averaging looks close enough and is not: at a right angle,
    // the two normals are perpendicular, so their mean carries the corner only
    // half the intended distance along each axis. Every room then comes out one
    // wall thickness too wide and too deep. On a 4.4 x 3.8 m bedroom with
    // 230 mm walls that is 6% of the floor area, applied to every room in the
    // import, and floor area is what the whole estimate is built on.
    const d1 = direction(prev, curr);
    const d2 = direction(curr, next);
    const p1 = { x: curr.x + o1.x, y: curr.y + o1.y };
    const p2 = { x: curr.x + o2.x, y: curr.y + o2.y };

    const denominator = d1.x * d2.y - d1.y * d2.x;
    if (Math.abs(denominator) < 1e-9) {
      // The edges are collinear, so there is no corner to mitre.
      result.push(p1);
      continue;
    }

    const along = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / denominator;
    const mitred = { x: p1.x + d1.x * along, y: p1.y + d1.y * along };

    // A very sharp corner throws the mitre point a long way out. Rooms do not
    // have such corners, but a sliver face traced between two nearly-coincident
    // walls does, and a spike there would turn a discarded sliver into a
    // plausible-looking room. Fall back to the bevel when the mitre runs away.
    const reach = Math.hypot(mitred.x - curr.x, mitred.y - curr.y);
    result.push(reach > insetMm * MITRE_LIMIT ? { x: p1.x, y: p1.y } : mitred);
  }

  return result;
}

/** Unit vector from one point to the next. */
function direction(from: Point2, to: Point2): Point2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

/** How far past the inset distance a mitred corner may reach before bevelling. */
const MITRE_LIMIT = 4;

// ---------------------------------------------------------------------------
// Room naming
// ---------------------------------------------------------------------------

const NAME_PATTERNS: ReadonlyArray<readonly [RegExp, RoomUse]> = [
  [/reception|foyer|entrance|lobby/i, 'reception'],
  [/conferen|boardroom|meeting/i, 'conference'],
  [/open.?office|open.?plan|hall/i, 'open_office'],
  [/office|study|cabin/i, 'office'],
  [/corridor|passage|circulation/i, 'corridor'],
  [/stair|steps/i, 'stair'],
  [/lift|elevator/i, 'lift'],
  [/toilet|\bwc\b|bath|wash|powder/i, 'toilet'],
  [/kitchen|pantry/i, 'kitchen'],
  [/stor(e|age)|closet|utility/i, 'store'],
  [/bed.?room|\bbed\b|master/i, 'bedroom'],
  [/living|lounge|drawing|sitting|tv/i, 'living'],
  [/dining/i, 'dining'],
  [/shop|retail|showroom/i, 'retail'],
  [/park/i, 'parking'],
  [/lab/i, 'laboratory'],
  [/server|electric|plant|mech/i, 'plant'],
];

/** Text that is a measurement rather than a name. */
const DIMENSION_LIKE = /^[\d\s.,'"×xX\-\/]+(mm|cm|m|ft|in|sq\.?\s?ft|sqft|m2|m²)?$/i;

function pointInPolygon(point: Point2, polygon: readonly Point2[]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const pi = polygon[i]!;
    const pj = polygon[j]!;
    if (pi.y > point.y !== pj.y > point.y) {
      const x = ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x;
      if (point.x < x) inside = !inside;
    }
  }
  return inside;
}

function nameFor(
  boundary: readonly Point2[],
  texts: readonly TextItem[],
  scale: number,
): { name: string; use: RoomUse } {
  let best: TextItem | null = null;
  for (const text of texts) {
    const at = { x: text.at.x * scale, y: text.at.y * scale };
    if (!pointInPolygon(at, boundary)) continue;
    if (DIMENSION_LIKE.test(text.text.trim())) continue;
    if (best === null || (text.heightHint ?? 0) > (best.heightHint ?? 0)) best = text;
  }

  if (!best) return { name: 'Room', use: 'other' };
  const label = best.text.trim();
  for (const [pattern, use] of NAME_PATTERNS) {
    if (pattern.test(label)) return { name: label, use };
  }
  return { name: label, use: 'other' };
}

// ---------------------------------------------------------------------------
// Openings from gaps
// ---------------------------------------------------------------------------

/**
 * A gap in a wall's line work is a door or a window.
 *
 * Classification is weak without a door-swing arc to key on, so everything from
 * here is `inferred` and reported for review. Guessing a door where there is a
 * window changes nothing structural, but it changes the joinery and glazing
 * quantities, which are real money.
 */
function findOpenings(
  wall: WallRun,
  segments: readonly Seg[],
  arcs: LineWork['arcs'],
  scale: number,
  options: Required<RecogniseOptions>,
): CandidateOpening[] {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return [];
  const ux = dx / length;
  const uy = dy / length;

  // Spans of the wall that are covered by line work on either face.
  const covered: Array<[number, number]> = [];
  for (const s of segments) {
    if (angleDelta(s.angle, wall.start === wall.end ? 0 : ((Math.atan2(uy, ux) * 180) / Math.PI + 180) % 180) >
      options.parallelToleranceDeg) {
      continue;
    }
    const across = Math.abs(-(s.a.x - wall.start.x) * uy + (s.a.y - wall.start.y) * ux);
    if (across > wall.thickness / 2 + options.snapToleranceMm) continue;

    const ta = (s.a.x - wall.start.x) * ux + (s.a.y - wall.start.y) * uy;
    const tb = (s.b.x - wall.start.x) * ux + (s.b.y - wall.start.y) * uy;
    covered.push([Math.min(ta, tb), Math.max(ta, tb)]);
  }
  if (covered.length === 0) return [];

  covered.sort((a, b) => a[0] - b[0]);
  const gaps: Array<[number, number]> = [];
  let cursor = 0;
  for (const [lo, hi] of covered) {
    if (lo > cursor + options.snapToleranceMm) gaps.push([cursor, lo]);
    cursor = Math.max(cursor, hi);
  }
  if (cursor < length - options.snapToleranceMm) gaps.push([cursor, length]);

  const openings: CandidateOpening[] = [];
  for (const [lo, hi] of gaps) {
    const width = hi - lo;
    // Below 600 mm it is a junction or a drafting slip, not an opening; above
    // 4 m it is an open side, not a door.
    if (width < 600 || width > 4000) continue;

    const centre = (lo + hi) / 2;
    const at = { x: wall.start.x + ux * centre, y: wall.start.y + uy * centre };

    // A door-swing arc keyed to this gap is the one strong signal available.
    const swing = arcs.some((arc) => {
      const c = { x: arc.centre.x * scale, y: arc.centre.y * scale };
      const r = arc.radius * scale;
      if (Math.abs(r - width) > width * 0.35) return false;
      return Math.hypot(c.x - at.x, c.y - at.y) < width;
    });

    const isDoor = swing || (width >= 700 && width <= 1100);
    openings.push({
      kind: isDoor ? 'door' : 'window',
      distanceAlongWall: centre,
      width,
      height: isDoor ? 2100 : 1200,
      sillHeight: isDoor ? 0 : 900,
      confidence: 'inferred',
      note: swing
        ? 'Gap in the wall with a matching door-swing arc.'
        : `Gap in the wall ${width.toFixed(0)} mm wide; classified by width alone.`,
    });
  }

  return openings;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function recogniseFloor(work: LineWork, options: RecogniseOptions = {}): RecogniseResult {
  const started = Date.now();
  const opts: Required<RecogniseOptions> = { ...DEFAULTS, ...options };
  const issues: ImportIssue[] = [];
  const skipped: Record<string, number> = {};
  const note = (key: string, n = 1) => {
    skipped[key] = (skipped[key] ?? 0) + n;
  };

  const scale = work.toMmScale;
  if (!Number.isFinite(scale) || scale <= 0) {
    return {
      floor: null,
      issues: [
        {
          severity: 'blocking',
          code: 'NO_SCALE',
          message: 'The drawing has no usable scale, so nothing can be measured from it.',
          remedy:
            'Calibrate the scale by picking two points on the drawing and entering the real distance between them.',
        },
      ],
      stats: { floorCount: 0, roomCount: 0, wallCount: 0, openingCount: 0, skipped, parseMs: Date.now() - started },
    };
  }

  if (!work.units.confident) {
    issues.push({
      severity: 'review',
      code: 'SCALE_UNCONFIRMED',
      message: `The drawing scale (${work.units.note}) has not been confirmed.`,
      remedy: 'Check a known dimension against the imported model before relying on any quantity.',
    });
  }

  // ---- Normalise -------------------------------------------------------
  const raw: Seg[] = [];
  for (const segment of work.segments) {
    const s = makeSeg(
      { x: segment.a.x * scale, y: segment.a.y * scale },
      { x: segment.b.x * scale, y: segment.b.y * scale },
      segment.layer,
    );
    if (!s) continue;
    if (s.length < SANITY.minWallLengthMm) {
      note('segment shorter than the minimum wall length');
      continue;
    }
    raw.push(s);
  }

  if (raw.length === 0) {
    return {
      floor: null,
      issues: [
        ...issues,
        {
          severity: 'blocking',
          code: 'NO_LINES',
          message: 'The drawing contains no line work long enough to be a wall.',
          remedy: 'Check the scale calibration, and that the page holds vector geometry rather than a scan.',
        },
      ],
      stats: { floorCount: 0, roomCount: 0, wallCount: 0, openingCount: 0, skipped, parseMs: Date.now() - started },
    };
  }

  // ---- Is this the size of a building? ---------------------------------
  // Checked before anything is measured, because a scale that is out by a
  // factor of ten produces a complete, plausible-looking model of a building
  // that is not the size of the one on the drawing. Every downstream quantity
  // would be wrong by the same factor, and nothing later in the pipeline can
  // detect it. Refusing here is the only honest answer.
  const drawnWidth = (work.extent.maxX - work.extent.minX) * scale;
  const drawnDepth = (work.extent.maxY - work.extent.minY) * scale;
  const drawnAcross = Math.max(drawnWidth, drawnDepth);
  const metres = (mm: number) => (mm / 1000).toFixed(mm < 10_000 ? 2 : 0);

  if (drawnAcross > 0 && drawnAcross < SANITY.minDrawingExtentMm) {
    return {
      floor: null,
      issues: [
        ...issues,
        {
          severity: 'blocking',
          code: 'IMPLAUSIBLE_SCALE',
          message:
            `At the scale being used (${work.units.note || work.units.unit}), the whole drawing ` +
            `measures ${metres(drawnWidth)} x ${metres(drawnDepth)} m. That is smaller than any ` +
            `building, so the scale is wrong and nothing measured from it would be right.`,
          remedy:
            'Calibrate the scale by picking two points on the drawing and entering the real distance between them.',
        },
      ],
      stats: { floorCount: 0, roomCount: 0, wallCount: 0, openingCount: 0, skipped, parseMs: Date.now() - started },
    };
  }

  if (drawnAcross > SANITY.maxDrawingExtentMm) {
    issues.push({
      severity: 'review',
      code: 'DRAWING_VERY_LARGE',
      message:
        `At the scale being used, the drawing measures ${metres(drawnWidth)} x ${metres(drawnDepth)} m. ` +
        `That is a site or survey plan rather than a floor plan, or the units are out by a factor of a thousand.`,
      remedy: 'Confirm the scale before relying on any quantity taken from this import.',
    });
  }

  const segments = mergeCollinear(raw, opts.snapToleranceMm, opts.parallelToleranceDeg);

  // ---- Which line work is building fabric? -----------------------------
  // Line work on layers that say what they hold -- trees, contours, furniture,
  // dimensions -- is set aside before anything pairs into a wall. When the
  // drawing names its wall layers explicitly, and enough of the drawing sits on
  // them to look deliberate, only those layers are trusted; otherwise the
  // exclusions alone are applied, so a drawing with no layer discipline is read
  // exactly as it was before.
  const byRole = { wall: 0, excluded: 0, unknown: 0 };
  for (const s of segments) byRole[classifyLayer(s.layer)]++;

  const namesItsWalls = byRole.wall >= 20 && byRole.wall >= segments.length * 0.1;
  const fabric = segments.filter((s) => {
    const role = classifyLayer(s.layer);
    return namesItsWalls ? role === 'wall' : role !== 'excluded';
  });

  if (byRole.excluded > 0) {
    note('line work on layers that are not building fabric', byRole.excluded);
  }
  if (namesItsWalls && byRole.unknown > 0) {
    note('line work on layers not named as walls', byRole.unknown);
    issues.push({
      severity: 'info',
      code: 'WALL_LAYERS_USED',
      message:
        `The drawing names its wall layers, so only the ${byRole.wall} line(s) on them were read ` +
        `as walls; ${byRole.unknown} line(s) on other layers were left out.`,
      remedy: 'If walls are missing from the model, they are probably drawn on a differently named layer.',
    });
  }

  if (fabric.length === 0) {
    return {
      floor: null,
      issues: [
        ...issues,
        {
          severity: 'blocking',
          code: 'NO_FABRIC_LINES',
          message:
            `All ${segments.length} line(s) in the drawing sit on layers that hold something other ` +
            `than building fabric, so there is nothing to read as a wall.`,
          remedy: 'Check that the floor plan layers are turned on in the exported file.',
        },
      ],
      stats: { floorCount: 0, roomCount: 0, wallCount: 0, openingCount: 0, skipped, parseMs: Date.now() - started },
    };
  }

  // ---- Walls -----------------------------------------------------------
  const { walls: paired, unpaired } = pairWalls(fabric, opts);

  const singles: WallRun[] = [];
  for (const s of unpaired) {
    if (s.length < opts.minSingleLineWallMm) {
      note('unpaired short line (annotation or noise)');
      continue;
    }
    singles.push({
      start: s.a,
      end: s.b,
      thickness: opts.singleLineWallThicknessMm,
      confidence: 'inferred',
      note: `Single line ${(s.length / 1000).toFixed(2)} m long; thickness assumed.`,
    });
  }

  const longEnough = paired.filter(
    (w) => Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y) >= opts.minWallRunMm,
  );
  if (paired.length - longEnough.length > 0) {
    note('paired lines too short to be a wall run', paired.length - longEnough.length);
  }

  const walls = [...longEnough, ...singles];
  if (walls.length === 0) {
    return {
      floor: null,
      issues: [
        ...issues,
        {
          severity: 'blocking',
          code: 'NO_WALLS',
          message: `None of the ${fabric.length} lines of building fabric could be read as a wall.`,
          remedy:
            'The drawing may be at the wrong scale, or drawn in a style the recogniser does not handle. Check the calibration first.',
        },
      ],
      stats: { floorCount: 0, roomCount: 0, wallCount: 0, openingCount: 0, skipped, parseMs: Date.now() - started },
    };
  }

  if (singles.length > 0) {
    issues.push({
      severity: 'review',
      code: 'SINGLE_LINE_WALLS',
      message:
        `${singles.length} wall(s) were read from a single line, so their thickness was assumed at ` +
        `${opts.singleLineWallThicknessMm} mm rather than measured.`,
      remedy: 'Set their real thickness in the plan editor; it drives the masonry quantity.',
    });
  }

  // ---- Rooms -----------------------------------------------------------
  // Rejoin the runs a drawing breaks at every door, then weld the junctions --
  // unwelded centrelines never close an enclosure -- and finally cut every wall
  // at the junctions welding has just created, so the T and X junctions the
  // plan is mostly made of become nodes the walk can turn at rather than walls
  // passing through one another.
  const { walls: continuous, bridged } = bridgeOpenings(walls, opts);
  if (bridged > 0) note('opening-sized gaps bridged into continuous walls', bridged);
  const { welded, junctions } = weldWalls(continuous, opts.snapToleranceMm);
  const split = splitAtJunctions(welded, opts.snapToleranceMm);
  const { faces, rejected, nodeCount } = findFaces(split, opts.snapToleranceMm * 4);
  const medianThickness = median(split.map((w) => w.thickness));
  note('wall junctions welded', junctions);
  if (split.length > welded.length) note('walls cut at junctions', split.length - welded.length);
  if (rejected.tooSmall > 0) note('enclosure smaller than the minimum room area', rejected.tooSmall);
  if (rejected.tooLarge > 0) note('enclosure larger than the maximum room area', rejected.tooLarge);
  if (rejected.runaway > 0) note('face trace abandoned without closing', rejected.runaway);

  const rooms: CandidateRoom[] = [];
  for (const face of faces) {
    const boundary = insetFace(face, medianThickness / 2);
    const area = polygonArea(boundary);
    if (area < SANITY.minRoomAreaMm2) {
      note('face too small to be a room');
      continue;
    }
    // A face whose perimeter is wildly out of proportion to its area is a
    // sliver produced by two nearly-coincident walls, not a room.
    const perimeter = polygonPerimeter(boundary);
    if (perimeter > 0 && (4 * Math.PI * area) / (perimeter * perimeter) < 0.05) {
      note('face too slender to be a room');
      continue;
    }

    const { name, use } = nameFor(boundary, work.texts, scale);
    rooms.push({
      name,
      use,
      boundary,
      clearHeight: opts.defaultClearHeightMm,
      confidence: 'extracted',
      note: 'Enclosed by recognised walls; boundary inset by half a wall thickness.',
    });
  }

  if (rooms.length === 0) {
    // Why nothing enclosed decides what the user should do about it, and the
    // three causes call for three different actions.
    const diagnosis =
      rejected.tooSmall > 0
        ? `${rejected.tooSmall} enclosure(s) were found but every one was under the ` +
          `${(SANITY.minRoomAreaMm2 / 1e6).toFixed(0)} m² minimum, which usually means the drawing ` +
          `is being read at the wrong scale.`
        : rejected.runaway > 0
          ? `${rejected.runaway} trace(s) ran on without closing, which happens when walls overlap ` +
            `or cross without meeting cleanly.`
          : `The wall centrelines leave gaps, so no loop closes.`;

    issues.push({
      severity: 'review',
      code: 'NO_ROOMS',
      message:
        `${split.length} wall(s) were recognised across ${nodeCount} junction(s) but they do not ` +
        `enclose any room. ${diagnosis} Wall quantities will be available; floor and finish ` +
        `quantities will not.`,
      remedy:
        rejected.tooSmall > 0
          ? 'Check the scale calibration first, then close any gaps in the plan editor.'
          : 'Close the gaps in the plan editor, or draw the rooms by hand.',
    });
  }

  // ---- Openings --------------------------------------------------------
  const candidateWalls: CandidateWall[] = split.map((wall) => ({
    start: wall.start,
    end: wall.end,
    thickness: wall.thickness,
    height: opts.defaultClearHeightMm,
    function: wall.thickness >= 200 ? 'exterior' : 'partition',
    loadBearing: wall.thickness >= 200,
    confidence: wall.confidence,
    note: wall.note,
    openings: findOpenings(wall, fabric, work.arcs, scale, opts),
  }));

  const openingCount = candidateWalls.reduce((n, w) => n + w.openings.length, 0);
  if (openingCount > 0) {
    issues.push({
      severity: 'review',
      code: 'OPENINGS_INFERRED',
      message:
        `${openingCount} opening(s) were inferred from gaps in the wall line work. ` +
        `Which are doors and which are windows is a guess based on width.`,
      remedy: 'Correct them in the plan editor; they drive the joinery and glazing quantities.',
    });
  }

  // ---- Heights ---------------------------------------------------------
  issues.push({
    severity: 'review',
    code: 'HEIGHTS_ASSUMED',
    message:
      `A plan carries no heights, so every room and wall was given the default ` +
      `${(opts.defaultClearHeightMm / 1000).toFixed(2)} m clear height.`,
    remedy: 'Set the real floor-to-floor height; it drives wall area, plaster and paint quantities.',
  });

  const floor: CandidateFloor = {
    name: options.floorName ?? work.sheetName ?? DEFAULTS.floorName,
    level: opts.level,
    elevation: opts.level * opts.defaultFloorToFloorMm,
    floorToFloor: opts.defaultFloorToFloorMm,
    clearHeight: opts.defaultClearHeightMm,
    confidence: 'inferred',
    rooms,
    walls: candidateWalls,
  };

  return {
    floor,
    issues,
    stats: {
      floorCount: 1,
      roomCount: rooms.length,
      wallCount: candidateWalls.length,
      openingCount,
      skipped: {
        ...skipped,
        'lines merged into runs': raw.length - segments.length,
        'walls from paired lines': longEnough.length,
        'walls from a single line': singles.length,
      },
      parseMs: Date.now() - started,
    },
  };
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}
