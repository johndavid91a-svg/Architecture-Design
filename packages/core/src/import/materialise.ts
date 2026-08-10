/**
 * Turning reviewed candidates into a twin.
 *
 * This is the one place an import becomes the master record, and it is
 * deliberately the last step rather than the first. Everything upstream
 * produces candidates carrying their own uncertainty; nothing upstream can
 * write to the architecture layer.
 *
 * The guarantee this module makes: whatever confidence a candidate carried
 * survives onto the element it becomes. A wall read off a scanned PDF stays
 * `extracted` in the twin, so the plan view can show the user which of their
 * walls are still guesses — and so a takeoff derived from it can be read with
 * the right amount of suspicion.
 */

import { polygonArea, polygonPerimeter } from '../geometry.js';
import type {
  ArchitectureLayer,
  Building,
  BuildingType,
  Floor,
  Opening,
  Point2,
  ProjectLocation,
  Room,
  Site,
  Wall,
} from '../model/architecture.js';
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
} from '../model/ids.js';
import { emptyDesign } from '../model/design.js';
import { fitCores, hasVerticalCirculation } from '../model/core-placement.js';
import { recomputeBoundingWalls } from '../model/edit.js';
import type { Project } from '../project.js';
import { SANITY, type CandidateFloor, type DrawingImportResult, type ImportIssue } from './contract.js';

export interface MaterialiseSpec {
  readonly name: string;
  readonly buildingType: BuildingType;
  readonly location: ProjectLocation;
  readonly displayUnit: 'ft' | 'm';
  /** Floors the user accepted during review, in the order they should appear. */
  readonly floors: readonly CandidateFloor[];
  readonly plotWidthMm?: number;
  readonly plotDepthMm?: number;
}

export interface MaterialiseResult {
  readonly project: Project;
  /** Anything dropped or adjusted on the way in. Never silent. */
  readonly issues: readonly ImportIssue[];
}

/**
 * Build a project from accepted candidates.
 *
 * Rejections happen here as well as upstream, because review can leave a
 * candidate set that is individually plausible and collectively impossible — a
 * wall whose openings no longer fit after the user edited its length, say. The
 * alternative is admitting geometry the editor would immediately refuse to
 * touch.
 */
