/**
 * SPACE-AWARE DESIGN VALIDATION.
 *
 * Requirement 22: never block doors or emergency exits, never place furniture
 * through walls, never exceed room dimensions, never place objects where they
 * physically cannot fit.
 *
 * This runs as a hard gate on every AI-produced furniture layout. A model asked
 * for "a premium reception" will cheerfully specify a 3.6 m desk for a 3 m room,
 * and the only reliable defence is to check the geometry rather than to ask the
 * model more nicely. Violations are returned with the measurement that failed,
 * so the design agent can be re-prompted with a specific correction instead of
 * a vague retry.
 */

import {
  distancePointToSegment,
  pointInPolygon,
  rectCorners,
  rectInsidePolygon,
  rectsOverlap,
  type OrientedRect,
} from '../geometry.js';
import type { Point2 } from '../model/architecture.js';
import type { Opening, Room, Wall } from '../model/architecture.js';
import type { FurniturePlacement } from '../model/design.js';
import type { FurnitureId } from '../model/ids.js';
import { fromMm } from '../units.js';

export type ViolationKind =
  | 'outside_room'
  | 'overlaps_furniture'
  | 'intersects_wall'
  | 'blocks_door'
  | 'blocks_emergency_exit'
  | 'insufficient_circulation'
  | 'clearance_not_met';

export type Severity = 'error' | 'warning';

export interface ClearanceViolation {
  readonly kind: ViolationKind;
  readonly severity: Severity;
  readonly furnitureId: FurnitureId;
  readonly label: string;
  readonly message: string;
  /** The failing measurement and what it needed to be, for AI re-prompting. */
  readonly measured?: { readonly actualMm: number; readonly requiredMm: number };
}

/**
 * Clearance rules.
 *
 * These are conventional accessibility and egress dimensions rather than any one
 * jurisdiction's code. They are deliberately conservative and are surfaced as
 * warnings where a local authority might differ, because this tool does not
 * certify compliance — see the professional-review notice.
 */
export interface ClearanceRules {
  /** Clear space that must remain in front of any door leaf swing. */
  readonly doorSwingClearanceMm: number;
  /** Clear width of an escape route. */
  readonly egressWidthMm: number;
  /** Minimum walkable gap between furniture items in circulation. */
  readonly circulationGapMm: number;
  /** Gap that must remain between furniture and a wall face for access. */
  readonly wallGapMm: number;
}

export const DEFAULT_CLEARANCE: ClearanceRules = {
  doorSwingClearanceMm: 900,
  egressWidthMm: 1100,
  circulationGapMm: 750,
  wallGapMm: 50,
};

function toRect(f: FurniturePlacement): OrientedRect {
  return { centre: f.position, width: f.width, depth: f.depth, rotationDeg: f.rotationDeg };
}

/** The rectangle an item needs including its front working clearance. */
function toRectWithClearance(f: FurniturePlacement): OrientedRect {
  const front = f.clearanceFront ?? 0;
  if (front === 0) return toRect(f);
  const rad = (f.rotationDeg * Math.PI) / 180;
  return {
    centre: {
      x: f.position.x + (front / 2) * Math.sin(rad),
      y: f.position.y - (front / 2) * Math.cos(rad),
    },
    width: f.width,
    depth: f.depth + front,
    rotationDeg: f.rotationDeg,
  };
}

/**
 * Shortest distance from a point to a rectangle — to its nearest EDGE, not its
 * nearest corner.
 *
 * Measuring to corners is the intuitive shortcut and it is wrong in exactly the
 * case that matters: a desk parked square in front of a door has its long edge
 * 250 mm away while both corners are over a metre off. The corner measurement
 * reports ample clearance across a completely blocked doorway.
 */
function distancePointToRect(p: Point2, rect: OrientedRect): number {
  const corners = rectCorners(rect);
  if (pointInPolygon(p, corners)) return 0;
  let min = Infinity;
  for (let i = 0; i < 4; i++) {
    min = Math.min(min, distancePointToSegment(p, corners[i]!, corners[(i + 1) % 4]!));
  }
  return min;
}

/** World-space position of an opening's centre along its wall. */
function openingCentre(wall: Wall, opening: Opening): { x: number; y: number } {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: wall.start.x, y: wall.start.y };
  const t = opening.distanceAlongWall / len;
  return { x: wall.start.x + dx * t, y: wall.start.y + dy * t };
}

