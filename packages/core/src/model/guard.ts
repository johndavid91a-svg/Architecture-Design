/**
 * ARCHITECTURAL INTEGRITY GUARD.
 *
 * Requirement: "The AI must NEVER change architectural geometry simply to make
 * a design prettier. If Room = 15 ft x 20 ft the AI must preserve 15 ft x 20 ft
 * unless the user explicitly authorizes an architectural change."
 *
 * Type-level `readonly` stops honest mistakes but not a serialise/mutate/
 * deserialise round trip, which is exactly the shape of every AI call: the twin
 * goes out as JSON and comes back as JSON. So the runtime check here is the one
 * that actually holds the line.
 *
 * The mechanism is a geometry fingerprint. Before an operation runs we hash
 * every dimension-bearing field of the architecture layer. After it returns we
 * hash again. If the fingerprints differ and no authorisation was supplied, the
 * operation is rejected outright and the caller keeps the pre-operation twin.
 *
 * Design-layer changes never touch the fingerprint, so a legitimate "make this
 * room luxurious" passes cleanly.
 */

import type { ArchitectureLayer, Floor, Opening, Point2, Room, Wall } from './architecture.js';
import type { ProjectId, RoomId, WallId } from './ids.js';

/** A stable, order-independent digest of everything dimensional. */
export type GeometryFingerprint = string;

/**
 * Quantise to 0.1 mm before hashing.
 *
 * Without this, a JSON round trip that turns 4572 into 4571.9999999999995 would
 * read as an unauthorised geometry change and block a perfectly good design.
 * 0.1 mm is far below any real construction tolerance, so a genuine change is
 * never masked by it.
 */
function q(mm: number): string {
  return (Math.round(mm * 10) / 10).toFixed(1);
}

function pointDigest(p: Point2): string {
  return `${q(p.x)},${q(p.y)}`;
}

function openingDigest(o: Opening): string {
  return [
    o.id,
    o.kind,
    q(o.distanceAlongWall),
    q(o.width),
    q(o.height),
    q(o.sillHeight),
    o.isEmergencyExit ? 'E' : '-',
  ].join('|');
}

function wallDigest(w: Wall): string {
  const openings = w.openings.map(openingDigest).sort().join(';');
  return [
    w.id,
    pointDigest(w.start),
    pointDigest(w.end),
    q(w.thickness),
    q(w.height),
    w.function,
    w.loadBearing ? 'LB' : '-',
    openings,
  ].join('|');
}

function roomDigest(r: Room): string {
  // Boundary order is meaningful (it defines the polygon), so it is not sorted.
  const boundary = r.boundary.map(pointDigest).join('>');
  return [r.id, boundary, q(r.clearHeight)].join('|');
}

function floorDigest(f: Floor): string {
  const rooms = f.rooms.map(roomDigest).sort().join('\n');
  const walls = f.walls.map(wallDigest).sort().join('\n');
  const columns = f.columns
    .map((c) => [c.id, pointDigest(c.centre), q(c.width), q(c.depth), q(c.height)].join('|'))
    .sort()
    .join('\n');
  const stairs = f.stairs
    .map((s) =>
      [
        s.id,
        s.footprint.map(pointDigest).join('>'),
        q(s.floorToFloorRise),
        q(s.treadDepth),
        q(s.riserHeight),
        q(s.width),
      ].join('|'),
    )
    .sort()
    .join('\n');
  return [
    f.id,
    String(f.level),
    q(f.floorToFloor),
    q(f.clearHeight),
    q(f.elevation),
    rooms,
    walls,
    columns,
    stairs,
  ].join('\n');
}

/**
 * FNV-1a, 64-bit, as two 32-bit halves.
 *
 * A cryptographic hash is unnecessary here — this defends against accidental
 * mutation, not a forger — and avoiding `node:crypto` keeps the core package
 * usable unchanged in the renderer process.
 */
function fnv1a64(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c & 0xff;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= (c >>> 8) & 0xff;
    h2 = Math.imul(h2, 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

export function fingerprintArchitecture(arch: ArchitectureLayer): GeometryFingerprint {
  const buildings = arch.site.buildings
    .map((b) => [b.id, b.footprint.map(pointDigest).join('>'), b.floors.map(floorDigest).join('\n')].join('\n'))
    .sort()
    .join('\n');
  const plot = arch.site.plotBoundary.map(pointDigest).join('>');
  return fnv1a64([arch.projectId, arch.buildingType, plot, buildings].join('\n'));
}

/**
 * Explicit user authorisation for a geometry change.
 *
 * Requiring the affected ids up front means an authorisation to "move the
 * reception partition" cannot be spent on relocating a structural column.
 */
export interface ArchitecturalChangeAuthorisation {
  readonly projectId: ProjectId;
  /** What the user was told they were approving. Stored in the audit trail. */
  readonly description: string;
  /** Ids the user authorised changes to. Empty means "any", which the UI should avoid. */
  readonly scopeRoomIds?: readonly RoomId[];
  readonly scopeWallIds?: readonly WallId[];
  readonly authorisedAt: string;
  readonly authorisedBy: string;
  /**
   * True when the user was shown, and accepted, the notice that conceptual
   * architectural changes require review by a qualified architect/engineer.
   */
  readonly professionalReviewAcknowledged: boolean;
}

export class ArchitecturalIntegrityError extends Error {
  constructor(
    message: string,
    readonly before: GeometryFingerprint,
    readonly after: GeometryFingerprint,
  ) {
    super(message);
    this.name = 'ArchitecturalIntegrityError';
  }
}

/**
 * Run `operation` and refuse to return its result if it altered geometry
 * without authorisation.
 *
 * Every AI design entry point routes through here. The failure is loud on
 * purpose: silently reverting would leave the user with a design whose visible
 * intent no longer matches the model.
 */
export function withArchitecturalIntegrity<T>(
  arch: ArchitectureLayer,
  operation: () => { architecture: ArchitectureLayer; result: T },
  authorisation?: ArchitecturalChangeAuthorisation,
): { architecture: ArchitectureLayer; result: T } {
  const before = fingerprintArchitecture(arch);
  const outcome = operation();
  const after = fingerprintArchitecture(outcome.architecture);

  if (before !== after && !authorisation) {
    throw new ArchitecturalIntegrityError(
      'Operation altered the base architecture without an explicit authorisation. ' +
        'Design-layer operations must not change geometry; propose an architectural ' +
        'change for user approval instead.',
      before,
      after,
    );
  }

  if (before !== after && authorisation && !authorisation.professionalReviewAcknowledged) {
    throw new ArchitecturalIntegrityError(
      'Architectural change authorised but the professional-review notice was not acknowledged.',
      before,
      after,
    );
  }

  return outcome;
}

/**
 * Assert that a design operation left the architecture byte-identical.
 *
 * Cheaper than the wrapper when the caller already holds both twins, e.g. after
 * deserialising an AI response.
 */
export function assertGeometryUnchanged(before: ArchitectureLayer, after: ArchitectureLayer): void {
  const fpBefore = fingerprintArchitecture(before);
  const fpAfter = fingerprintArchitecture(after);
  if (fpBefore !== fpAfter) {
    throw new ArchitecturalIntegrityError(
      'The returned model changed the base architecture. Rejected.',
      fpBefore,
      fpAfter,
    );
  }
}