export function materialise(spec: MaterialiseSpec, now: string): MaterialiseResult {
  const projectId = newId<ProjectId>('prj');
  const siteId = newId<SiteId>('sit');
  const buildingId = newId<BuildingId>('bld');
  const issues: ImportIssue[] = [];

  const floors: Floor[] = [];

  const ordered = [...spec.floors].sort((a, b) => a.level - b.level);

  for (const candidate of ordered) {
    const floorId = newId<FloorId>('flr');
    const rooms: Room[] = [];
    const walls: Wall[] = [];

    for (const cr of candidate.rooms) {
      if (cr.boundary.length < 3) {
        issues.push({
          severity: 'review',
          code: 'ROOM_DEGENERATE',
          message: `Room "${cr.name}" has fewer than three boundary points and was dropped.`,
          remedy: 'Draw it in the plan editor instead.',
          sourceRef: cr.sourceRef,
        });
        continue;
      }

      const area = polygonArea(cr.boundary);
      if (area < SANITY.minRoomAreaMm2 || area > SANITY.maxRoomAreaMm2) {
        issues.push({
          severity: 'review',
          code: 'ROOM_AREA',
          message:
            `Room "${cr.name}" came out at ${(area / 92_903.04).toFixed(0)} sq ft, outside the ` +
            `plausible range, and was dropped. This usually means the drawing scale was misread.`,
          remedy: 'Re-check the scale calibration and import again.',
          sourceRef: cr.sourceRef,
        });
        continue;
      }

      rooms.push({
        id: newId<RoomId>('rm'),
        floorId,
        name: cr.name,
        use: cr.use,
        boundary: cr.boundary,
        clearHeight: cr.clearHeight,
        boundingWallIds: [],
        provenance: {
          confidence: cr.confidence,
          note: cr.note,
          sourceFile: cr.sourceRef,
        },
      });
    }

    for (const cw of candidate.walls) {
      const length = Math.hypot(cw.end.x - cw.start.x, cw.end.y - cw.start.y);
      if (length < SANITY.minWallLengthMm || length > SANITY.maxWallLengthMm) {
        issues.push({
          severity: 'review',
          code: 'WALL_LENGTH',
          message: `A wall of ${(length / 304.8).toFixed(1)} ft was outside the plausible range and was dropped.`,
          sourceRef: cw.sourceRef,
        });
        continue;
      }
      if (cw.thickness < SANITY.minWallThicknessMm || cw.thickness > SANITY.maxWallThicknessMm) {
        issues.push({
          severity: 'review',
          code: 'WALL_THICKNESS',
          message:
            `A wall ${(cw.thickness / 25.4).toFixed(1)} in thick was outside the plausible range ` +
            `and was dropped.`,
          sourceRef: cw.sourceRef,
        });
        continue;
      }

      const wallId = newId<WallId>('wal');
      const openings: Opening[] = [];

      // Openings are re-validated against the wall they arrive on. An opening
      // hanging off the end of its wall is unbuildable and would break both the
      // 3D extrusion and the masonry deduction.
      const sorted = [...cw.openings].sort((a, b) => a.distanceAlongWall - b.distanceAlongWall);
      let lastEnd = -Infinity;
      for (const co of sorted) {
        const half = co.width / 2;
        if (co.distanceAlongWall - half < -1 || co.distanceAlongWall + half > length + 1) {
          issues.push({
            severity: 'review',
            code: 'OPENING_OFF_WALL',
            message:
              `A ${co.kind} did not fit on its wall (centre ${(co.distanceAlongWall / 304.8).toFixed(1)} ft ` +
              `along a ${(length / 304.8).toFixed(1)} ft wall) and was dropped.`,
            sourceRef: co.sourceRef,
          });
          continue;
        }
        if (co.distanceAlongWall - half < lastEnd) {
          issues.push({
            severity: 'review',
            code: 'OPENING_OVERLAP',
            message: `A ${co.kind} overlapped the opening before it on the same wall and was dropped.`,
            sourceRef: co.sourceRef,
          });
          continue;
        }
        if (co.sillHeight + co.height > cw.height + 1) {
          issues.push({
            severity: 'review',
            code: 'OPENING_TOO_TALL',
            message: `A ${co.kind} was taller than its wall and was dropped.`,
            sourceRef: co.sourceRef,
          });
          continue;
        }

        lastEnd = co.distanceAlongWall + half;
        openings.push({
          id: newId<OpeningId>('opn'),
          wallId,
          kind: co.kind,
          distanceAlongWall: co.distanceAlongWall,
          width: co.width,
          height: co.height,
          sillHeight: co.sillHeight,
          isEmergencyExit: false,
          provenance: { confidence: co.confidence, note: co.note, sourceFile: co.sourceRef },
        });
      }

      walls.push({
        id: wallId,
        floorId,
        start: cw.start,
        end: cw.end,
        thickness: cw.thickness,
        height: cw.height,
        function: cw.function,
        loadBearing: cw.loadBearing,
        openings,
        provenance: { confidence: cw.confidence, note: cw.note, sourceFile: cw.sourceRef },
      });
    }

    if (rooms.length === 0 && walls.length === 0) {
      const hadRooms = candidate.rooms.length > 0;
      issues.push({
        severity: hadRooms ? 'review' : 'info',
        code: 'FLOOR_EMPTY',
        message: hadRooms
          ? `"${candidate.name}" had ${candidate.rooms.length} room(s) but none survived validation, so it was skipped.`
          : `"${candidate.name}" carries neither rooms nor walls and was skipped.`,
        remedy: hadRooms ? 'Check the issues above for why the rooms were rejected.' : undefined,
      });
      continue;
    }

    if (rooms.length === 0) {
      // A storey with walls but no rooms is still worth importing. It may be a
      // roof or parapet level, or a model exported without IfcSpace at all —
      // which is common, and refusing it threw away 140 usable walls from one
      // of the reference models. The walls carry masonry quantities on their
      // own, and the user can draw the rooms in the plan editor afterwards.
      issues.push({
        severity: 'info',
        code: 'FLOOR_NO_ROOMS',
        message:
          `"${candidate.name}" imported ${walls.length} wall(s) but no rooms. Wall and masonry ` +
          `quantities will be available; floor, ceiling and finish quantities will not.`,
        remedy: 'Draw the rooms in the plan editor to complete the takeoff.',
      });
    }

    floors.push({
      id: floorId,
      buildingId,
      name: candidate.name,
      level: candidate.level,
      floorToFloor: candidate.floorToFloor,
      clearHeight: candidate.clearHeight,
      elevation: candidate.elevation,
      rooms,
      walls,
      columns: [],
      stairs: [],
    });
  }

  if (floors.length === 0) {
    issues.push({
      severity: 'blocking',
      code: 'NOTHING_IMPORTED',
      message: 'No floor produced usable geometry.',
      remedy: 'Enter the building manually, or check the scale calibration and try again.',
    });
  }

  // ---- A building has to have a way between its floors --------------------
  //
  // A drawing import produces no staircase and no lift. The recogniser labels a
  // room `stair` only when the word lands inside a polygon it closed, and on a
  // dense commercial plan — where the stair is a run of tread lines that breaks
  // every face around it — it usually does not. A nine-storey building then
  // imports with no way up: the walkthrough cannot change floor, and the takeoff
  // misses a lift shaft's masonry on every storey.
  //
  // So a core is fitted and *declared*. The elements it creates are `inferred`,
  // and the issue below is `review` rather than `info` because this is the app's
  // geometry, not the user's drawing, and they have to know that to move it.
  let built: readonly Floor[] = floors;
  if (floors.length > 1 && !hasVerticalCirculation(floors)) {
    const fitted = fitCores(floors, ['stair', 'lift']);
    if (fitted.placement) {
      built = fitted.floors;
      issues.push({
        severity: 'review',
        code: 'CORES_ADDED',
        message: fitted.note,
        remedy:
          'Open the 2D plan, select the Staircase or Lift and drag it onto the real core, or delete ' +
          'it and draw your own.',
      });
      for (const check of fitted.checks) {
        for (const note of check.notes) {
          issues.push({ severity: 'review', code: 'STAIR_PROPORTION', message: note });
        }
      }
    }
  }

  // Footprint from the largest floor's extent.
  const allPoints = built.flatMap((f) => f.rooms.flatMap((r) => r.boundary));
  const footprint = boundingRectangle(allPoints);

  const building: Building = { id: buildingId, siteId, name: spec.name, floors: built, footprint };

  const width = footprint.length > 0 ? extentOf(footprint, 'x') : 0;
  const depth = footprint.length > 0 ? extentOf(footprint, 'y') : 0;
  const plotWidth = spec.plotWidthMm ?? width + 6096;
  const plotDepth = spec.plotDepthMm ?? depth + 6096;

  const site: Site = {
    id: siteId,
    name: `${spec.name} site`,
    plotBoundary: [
      { x: -3048, y: -3048 },
      { x: -3048 + plotWidth, y: -3048 },
      { x: -3048 + plotWidth, y: -3048 + plotDepth },
      { x: -3048, y: -3048 + plotDepth },
    ],
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

  // Wall-to-room association is derived, never imported: a drawing does not say
  // which wall bounds which room, and the takeoff needs it to deduct openings
  // from the right room's wall area.
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
    project: {
      id: projectId,
      name: spec.name,
      createdAt: now,
      architecture,
      designs: [design],
      activeDesignId: design.id,
    },
    issues,
  };
}

