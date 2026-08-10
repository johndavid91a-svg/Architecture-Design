/**
 * Applying a theme to real rooms.
 *
 * A theme states a design language. This turns that language into concrete
 * finish assignments, lighting counts and furniture placements for a specific
 * room of a specific size and use — deterministically, without a model call.
 *
 * That matters for three reasons. It gives the user a usable design instantly,
 * with no API key and no latency. It gives the AI agents a baseline to modify
 * rather than a blank room, which is a far easier problem. And it means the
 * takeoff and the cost engine have something to work on from the first minute,
 * which is what makes the estimation half of the product testable at all.
 *
 * Every furniture placement produced here is run through the same clearance
 * validator that AI proposals face. Nothing is exempt.
 */

import { boundsOf, centroid, polygonArea } from '../geometry.js';
import type { Floor, Room, Wall } from '../model/architecture.js';
import type {
  CeilingTreatment,
  Design,
  FinishAssignment,
  FloorDesign,
  FurniturePlacement,
  LightingAssignment,
  RoomDesign,
} from '../model/design.js';
import { newId, type FurnitureId, type MaterialId, type RoomId } from '../model/ids.js';
import { findFurniture, furnitureForStyle } from '../catalogue/furniture.js';
import type { Theme } from '../themes/theme.js';
import { validatePlacements, type ClearanceViolation } from './clearance.js';
import { fromMm2 } from '../units.js';

/** Rooms that get the circulation floor rather than the primary one. */
const CIRCULATION_USES = new Set(['corridor', 'lobby', 'stair', 'lift']);
/** Rooms where a soft floor is conventional and cheaper. */
const SOFT_FLOOR_USES = new Set([
  'open_office',
  'office',
  'executive_office',
  'meeting',
  'training',
  'library',
  'auditorium',
]);
/**
 * Rooms that get no false ceiling regardless of theme.
 *
 * A planetarium's ceiling is the projection dome and an observatory's opens to
 * the sky; billing either for a suspended grid would be inventing work that
 * cannot be done. Exhibition halls are here too — they are run as exposed
 * services so the lighting can be re-rigged for each show.
 */
const NO_CEILING_USES = new Set([
  'stair',
  'lift',
  'plant',
  'parking',
  'planetarium',
  'observatory',
  'exhibition',
]);

/** Illuminance targets, lux, by room use. Drives the fitting count. */
const LUX_TARGET: Record<string, number> = {
  reception: 300,
  lobby: 200,
  office: 500,
  open_office: 500,
  executive_office: 400,
  conference: 400,
  meeting: 400,
  laboratory: 600,
  server_room: 300,
  training: 500,
  lounge: 200,
  corridor: 150,
  toilet: 200,
  store: 150,
  retail: 750,
  kitchen: 500,
  pantry: 300,
  dining: 200,
  // Public and scientific rooms, from the EN 12464-1 task-illuminance classes.
  // The two dark rooms are the ones that matter: a planetarium or an observatory
  // lit to office levels is unusable for the thing it exists to do, and lighting
  // load is a real cost line, not a presentation detail.
  exhibition: 300,
  planetarium: 50,
  auditorium: 200,
  observatory: 50,
  control_room: 500,
  library: 500,
};

/**
 * Lumens delivered per fitting, after allowing for losses.
 *
 * A round figure for a typical commercial LED downlight or a metre of linear
 * LED, derated for maintenance and utilisation. It produces counts in the right
 * region without pretending to be a lighting design — which is why the
 * assumption is stated on the estimate rather than hidden.
 */
const USEFUL_LUMENS_PER_FITTING = 2200;

export interface ApplyThemeOptions {
  /** Fill the room with furniture appropriate to its use. */
  readonly includeFurniture: boolean;
  /** Rooms to skip, e.g. ones the user has already designed by hand. */
  readonly skipRoomIds?: readonly RoomId[];
}

export interface AppliedTheme {
  readonly floors: readonly FloorDesign[];
  /** Clearance problems found while placing furniture. Never silently dropped. */
  readonly violations: readonly ClearanceViolation[];
  /** Items that could not be placed because the room ran out of space. */
  readonly unplaced: readonly string[];
}

