/**
 * Project assembly and the manual-measurement path.
 *
 * Drawing import (DXF/IFC/raster recognition) is the richer route into the twin,
 * but it is not the route that must always work. A user with a tape measure and
 * a room schedule has to be able to build a correct model, and that path is
 * implemented here.
 *
 * `buildFloorFromRooms` takes a list of room dimensions and produces real
 * geometry: polygons, walls with thickness, and openings positioned on those
 * walls. The rooms are laid out in a strip with shared partitions, which is a
 * conventional plan arrangement rather than an arbitrary one, and every
 * dimension the user typed survives into the polygon unchanged.
 */

import { rectangleBoundary } from './geometry.js';
import type {
  ArchitectureLayer,
  Building,
  BuildingType,
  Floor,
  Opening,
  Point2,
  ProjectLocation,
  Room,
  RoomUse,
  Site,
  Wall,
} from './model/architecture.js';
import {
  newId,
  type BuildingId,
  type DesignId,
  type FloorId,
  type OpeningId,
  type ProjectId,
  type RoomId,
  type SiteId,
  type VersionId,
  type WallId,
} from './model/ids.js';
import type { Design } from './model/design.js';
import { emptyDesign } from './model/design.js';
import { recomputeBoundingWalls } from './model/edit.js';
import { toMm } from './units.js';

export interface Project {
  readonly id: ProjectId;
  readonly name: string;
  readonly createdAt: string;
  readonly architecture: ArchitectureLayer;
  readonly designs: readonly Design[];
  readonly activeDesignId?: DesignId;
}

/** One room as the user enters it: a name, a use, and two dimensions. */
export interface RoomSpec {
  readonly name: string;
  readonly use: RoomUse;
  readonly widthMm: number;
  readonly depthMm: number;
  /** Doors on the corridor-facing wall. Defaults to one 900 mm door. */
  readonly doorCount?: number;
  /** Windows on the external wall. Defaults to one per 4 m of width. */
  readonly windowCount?: number;
}

export interface FloorSpec {
  readonly name: string;
  readonly level: number;
  readonly clearHeightMm: number;
  readonly floorToFloorMm: number;
  readonly purpose?: string;
  readonly rooms: readonly RoomSpec[];
}

const DEFAULT_PARTITION_THICKNESS_MM = 114; // 4.5 in — a standard half-brick partition
const DEFAULT_EXTERNAL_THICKNESS_MM = 229; // 9 in — a standard one-brick external wall
const DEFAULT_DOOR_WIDTH_MM = 900;
const DEFAULT_DOOR_HEIGHT_MM = 2100;
const DEFAULT_WINDOW_WIDTH_MM = 1500;
const DEFAULT_WINDOW_HEIGHT_MM = 1200;
const DEFAULT_WINDOW_SILL_MM = 900;

/**
 * Lay rooms out along the X axis in a single strip.
 *
 * Every room keeps exactly the width and depth given. Partitions sit between
 * adjacent rooms, an external wall runs along each long edge, and end walls
 * close the strip. Windows go on the "north" external wall, doors on the
 * "south" one, which is where a corridor would run.
 *
 * This is a starting arrangement, not a design proposal. The 2D editor exists so
 * the user can move it to match the real building; the point of this function is
 * that the *dimensions* are right from the first moment, so a takeoff taken
 * before any editing is already meaningful.
 */
