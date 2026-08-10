/**
 * A DOUBLE-LOADED CORRIDOR FLOOR PLATE.
 *
 * The arrangement almost every institutional building actually uses: a
 * circulation spine down the middle with rooms either side of it, daylight and
 * views on the outer face of each room, doors onto the corridor. It is what a
 * museum, a laboratory block or a civic building looks like in plan, and it is
 * chosen here for a reason beyond appearance — a corridor is what makes a floor
 * *usable*. A row of rooms in a strip can only be entered through one another.
 *
 * What this does not do is move a dimension. Every room keeps exactly the width
 * and depth it was given; the layout decides only where rooms sit relative to
 * each other. Rooms are anchored to the corridor, so the circulation line is
 * straight and every door opens onto it, and a room shallower than its
 * neighbours leaves the outer face articulated rather than being stretched to
 * fit. Stretching would be the easy way to a tidy rectangle and it would be a
 * lie about the building.
 */

import { rectangleBoundary } from '../geometry.js';
import { newId } from '../model/ids.js';
import type { Floor, Opening, Point2, Room, Wall } from '../model/architecture.js';
import type { BuildingId, FloorId, OpeningId, RoomId, WallId } from '../model/ids.js';

export interface PlateRoomSpec {
  readonly name: string;
  readonly use: Room['use'];
  readonly widthMm: number;
  readonly depthMm: number;
  /** Which side of the corridor. Left to the balancer when not given. */
  readonly band?: 'north' | 'south';
  readonly doorCount?: number;
  readonly windowCount?: number;
}

export interface PlateSpec {
  readonly name: string;
  readonly level: number;
  readonly clearHeightMm: number;
  readonly floorToFloorMm: number;
  readonly purpose?: string;
  readonly corridorWidthMm?: number;
  readonly corridorName?: string;
  readonly rooms: readonly PlateRoomSpec[];
}

const PARTITION_MM = 114; // 4.5 in — a half-brick partition
const EXTERNAL_MM = 229; // 9 in — a one-brick external wall
const DOOR_W_MM = 900;
const DOOR_H_MM = 2100;
const WINDOW_W_MM = 1500;
const WINDOW_H_MM = 1200;
const SILL_MM = 900;

/**
 * 1.5 m clear. Wide enough for two people to pass and for the wheelchair
 * turning circle most accessibility codes require in a public building; a
 * 1.2 m corridor is the domestic minimum and is not appropriate here.
 */
const DEFAULT_CORRIDOR_MM = 2400;

/** Rooms that should not be split away from the public face of the floor. */
const PUBLIC_USES = new Set(['lobby', 'reception', 'exhibition', 'retail', 'dining', 'auditorium']);

/**
 * Split the rooms into two bands of roughly equal run length.
 *
 * Longest-first, each room to whichever band is currently shorter. This is the
 * greedy number-partitioning heuristic, and it is the right amount of machinery
 * here: it keeps the two sides within a room's width of each other, which is
 * what stops the plate coming out as a long thin nose with everything on one
 * side. Rooms that name their own band are honoured first, because some rooms
 * genuinely belong on the entrance face.
 */
function assignBands(rooms: readonly PlateRoomSpec[]): {
  north: PlateRoomSpec[];
  south: PlateRoomSpec[];
} {
  const north: PlateRoomSpec[] = [];
  const south: PlateRoomSpec[] = [];
  let northRun = 0;
  let southRun = 0;

  const place = (room: PlateRoomSpec, band: 'north' | 'south') => {
    if (band === 'north') {
      north.push(room);
      northRun += room.widthMm + PARTITION_MM;
    } else {
      south.push(room);
      southRun += room.widthMm + PARTITION_MM;
    }
  };

  for (const room of rooms) {
    if (room.band) place(room, room.band);
  }

  const free = rooms.filter((r) => !r.band).sort((a, b) => b.widthMm - a.widthMm);
  for (const room of free) {
    // The public rooms go to the south band, which is the entrance face.
    const band = PUBLIC_USES.has(room.use)
      ? southRun <= northRun
        ? 'south'
        : 'north'
      : northRun <= southRun
        ? 'north'
        : 'south';
    place(room, band);
  }

  return { north, south };
}

/**
 * Build one floor as a double-loaded corridor plate.
 *
 * South band runs along the bottom with its outer face at y = 0; the corridor
 * sits above it; the north band sits above that. Doors face the corridor,
 * windows face out.
 */