function finishesForRoom(room: Room, theme: Theme): FinishAssignment[] {
  const finishes: FinishAssignment[] = [];

  const floorMaterial: MaterialId = CIRCULATION_USES.has(room.use)
    ? (theme.materials.circulationFloor ?? theme.materials.primaryFloor)
    : SOFT_FLOOR_USES.has(room.use) && theme.materials.secondaryFloor
      ? theme.materials.secondaryFloor
      : theme.materials.primaryFloor;

  finishes.push({ surface: 'floor', materialId: floorMaterial });
  finishes.push({ surface: 'wall_internal', materialId: theme.materials.primaryWall });
  finishes.push({ surface: 'skirting', materialId: 'mat_skirting' as MaterialId });

  // A feature wall goes only where it earns its cost: the rooms a client sees.
  if (theme.materials.featureWall && (room.use === 'reception' || room.use === 'conference' || room.use === 'executive_office')) {
    finishes.push({
      surface: 'wall_internal',
      materialId: theme.materials.featureWall,
      // A dado rather than full height — it is a feature, not a lining, and
      // full-height stone on four walls is how a budget disappears.
      heightLimit: Math.min(room.clearHeight, 2400),
      note: 'Feature wall treatment',
    });
  }

  return finishes;
}

function ceilingForRoom(room: Room, theme: Theme): CeilingTreatment {
  if (NO_CEILING_USES.has(room.use)) return { kind: 'none' };
  if (theme.ceilingKind === 'exposed' || theme.ceilingKind === 'none') {
    return { kind: theme.ceilingKind };
  }
  return {
    kind: theme.ceilingKind,
    materialId: theme.materials.ceiling,
    // A false ceiling eats clear height. Recording the drop keeps the 3D view
    // and any headroom check honest.
    dropHeight: theme.ceilingKind === 'gypsum_coffered' ? 450 : 300,
  };
}

function lightingForRoom(room: Room, theme: Theme): LightingAssignment[] {
  const areaSqft = fromMm2(polygonArea(room.boundary), 'ft2');
  const areaSqm = areaSqft * 0.092903;
  const target = LUX_TARGET[room.use] ?? 300;
  const count = Math.max(1, Math.round((target * areaSqm) / USEFUL_LUMENS_PER_FITTING));

  const assignments: LightingAssignment[] = [
    {
      kind: theme.lighting.primary,
      count,
      wattsEach: 18,
      colourTemperatureK: theme.lighting.colourTemperatureK,
      note: `${target} lux target over ${areaSqm.toFixed(1)} m²`,
    },
  ];

  // Feature lighting only where there is something to light.
  if (
    theme.lighting.feature &&
    (room.use === 'reception' || room.use === 'conference' || room.use === 'executive_office' || room.use === 'lounge')
  ) {
    assignments.push({
      kind: theme.lighting.feature,
      count: Math.max(1, Math.round(count / 4)),
      wattsEach: 12,
      colourTemperatureK: theme.lighting.colourTemperatureK,
      note: 'Feature lighting',
    });
  }

  return assignments;
}

/** A furniture programme for a room use: what goes in, in priority order. */
interface ProgrammeItem {
  readonly catalogueKey: string;
  readonly label: string;
  /** How many, or `'fill'` to place as many as fit. */
  readonly count: number | 'fill';
}