export function buildFloorFromRooms(spec: FloorSpec, buildingId: BuildingId): Floor {
  const floorId = newId<FloorId>('flr');
  const rooms: Room[] = [];
  const walls: Wall[] = [];

  const maxDepth = spec.rooms.reduce((m, r) => Math.max(m, r.depthMm), 0);
  let cursorX = 0;

  for (let i = 0; i < spec.rooms.length; i++) {
    const rs = spec.rooms[i]!;
    const roomId = newId<RoomId>('rm');
    const origin: Point2 = { x: cursorX, y: 0 };
    const boundary = rectangleBoundary(origin, rs.widthMm, rs.depthMm);

    // --- Walls bounding this room ---
    const northId = newId<WallId>('wal');
    const southId = newId<WallId>('wal');
    const westId = newId<WallId>('wal');
    const eastId = newId<WallId>('wal');

    const isFirst = i === 0;
    const isLast = i === spec.rooms.length - 1;

    // Wall centrelines sit OUTSIDE the room boundary by half their thickness,
    // so the room polygon is the finished face. Putting the centreline on the
    // boundary instead would make the inner half of every wall fall inside the
    // room, and furniture pushed against a wall would read as intersecting it.
    const westThickness = isFirst ? DEFAULT_EXTERNAL_THICKNESS_MM : DEFAULT_PARTITION_THICKNESS_MM;
    const southY = -DEFAULT_EXTERNAL_THICKNESS_MM / 2;
    const northY = rs.depthMm + DEFAULT_EXTERNAL_THICKNESS_MM / 2;
    const westX = cursorX - westThickness / 2;
    const eastX = cursorX + rs.widthMm + DEFAULT_EXTERNAL_THICKNESS_MM / 2;

    // North (window wall), running along y = depth.
    const windowCount = rs.windowCount ?? Math.max(1, Math.round(rs.widthMm / 4000));
    const windows: Opening[] = [];
    for (let w = 0; w < windowCount; w++) {
      const spacing = rs.widthMm / (windowCount + 1);
      windows.push({
        id: newId<OpeningId>('opn'),
        wallId: northId,
        kind: 'window',
        distanceAlongWall: spacing * (w + 1),
        width: Math.min(DEFAULT_WINDOW_WIDTH_MM, rs.widthMm / (windowCount + 1)),
        height: DEFAULT_WINDOW_HEIGHT_MM,
        sillHeight: DEFAULT_WINDOW_SILL_MM,
        isEmergencyExit: false,
        provenance: { confidence: 'inferred', note: 'Default window arrangement from manual entry.' },
      });
    }
    walls.push({
      id: northId,
      floorId,
      start: { x: cursorX, y: northY },
      end: { x: cursorX + rs.widthMm, y: northY },
      thickness: DEFAULT_EXTERNAL_THICKNESS_MM,
      height: spec.clearHeightMm,
      function: 'exterior',
      loadBearing: true,
      openings: windows,
      provenance: { confidence: 'inferred', note: 'External wall implied by room depth.' },
    });

    // South (door wall), running along y = 0.
    const doorCount = rs.doorCount ?? 1;
    const doors: Opening[] = [];
    for (let d = 0; d < doorCount; d++) {
      const spacing = rs.widthMm / (doorCount + 1);
      doors.push({
        id: newId<OpeningId>('opn'),
        wallId: southId,
        kind: 'door',
        distanceAlongWall: spacing * (d + 1),
        width: DEFAULT_DOOR_WIDTH_MM,
        height: DEFAULT_DOOR_HEIGHT_MM,
        sillHeight: 0,
        // Only the first room's door is treated as an exit by default; the user
        // sets the real escape routes. Marking every door an exit would make the
        // clearance validator unusable.
        isEmergencyExit: isFirst && d === 0,
        provenance: { confidence: 'inferred', note: 'Default door from manual entry.' },
      });
    }
    walls.push({
      id: southId,
      floorId,
      start: { x: cursorX, y: southY },
      end: { x: cursorX + rs.widthMm, y: southY },
      thickness: DEFAULT_EXTERNAL_THICKNESS_MM,
      height: spec.clearHeightMm,
      function: 'exterior',
      loadBearing: true,
      openings: doors,
      provenance: { confidence: 'inferred', note: 'Corridor-side wall implied by room layout.' },
    });

    // West partition (or external wall at the strip's start).
    walls.push({
      id: westId,
      floorId,
      start: { x: westX, y: 0 },
      end: { x: westX, y: rs.depthMm },
      thickness: westThickness,
      height: spec.clearHeightMm,
      function: isFirst ? 'exterior' : 'partition',
      loadBearing: isFirst,
      openings: [],
      provenance: { confidence: 'inferred', note: 'Partition between adjacent rooms.' },
    });

    // East wall, added only for the last room; otherwise the next room's west
    // wall is the shared partition and adding both would double-count masonry.
    if (isLast) {
      walls.push({
        id: eastId,
        floorId,
        start: { x: eastX, y: 0 },
        end: { x: eastX, y: rs.depthMm },
        thickness: DEFAULT_EXTERNAL_THICKNESS_MM,
        height: spec.clearHeightMm,
        function: 'exterior',
        loadBearing: true,
        openings: [],
        provenance: { confidence: 'inferred', note: 'End wall of the room strip.' },
      });
    }

    rooms.push({
      id: roomId,
      floorId,
      name: rs.name,
      use: rs.use,
      boundary,
      clearHeight: spec.clearHeightMm,
      boundingWallIds: isLast ? [northId, southId, westId, eastId] : [northId, southId, westId],
      provenance: {
        confidence: 'measured',
        note: 'Entered manually as width x depth.',
      },
    });

    // Leave room for the shared partition between this room and the next, so
    // adjacent finished faces are a real wall thickness apart rather than
    // coincident.
    cursorX += rs.widthMm + DEFAULT_PARTITION_THICKNESS_MM;
  }

  return {
    id: floorId,
    buildingId,
    name: spec.name,
    level: spec.level,
    floorToFloor: spec.floorToFloorMm,
    clearHeight: spec.clearHeightMm,
    elevation: spec.level * spec.floorToFloorMm,
    purpose: spec.purpose,
    rooms,
    walls,
    columns: [],
    stairs: [],
  };
}