export function validatePlacements(
  room: Room,
  furniture: readonly FurniturePlacement[],
  walls: readonly Wall[],
  rules: ClearanceRules = DEFAULT_CLEARANCE,
): ClearanceViolation[] {
  const violations: ClearanceViolation[] = [];
  const inRoom = furniture.filter((f) => f.roomId === room.id);
  const boundingWalls = walls.filter((w) => room.boundingWallIds.includes(w.id));

  for (const f of inRoom) {
    const rect = toRect(f);

    // ---- Inside the room at all? -----------------------------------------
    if (!rectInsidePolygon(rect, room.boundary)) {
      violations.push({
        kind: 'outside_room',
        severity: 'error',
        furnitureId: f.id,
        label: f.label,
        message:
          `"${f.label}" (${fromMm(f.width, 'ft').toFixed(2)} x ${fromMm(f.depth, 'ft').toFixed(2)} ft) ` +
          `does not fit inside ${room.name} at its current position and rotation.`,
      });
      continue; // Further checks are meaningless once it is outside.
    }

    // ---- Wall intersection ------------------------------------------------
    for (const wall of boundingWalls) {
      const corners = rectCorners(rect);
      // Nearest approach between the wall centreline and the furniture outline,
      // measured both ways so a rectangle straddling the line is caught.
      const nearest = Math.min(
        ...corners.map((c) => distancePointToSegment(c, wall.start, wall.end)),
        distancePointToRect(wall.start, rect),
        distancePointToRect(wall.end, rect),
      );
      const halfThickness = wall.thickness / 2;
      if (nearest < halfThickness) {
        violations.push({
          kind: 'intersects_wall',
          severity: 'error',
          furnitureId: f.id,
          label: f.label,
          message: `"${f.label}" passes into the face of a ${fromMm(wall.thickness, 'in').toFixed(1)} in wall.`,
          measured: { actualMm: nearest, requiredMm: halfThickness + rules.wallGapMm },
        });
        break;
      }
    }

    // ---- Door swing and egress -------------------------------------------
    for (const wall of boundingWalls) {
      for (const opening of wall.openings) {
        if (opening.kind !== 'door' && opening.kind !== 'archway') continue;
        const centre = openingCentre(wall, opening);
        const nearest = distancePointToRect(centre, rect);
        const required = opening.isEmergencyExit
          ? Math.max(rules.egressWidthMm, rules.doorSwingClearanceMm)
          : rules.doorSwingClearanceMm;

        if (nearest < required) {
          violations.push({
            kind: opening.isEmergencyExit ? 'blocks_emergency_exit' : 'blocks_door',
            severity: 'error',
            furnitureId: f.id,
            label: f.label,
            message: opening.isEmergencyExit
              ? `"${f.label}" stands within ${fromMm(nearest, 'ft').toFixed(2)} ft of a designated ` +
                `emergency exit, which must keep ${fromMm(required, 'ft').toFixed(2)} ft clear. ` +
                `Escape routes are never negotiable against layout preference.`
              : `"${f.label}" obstructs a door that needs ${fromMm(required, 'ft').toFixed(2)} ft of ` +
                `clear swing; only ${fromMm(nearest, 'ft').toFixed(2)} ft is available.`,
            measured: { actualMm: nearest, requiredMm: required },
          });
        }
      }
    }

    // ---- Working clearance in front of the item ---------------------------
    if (f.clearanceFront && f.clearanceFront > 0) {
      const withClearance = toRectWithClearance(f);
      if (!rectInsidePolygon(withClearance, room.boundary)) {
        violations.push({
          kind: 'clearance_not_met',
          severity: 'warning',
          furnitureId: f.id,
          label: f.label,
          message:
            `"${f.label}" fits, but its ${fromMm(f.clearanceFront, 'ft').toFixed(2)} ft working ` +
            `clearance extends beyond the room. The item will be unusable as placed.`,
        });
      }
    }
  }

  // ---- Furniture against furniture ----------------------------------------
  for (let i = 0; i < inRoom.length; i++) {
    for (let j = i + 1; j < inRoom.length; j++) {
      const a = inRoom[i]!;
      const b = inRoom[j]!;
      if (rectsOverlap(toRect(a), toRect(b))) {
        violations.push({
          kind: 'overlaps_furniture',
          severity: 'error',
          furnitureId: b.id,
          label: b.label,
          message: `"${b.label}" overlaps "${a.label}".`,
        });
      } else if (rectsOverlap(toRectWithClearance(a), toRectWithClearance(b))) {
        violations.push({
          kind: 'insufficient_circulation',
          severity: 'warning',
          furnitureId: b.id,
          label: b.label,
          message:
            `"${b.label}" and "${a.label}" fit, but their working clearances overlap. ` +
            `Chairs will collide when both are in use.`,
        });
      }
    }
  }

  return violations;
}