function programmeFor(room: Room, theme: Theme): ProgrammeItem[] {
  const style = theme.furnitureStyle;
  const has = (key: string) => furnitureForStyle(style).some((f) => f.key === key);
  const pick = (preferred: string, fallback: string) => (has(preferred) ? preferred : fallback);

  switch (room.use) {
    case 'reception':
    case 'lobby':
      return [
        { catalogueKey: 'reception.desk.2400', label: 'Reception desk', count: 1 },
        { catalogueKey: 'seating.sofa.3', label: 'Waiting sofa', count: 1 },
        { catalogueKey: 'seating.lounge.chair', label: 'Lounge chair', count: 2 },
        { catalogueKey: 'decor.planter.large', label: 'Planter', count: 2 },
      ];
    case 'conference':
    case 'meeting': {
      const area = fromMm2(polygonArea(room.boundary), 'ft2');
      const table = area > 450 ? 'table.conference.14' : 'table.conference.8';
      return [
        { catalogueKey: table, label: 'Conference table', count: 1 },
        { catalogueKey: 'display.screen.75', label: 'Display screen', count: 1 },
      ];
    }
    case 'executive_office':
      return [
        { catalogueKey: pick('desk.executive.1800', 'desk.workstation.1600'), label: 'Executive desk', count: 1 },
        { catalogueKey: 'chair.executive', label: 'Executive chair', count: 1 },
        { catalogueKey: 'seating.sofa.3', label: 'Sofa', count: 1 },
        { catalogueKey: 'storage.cabinet.1000', label: 'Cabinet', count: 1 },
      ];
    case 'office':
    case 'open_office':
      return [
        { catalogueKey: 'desk.workstation.1600', label: 'Workstation', count: 'fill' },
        { catalogueKey: 'storage.cabinet.1000', label: 'Cabinet', count: 2 },
      ];
    case 'laboratory':
      return [
        { catalogueKey: 'desk.workstation.1600', label: 'Lab workstation', count: 'fill' },
        { catalogueKey: 'display.videowall.3x2', label: 'Video wall', count: 1 },
      ];
    case 'server_room':
      return [{ catalogueKey: 'equipment.rack.42u', label: 'Server rack', count: 'fill' }];
    case 'training':
      return [
        { catalogueKey: 'desk.workstation.1400', label: 'Training desk', count: 'fill' },
        { catalogueKey: 'display.screen.75', label: 'Display screen', count: 1 },
      ];
    case 'lounge':
      return [
        { catalogueKey: 'seating.sofa.3', label: 'Sofa', count: 2 },
        { catalogueKey: 'seating.lounge.chair', label: 'Lounge chair', count: 4 },
        { catalogueKey: 'decor.planter.large', label: 'Planter', count: 2 },
      ];
    case 'bedroom':
      return [{ catalogueKey: 'bed.double', label: 'Bed', count: 1 }];
    default:
      return [];
  }
}

/**
 * Place furniture on a grid inset from the room boundary, validating as it goes.
 *
 * A grid rather than anything cleverer, deliberately. This is the *baseline*
 * layout, and its job is to be correct — everything fits, nothing blocks a door
 * — rather than to be good. Making it good is the AI Interior Designer's job,
 * and it will do that better starting from a valid layout than from an empty
 * room.
 *
 * Items are placed one at a time and each is validated against everything
 * already down. An item that cannot be placed anywhere is reported as unplaced
 * rather than forced in.
 */