export interface ProjectSpec {
  readonly name: string;
  readonly buildingType: BuildingType;
  readonly location: ProjectLocation;
  readonly displayUnit: 'ft' | 'm';
  /** Plot dimensions, for coverage and setback checks. */
  readonly plotWidthMm?: number;
  readonly plotDepthMm?: number;
  readonly floors: readonly FloorSpec[];
}

export function createProject(spec: ProjectSpec, now: string): Project {
  const projectId = newId<ProjectId>('prj');
  const siteId = newId<SiteId>('sit');
  const buildingId = newId<BuildingId>('bld');

  const floors = spec.floors.map((f) => buildFloorFromRooms(f, buildingId));

  // Footprint from the largest floor's extent.
  const extents = floors.map((f) => {
    const xs = f.rooms.flatMap((r) => r.boundary.map((p) => p.x));
    const ys = f.rooms.flatMap((r) => r.boundary.map((p) => p.y));
    return {
      w: xs.length ? Math.max(...xs) - Math.min(...xs) : 0,
      d: ys.length ? Math.max(...ys) - Math.min(...ys) : 0,
    };
  });
  const footprintWidth = extents.reduce((m, e) => Math.max(m, e.w), 0);
  const footprintDepth = extents.reduce((m, e) => Math.max(m, e.d), 0);

  const building: Building = {
    id: buildingId,
    siteId,
    name: spec.name,
    floors,
    footprint: rectangleBoundary({ x: 0, y: 0 }, footprintWidth, footprintDepth),
  };

  const plotWidth = spec.plotWidthMm ?? footprintWidth + toMm(20, 'ft');
  const plotDepth = spec.plotDepthMm ?? footprintDepth + toMm(20, 'ft');

  const site: Site = {
    id: siteId,
    name: `${spec.name} site`,
    plotBoundary: rectangleBoundary({ x: -toMm(10, 'ft'), y: -toMm(10, 'ft') }, plotWidth, plotDepth),
    buildings: [building],
    location: spec.location,
  };

  let architecture: ArchitectureLayer = {
    projectId,
    buildingType: spec.buildingType,
    site,
    frozen: false,
    displayUnit: spec.displayUnit,
  };

  // Resolve wall-to-room association from the geometry rather than trusting the
  // ids assigned while building the strip. A shared partition bounds the rooms
  // on both sides of it, and only a geometric test finds that. Getting it right
  // here matters twice over: the takeoff deducts openings per room from these
  // ids, and an edit that would move a shared wall is refused based on them.
  for (const floor of floors) {
    architecture = recomputeBoundingWalls(architecture, floor.id);
  }

  const design = emptyDesign({
    id: newId<DesignId>('dsg'),
    projectId,
    versionId: newId<VersionId>('ver'),
    name: 'Base (no finishes)',
    createdAt: now,
    floorIds: floors.map((f) => f.id),
    roomsByFloor: new Map(floors.map((f) => [f.id, f.rooms.map((r) => r.id)])),
  });

  return {
    id: projectId,
    name: spec.name,
    createdAt: now,
    architecture,
    designs: [design],
    activeDesignId: design.id,
  };
}

/** Every floor across every building, in level order. */
export function allFloors(project: Project): readonly Floor[] {
  return project.architecture.site.buildings
    .flatMap((b) => b.floors)
    .slice()
    .sort((a, b) => a.level - b.level);
}

export function findRoom(project: Project, roomId: RoomId): { floor: Floor; room: Room } | undefined {
  for (const floor of allFloors(project)) {
    const room = floor.rooms.find((r) => r.id === roomId);
    if (room) return { floor, room };
  }
  return undefined;
}

export function activeDesign(project: Project): Design | undefined {
  return project.designs.find((d) => d.id === project.activeDesignId) ?? project.designs[0];
}