export function hasBlockingViolations(violations: readonly ClearanceViolation[]): boolean {
  return violations.some((v) => v.severity === 'error');
}

/**
 * A correction brief for re-prompting the design agent.
 *
 * Feeding the model its own failures with the exact measurements converges far
 * faster than asking it to try again, and it keeps a record of what was wrong
 * for the audit trail.
 */
export function violationsToCorrectionBrief(violations: readonly ClearanceViolation[]): string {
  if (violations.length === 0) return '';
  const errors = violations.filter((v) => v.severity === 'error');
  const warnings = violations.filter((v) => v.severity === 'warning');
  const lines: string[] = [
    'The proposed layout was rejected by the geometric validator. Fix these before proposing again.',
    '',
  ];
  if (errors.length > 0) {
    lines.push('MUST FIX:');
    for (const v of errors) {
      const m = v.measured
        ? ` (measured ${(v.measured.actualMm / 304.8).toFixed(2)} ft, needs ${(v.measured.requiredMm / 304.8).toFixed(2)} ft)`
        : '';
      lines.push(`  - ${v.message}${m}`);
    }
  }
  if (warnings.length > 0) {
    lines.push('', 'SHOULD FIX:');
    for (const v of warnings) lines.push(`  - ${v.message}`);
  }
  lines.push(
    '',
    'Do not resolve these by changing room dimensions. The architecture is fixed; change the furniture ' +
      'selection, size, quantity or position instead.',
  );
  return lines.join('\n');
}

/**
 * "What can I fit here?" — requirement 54.
 *
 * Reports capacity from the room's real area using conventional occupancy
 * densities, and states the density used so the number can be argued with.
 */
export interface CapacityEstimate {
  readonly roomName: string;
  readonly areaSqft: number;
  readonly suggestions: ReadonlyArray<{
    readonly what: string;
    readonly count: number;
    readonly basis: string;
  }>;
}

/** Net usable area after circulation, as a fraction of gross room area. */
const CIRCULATION_FACTOR = 0.75;

export function estimateCapacity(room: Room, areaSqft: number): CapacityEstimate {
  const usable = areaSqft * CIRCULATION_FACTOR;
  const suggestions: Array<{ what: string; count: number; basis: string }> = [];

  const push = (what: string, sqftEach: number, basis: string) => {
    suggestions.push({ what, count: Math.floor(usable / sqftEach), basis });
  };

  switch (room.use) {
    case 'open_office':
    case 'office':
      push('Workstations', 60, '60 sq ft per person including local circulation');
      push('Meeting pods (4-person)', 120, '120 sq ft each');
      break;
    case 'conference':
    case 'meeting':
      push('Boardroom seats', 30, '30 sq ft per seated place at a table');
      break;
    case 'training':
      push('Classroom seats (tables)', 25, '25 sq ft per place, table layout');
      push('Theatre seats', 12, '12 sq ft per place, no tables');
      break;
    case 'reception':
    case 'lobby':
      push('Waiting seats', 25, '25 sq ft per lounge seat with circulation');
      break;
    case 'laboratory':
      push('Lab benches (1.8 m)', 90, '90 sq ft per bench position including access both sides');
      break;
    case 'dining':
      push('Covers', 18, '18 sq ft per cover, casual dining');
      break;
    default:
      push('Occupants (general office density)', 60, '60 sq ft per person');
      break;
  }

  return {
    roomName: room.name,
    areaSqft,
    suggestions: suggestions.map((s) => ({
      ...s,
      basis: `${s.basis}; ${((1 - CIRCULATION_FACTOR) * 100).toFixed(0)}% of gross area reserved for circulation`,
    })),
  };
}