function placeFurniture(
  room: Room,
  walls: readonly Wall[],
  programme: readonly ProgrammeItem[],
): { placements: FurniturePlacement[]; violations: ClearanceViolation[]; unplaced: string[] } {
  const placements: FurniturePlacement[] = [];
  const unplaced: string[] = [];
  const bounds = boundsOf(room.boundary);
  const centre = centroid(room.boundary);

  /** Try a set of candidate positions, keeping the first that validates. */
  const tryPlace = (item: ProgrammeItem, candidates: Array<{ x: number; y: number; rot: number }>): boolean => {
    const spec = findFurniture(item.catalogueKey);
    if (!spec) return false;

    for (const candidate of candidates) {
      const placement: FurniturePlacement = {
        id: newId<FurnitureId>('fur'),
        roomId: room.id,
        catalogueKey: spec.key,
        label: item.label,
        position: { x: candidate.x, y: candidate.y },
        rotationDeg: candidate.rot,
        width: spec.width,
        depth: spec.depth,
        height: spec.height,
        clearanceFront: spec.clearanceFront,
      };
      const trial = [...placements, placement];
      const problems = validatePlacements(room, trial, walls).filter(
        (v) => v.severity === 'error' && v.furnitureId === placement.id,
      );
      if (problems.length === 0) {
        placements.push(placement);
        return true;
      }
    }
    return false;
  };

  for (const item of programme) {
    const spec = findFurniture(item.catalogueKey);
    if (!spec) continue;

    if (item.count === 'fill') {
      // Grid fill. Step by the item footprint plus its working clearance, so
      // rows do not have to be pushed apart afterwards.
      const stepX = spec.width + 900;
      const stepY = spec.depth + (spec.clearanceFront ?? 0) + 900;
      let placed = 0;
      for (let y = bounds.minY + stepY / 2; y < bounds.maxY; y += stepY) {
        for (let x = bounds.minX + stepX / 2; x < bounds.maxX; x += stepX) {
          if (tryPlace(item, [{ x, y, rot: 0 }])) placed++;
        }
      }
      if (placed === 0) unplaced.push(`${item.label} (no room on the grid)`);
      continue;
    }

    for (let i = 0; i < item.count; i++) {
      // Candidates: centre first for the single hero item, then spread out.
      const spread = 1400 * (i + 1);
      const candidates = [
        { x: centre.x, y: centre.y, rot: 0 },
        { x: centre.x + spread, y: centre.y, rot: 0 },
        { x: centre.x - spread, y: centre.y, rot: 0 },
        { x: centre.x, y: centre.y + spread, rot: 0 },
        { x: centre.x, y: centre.y - spread, rot: 0 },
        { x: centre.x + spread, y: centre.y + spread, rot: 0 },
        { x: centre.x - spread, y: centre.y - spread, rot: 0 },
        { x: centre.x, y: centre.y, rot: 90 },
      ];
      if (!tryPlace(item, candidates)) {
        unplaced.push(`${item.label} ${item.count > 1 ? `#${i + 1}` : ''}`.trim());
      }
    }
  }

  const violations = validatePlacements(room, placements, walls);
  return { placements, violations, unplaced };
}

export function applyThemeToFloors(
  floors: readonly Floor[],
  theme: Theme,
  options: ApplyThemeOptions,
): AppliedTheme {
  const skip = new Set(options.skipRoomIds ?? []);
  const allViolations: ClearanceViolation[] = [];
  const allUnplaced: string[] = [];

  const floorDesigns: FloorDesign[] = floors.map((floor) => {
    const rooms: RoomDesign[] = floor.rooms.map((room) => {
      if (skip.has(room.id)) {
        return { roomId: room.id, finishes: [], ceiling: { kind: 'none' }, lighting: [], furniture: [] };
      }

      let furniture: FurniturePlacement[] = [];
      if (options.includeFurniture) {
        const result = placeFurniture(room, floor.walls, programmeFor(room, theme));
        furniture = result.placements;
        allViolations.push(...result.violations);
        allUnplaced.push(...result.unplaced.map((u) => `${room.name}: ${u}`));
      }

      return {
        roomId: room.id,
        themeId: theme.id,
        finishes: finishesForRoom(room, theme),
        ceiling: ceilingForRoom(room, theme),
        lighting: lightingForRoom(room, theme),
        furniture,
        rationale:
          `${theme.name} applied to a ${room.use.replace(/_/g, ' ')} of ` +
          `${fromMm2(polygonArea(room.boundary), 'ft2').toFixed(0)} sq ft.`,
      };
    });

    return {
      floorId: floor.id,
      themeId: theme.id,
      rooms,
      rationale: floor.purpose
        ? `${theme.name} applied to ${floor.name} (${floor.purpose}).`
        : `${theme.name} applied to ${floor.name}.`,
    };
  });

  return { floors: floorDesigns, violations: allViolations, unplaced: allUnplaced };
}

/** Build a complete design from a theme. */
export function designFromTheme(params: {
  design: Design;
  floors: readonly Floor[];
  theme: Theme;
  name: string;
  label?: string;
  includeFurniture: boolean;
  createdAt: string;
  newDesignId: Design['id'];
  newVersionId: Design['versionId'];
}): { design: Design; violations: readonly ClearanceViolation[]; unplaced: readonly string[] } {
  const applied = applyThemeToFloors(params.floors, params.theme, {
    includeFurniture: params.includeFurniture,
  });

  return {
    design: {
      ...params.design,
      id: params.newDesignId,
      versionId: params.newVersionId,
      name: params.name,
      label: params.label,
      themeId: params.theme.id,
      floors: applied.floors,
      exterior: {
        themeId: params.theme.id,
        facadeSystem: params.theme.facadeSystem ?? 'plaster_paint',
        finishes: params.theme.materials.facade
          ? [{ surface: 'facade' as const, materialId: params.theme.materials.facade }]
          : [],
        lighting: [{ kind: 'facade_wash' as const, count: 8, wattsEach: 30 }],
        landscaping: params.theme.landscaping,
        rationale: params.theme.identity,
      },
      createdAt: params.createdAt,
      origin: { kind: 'theme_applied', parentDesignId: params.design.id },
      rationale: params.theme.identity,
    },
    violations: applied.violations,
    unplaced: applied.unplaced,
  };
}