function boundingRectangle(points: readonly Point2[]): Point2[] {
  if (points.length === 0) return [];
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

function extentOf(points: readonly Point2[], axis: 'x' | 'y'): number {
  const values = points.map((p) => p[axis]);
  return Math.max(...values) - Math.min(...values);
}

/** A one-line human summary of an import, for the review screen's header. */
export function summariseImport(result: DrawingImportResult): string {
  if (!result.ok) {
    const blocking = result.issues.filter((i) => i.severity === 'blocking');
    return blocking.length > 0
      ? `Import failed: ${blocking[0]!.message}`
      : 'Import failed for an unrecorded reason.';
  }

  const rooms = result.floors.reduce((n, f) => n + f.rooms.length, 0);
  const walls = result.floors.reduce((n, f) => n + f.walls.length, 0);
  const openings = result.floors.reduce(
    (n, f) => n + f.walls.reduce((m, w) => m + w.openings.length, 0),
    0,
  );
  const review = result.issues.filter((i) => i.severity === 'review').length;

  return (
    `${result.floors.length} floor(s), ${rooms} room(s), ${walls} wall(s), ${openings} opening(s) ` +
    `read as ${result.units.unit}` +
    (result.units.confident ? '' : ' (scale not confirmed)') +
    (review > 0 ? ` · ${review} item(s) need review` : '')
  );
}

/** Total wall run and floor area, so the review screen can sanity-check a scale. */
export function importScaleCheck(floors: readonly CandidateFloor[]): {
  totalWallRunFt: number;
  totalAreaSqft: number;
  largestRoomSqft: number;
  plausible: boolean;
  note: string;
} {
  let wallRun = 0;
  let area = 0;
  let largest = 0;

  for (const f of floors) {
    for (const w of f.walls) wallRun += Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
    for (const r of f.rooms) {
      const a = polygonArea(r.boundary);
      area += a;
      largest = Math.max(largest, a);
      // Perimeter is computed but not reported: it is here so a future check can
      // flag a room whose perimeter and area disagree, which is the signature of
      // a self-intersecting boundary.
      polygonPerimeter(r.boundary);
    }
  }

  const areaSqft = area / 92_903.04;
  const largestSqft = largest / 92_903.04;

  // A misread scale shows up as a building that is absurdly large or small
  // rather than as anything locally wrong, so the check is on the totals.
  const plausible = areaSqft > 50 && areaSqft < 5_000_000 && largestSqft < 200_000;

  return {
    totalWallRunFt: wallRun / 304.8,
    totalAreaSqft: areaSqft,
    largestRoomSqft: largestSqft,
    plausible,
    note: plausible
      ? `${areaSqft.toFixed(0)} sq ft across ${floors.length} floor(s). Check this against what you know of the building.`
      : `${areaSqft.toFixed(0)} sq ft is not a plausible building. The drawing scale is almost certainly wrong.`,
  };
}