export function buildDoubleLoadedFloor(spec: PlateSpec, buildingId: BuildingId): Floor {
  const floorId = newId<FloorId>('flr');
  const rooms: Room[] = [];
  const walls: Wall[] = [];

  const corridorWidth = spec.corridorWidthMm ?? DEFAULT_CORRIDOR_MM;
  const { north, south } = assignBands(spec.rooms);

  const southDepth = south.reduce((m, r) => Math.max(m, r.depthMm), 0);
  const corridorY0 = southDepth + PARTITION_MM;
  const corridorY1 = corridorY0 + corridorWidth;

  const runLength = (band: readonly PlateRoomSpec[]) =>
    band.reduce((t, r) => t + r.widthMm, 0) + Math.max(0, band.length - 1) * PARTITION_MM;
  const plateLength = Math.max(runLength(north), runLength(south));

  /**
   * Lay one band out along X.
   *
   * `outward` is the direction from the corridor towards the facade, so the
   * same code serves both sides: the south band grows downwards from the
   * corridor and the north band upwards.
   */
  function layBand(band: readonly PlateRoomSpec[], side: 'north' | 'south') {
    let cursorX = 0;

    band.forEach((rs, index) => {
      const isFirst = index === 0;
      const isLast = index === band.length - 1;
      const roomId = newId<RoomId>('rm');

      // Anchor to the corridor; the outer face falls where the depth puts it.
      const y0 = side === 'south' ? corridorY0 - PARTITION_MM - rs.depthMm : corridorY1 + PARTITION_MM;
      const y1 = y0 + rs.depthMm;
      const origin: Point2 = { x: cursorX, y: y0 };
      const boundary = rectangleBoundary(origin, rs.widthMm, rs.depthMm);

      const corridorSideId = newId<WallId>('wal');
      const outerSideId = newId<WallId>('wal');
      const westId = newId<WallId>('wal');
      const eastId = newId<WallId>('wal');

      // Centrelines sit outside the room boundary by half a thickness, so the
      // room polygon stays the finished face.
      const corridorY = side === 'south' ? y1 + PARTITION_MM / 2 : y0 - PARTITION_MM / 2;
      const outerY = side === 'south' ? y0 - EXTERNAL_MM / 2 : y1 + EXTERNAL_MM / 2;

      // --- Corridor-side wall, carrying the doors ---
      const doorCount = rs.doorCount ?? (rs.widthMm >= 12_000 ? 2 : 1);
      const doors: Opening[] = [];
      for (let d = 0; d < doorCount; d++) {
        doors.push({
          id: newId<OpeningId>('opn'),
          wallId: corridorSideId,
          kind: 'door',
          distanceAlongWall: (rs.widthMm / (doorCount + 1)) * (d + 1),
          width: DOOR_W_MM,
          height: DOOR_H_MM,
          sillHeight: 0,
          isEmergencyExit: false,
          provenance: { confidence: 'inferred', note: 'Door onto the corridor.' },
        });
      }
      walls.push({
        id: corridorSideId,
        floorId,
        start: { x: cursorX, y: corridorY },
        end: { x: cursorX + rs.widthMm, y: corridorY },
        thickness: PARTITION_MM,
        height: spec.clearHeightMm,
        function: 'partition',
        loadBearing: false,
        openings: doors,
        provenance: { confidence: 'inferred', note: 'Partition between room and corridor.' },
      });

      // --- Outer wall, carrying the windows ---
      // A planetarium and a server room are deliberately blind: daylight would
      // ruin the first and is a thermal load on the second.
      const blind = rs.use === 'planetarium' || rs.use === 'server_room' || rs.use === 'plant';
      const windowCount = rs.windowCount ?? (blind ? 0 : Math.max(1, Math.round(rs.widthMm / 4000)));
      const windows: Opening[] = [];
      for (let w = 0; w < windowCount; w++) {
        windows.push({
          id: newId<OpeningId>('opn'),
          wallId: outerSideId,
          kind: 'window',
          distanceAlongWall: (rs.widthMm / (windowCount + 1)) * (w + 1),
          width: Math.min(WINDOW_W_MM, rs.widthMm / (windowCount + 1)),
          height: WINDOW_H_MM,
          sillHeight: SILL_MM,
          isEmergencyExit: false,
          provenance: { confidence: 'inferred', note: 'Daylight to the outer face.' },
        });
      }
      walls.push({
        id: outerSideId,
        floorId,
        start: { x: cursorX, y: outerY },
        end: { x: cursorX + rs.widthMm, y: outerY },
        thickness: EXTERNAL_MM,
        height: spec.clearHeightMm,
        function: 'exterior',
        loadBearing: true,
        openings: windows,
        provenance: { confidence: 'inferred', note: 'External wall on the outer face.' },
      });

      // --- Cross walls ---
      // Only the first room in a band draws its west wall; every other room's
      // west wall is the previous room's east wall, and drawing both would
      // double-count the masonry.
      const westThickness = isFirst ? EXTERNAL_MM : PARTITION_MM;
      walls.push({
        id: westId,
        floorId,
        start: { x: cursorX - westThickness / 2, y: y0 },
        end: { x: cursorX - westThickness / 2, y: y1 },
        thickness: westThickness,
        height: spec.clearHeightMm,
        function: isFirst ? 'exterior' : 'partition',
        loadBearing: isFirst,
        openings: [],
        provenance: {
          confidence: 'inferred',
          note: isFirst ? 'Gable wall at the end of the band.' : 'Partition between adjacent rooms.',
        },
      });

      if (isLast) {
        walls.push({
          id: eastId,
          floorId,
          start: { x: cursorX + rs.widthMm + EXTERNAL_MM / 2, y: y0 },
          end: { x: cursorX + rs.widthMm + EXTERNAL_MM / 2, y: y1 },
          thickness: EXTERNAL_MM,
          height: spec.clearHeightMm,
          function: 'exterior',
          loadBearing: true,
          openings: [],
          provenance: { confidence: 'inferred', note: 'Gable wall at the end of the band.' },
        });
      }

      rooms.push({
        id: roomId,
        floorId,
        name: rs.name,
        use: rs.use,
        boundary,
        clearHeight: spec.clearHeightMm,
        boundingWallIds: isLast
          ? [corridorSideId, outerSideId, westId, eastId]
          : [corridorSideId, outerSideId, westId],
        provenance: { confidence: 'measured', note: 'Entered as width x depth; placed on a corridor plate.' },
      });

      cursorX += rs.widthMm + PARTITION_MM;
    });
  }

  layBand(south, 'south');
  layBand(north, 'north');

  // --- The corridor itself ------------------------------------------------
  // A real room with a real floor: it takes finishes, it takes lighting, and it
  // is a large part of the circulation area a regulator asks about. Leaving it
  // as empty space between two bands would drop all of that from the takeoff.
  if (plateLength > 0) {
    const corridorId = newId<RoomId>('rm');
    const westEndId = newId<WallId>('wal');
    const eastEndId = newId<WallId>('wal');

    walls.push({
      id: westEndId,
      floorId,
      start: { x: -EXTERNAL_MM / 2, y: corridorY0 },
      end: { x: -EXTERNAL_MM / 2, y: corridorY1 },
      thickness: EXTERNAL_MM,
      height: spec.clearHeightMm,
      function: 'exterior',
      loadBearing: true,
      openings: [
        {
          id: newId<OpeningId>('opn'),
          wallId: westEndId,
          kind: 'door',
          distanceAlongWall: corridorWidth / 2,
          width: 1800,
          height: DOOR_H_MM,
          sillHeight: 0,
          // The corridor runs from one end of the building to the other, so its
          // two ends are the natural escape routes and the fire strategy starts
          // here rather than being bolted on later.
          isEmergencyExit: true,
          provenance: { confidence: 'inferred', note: 'Escape door at the end of the corridor.' },
        },
      ],
      provenance: { confidence: 'inferred', note: 'End wall of the corridor.' },
    });

    walls.push({
      id: eastEndId,
      floorId,
      start: { x: plateLength + EXTERNAL_MM / 2, y: corridorY0 },
      end: { x: plateLength + EXTERNAL_MM / 2, y: corridorY1 },
      thickness: EXTERNAL_MM,
      height: spec.clearHeightMm,
      function: 'exterior',
      loadBearing: true,
      openings: [
        {
          id: newId<OpeningId>('opn'),
          wallId: eastEndId,
          kind: 'door',
          distanceAlongWall: corridorWidth / 2,
          width: 1800,
          height: DOOR_H_MM,
          sillHeight: 0,
          isEmergencyExit: true,
          provenance: { confidence: 'inferred', note: 'Escape door at the end of the corridor.' },
        },
      ],
      provenance: { confidence: 'inferred', note: 'End wall of the corridor.' },
    });

    rooms.push({
      id: corridorId,
      floorId,
      name: spec.corridorName ?? 'Corridor',
      use: 'corridor',
      boundary: rectangleBoundary({ x: 0, y: corridorY0 }, plateLength, corridorWidth),
      clearHeight: spec.clearHeightMm,
      boundingWallIds: [westEndId, eastEndId],
      provenance: { confidence: 'inferred', note: 'Circulation spine between the two bands.' },
    });
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
