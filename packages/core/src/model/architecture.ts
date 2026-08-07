/**
 * BASE ARCHITECTURE LAYER.
 *
 * This layer is the measured reality of the building: where the walls are, how
 * big the rooms are, how high the floors are. It is the master source of truth
 * that the entire platform derives from — 3D geometry, quantity takeoff, and
 * every cost figure trace back to these numbers.
 *
 * Nothing in the design layer may mutate anything in this file's types. That
 * rule is enforced structurally (`readonly` everywhere) and at runtime by
 * `guard.ts`, because "the AI made the room bigger so the sofa would fit" is
 * the single most damaging failure mode this product can have: it silently
 * invalidates the estimate the user is about to spend money against.
 *
 * All lengths are millimetres. See `units.ts`.
 */

import type { Millimetres } from '../units.js';
import type {
  BuildingId,
  ColumnId,
  FloorId,
  OpeningId,
  ProjectId,
  RoomId,
  SiteId,
  StairId,
  WallId,
} from './ids.js';

/** A point in floor-plan space. Origin is the building's survey reference point. */
export interface Point2 {
  readonly x: Millimetres;
  readonly y: Millimetres;
}

/** How confident we are that a dimension matches the real building. */
export type DimensionConfidence =
  /** Entered by the user from a measured survey or a dimensioned drawing. */
  | 'measured'
  /** Read off an uploaded drawing by OCR/vectorisation and confirmed by the user. */
  | 'verified'
  /** Read automatically and NOT yet confirmed. Must be surfaced for verification. */
  | 'extracted'
  /** Inferred to close a gap (e.g. a wall implied by two adjacent rooms). */
  | 'inferred';

/** Provenance for any dimension that did not come from direct user entry. */
export interface DimensionProvenance {
  readonly confidence: DimensionConfidence;
  /** Free text: "drawing p.2, dimension string 15'-0\"", "manual entry", … */
  readonly note?: string;
  /** Drawing file the dimension was extracted from, if any. */
  readonly sourceFile?: string;
  /** 0..1 detector score where an automated extractor produced it. */
  readonly extractorScore?: number;
}

export type WallFunction = 'exterior' | 'interior' | 'partition' | 'retaining' | 'parapet';

/**
 * A wall is stored as a centreline plus a thickness rather than as a closed
 * polygon. Centrelines are what drawings dimension, what IFC stores, and what
 * makes junctions resolvable; polygons are derived for rendering.
 */
export interface Wall {
  readonly id: WallId;
  readonly floorId: FloorId;
  readonly start: Point2;
  readonly end: Point2;
  readonly thickness: Millimetres;
  /** Height from finished floor level. Defaults to the floor's clear height. */
  readonly height: Millimetres;
  readonly function: WallFunction;
  /** True where the wall carries load — flagged so the AI never proposes removing it. */
  readonly loadBearing: boolean;
  readonly openings: readonly Opening[];
  readonly provenance: DimensionProvenance;
}

export type OpeningKind = 'door' | 'window' | 'archway' | 'louvre' | 'shutter';

/**
 * A door or window, positioned along its host wall.
 *
 * `distanceAlongWall` is measured from the wall's `start` point to the opening's
 * centre. Storing it relative to the wall rather than in world coordinates means
 * an opening cannot drift off its wall when the wall is edited.
 */
export interface Opening {
  readonly id: OpeningId;
  readonly wallId: WallId;
  readonly kind: OpeningKind;
  readonly distanceAlongWall: Millimetres;
  readonly width: Millimetres;
  readonly height: Millimetres;
  /** Height of the opening's underside above finished floor level. Doors: 0. */
  readonly sillHeight: Millimetres;
  /** Marks a designated means of escape. Never obstructable — see `clearance.ts`. */
  readonly isEmergencyExit: boolean;
  readonly provenance: DimensionProvenance;
}

export type RoomUse =
  | 'reception'
  | 'office'
  | 'open_office'
  | 'executive_office'
  | 'conference'
  | 'meeting'
  | 'laboratory'
  | 'server_room'
  | 'training'
  | 'lounge'
  | 'corridor'
  | 'lobby'
  | 'stair'
  | 'lift'
  | 'toilet'
  | 'kitchen'
  | 'pantry'
  | 'store'
  | 'plant'
  | 'parking'
  | 'retail'
  | 'bedroom'
  | 'living'
  | 'dining'
  | 'other';

/**
 * A room is a closed polygon of finished-face points on one floor.
 *
 * The polygon is the authoritative extent. A rectangular room entered as
 * "15 ft x 20 ft" becomes a four-point polygon of exactly 4572 x 6096 mm, and
 * every derived area is computed from that polygon rather than from the typed
 * numbers — so a room and its takeoff can never disagree.
 */
export interface Room {
  readonly id: RoomId;
  readonly floorId: FloorId;
  readonly name: string;
  readonly use: RoomUse;
  /** Finished-face boundary, counter-clockwise, not repeating the first point. */
  readonly boundary: readonly Point2[];
  /** Clear floor-to-ceiling height. Falls back to the floor's clear height. */
  readonly clearHeight: Millimetres;
  /** Walls that bound this room, for takeoff. Derived on import, editable. */
  readonly boundingWallIds: readonly WallId[];
  readonly provenance: DimensionProvenance;
}

export interface Column {
  readonly id: ColumnId;
  readonly floorId: FloorId;
  readonly centre: Point2;
  readonly width: Millimetres;
  readonly depth: Millimetres;
  readonly height: Millimetres;
  readonly provenance: DimensionProvenance;
}

export interface Stair {
  readonly id: StairId;
  readonly floorId: FloorId;
  readonly name: string;
  /** Footprint polygon on the lower floor. */
  readonly footprint: readonly Point2[];
  readonly floorToFloorRise: Millimetres;
  readonly treadDepth: Millimetres;
  readonly riserHeight: Millimetres;
  readonly width: Millimetres;
  readonly provenance: DimensionProvenance;
}

export interface Floor {
  readonly id: FloorId;
  readonly buildingId: BuildingId;
  readonly name: string;
  /** 0 = ground, -1 = basement, 1 = first floor. Ordering key. */
  readonly level: number;
  /** Structural floor-to-floor height. */
  readonly floorToFloor: Millimetres;
  /** Default clear height for rooms that do not override it. */
  readonly clearHeight: Millimetres;
  /** Finished floor level above the building datum. */
  readonly elevation: Millimetres;
  /** Human statement of the floor's purpose. Drives floor-specific AI design. */
  readonly purpose?: string;
  readonly rooms: readonly Room[];
  readonly walls: readonly Wall[];
  readonly columns: readonly Column[];
  readonly stairs: readonly Stair[];
}

export interface Building {
  readonly id: BuildingId;
  readonly siteId: SiteId;
  readonly name: string;
  readonly floors: readonly Floor[];
  /** Building outline at ground level, for site plans and coverage checks. */
  readonly footprint: readonly Point2[];
}

export type RegulatoryAuthority = 'CDA' | 'RDA' | 'OTHER_PK' | 'INTERNATIONAL';

export interface Site {
  readonly id: SiteId;
  readonly name: string;
  /** Plot boundary. Required for FAR / coverage / setback checks. */
  readonly plotBoundary: readonly Point2[];
  readonly buildings: readonly Building[];
  readonly location: ProjectLocation;
}

export interface ProjectLocation {
  readonly city: string;
  readonly country: string;
  /** Which authority's rules the regulation checker should load. */
  readonly authority: RegulatoryAuthority;
  /** Decimal degrees. Used by the daylight simulation for sun position. */
  readonly latitude?: number;
  readonly longitude?: number;
  /** IANA zone, e.g. "Asia/Karachi". Used with lat/long for sun position. */
  readonly timezone?: string;
}

export type BuildingType =
  | 'commercial_plaza'
  | 'office'
  | 'residential_house'
  | 'apartment'
  | 'retail'
  | 'hospitality'
  | 'healthcare'
  | 'education'
  | 'industrial'
  | 'mixed_use';

/**
 * The complete base architecture: the digital twin's structural half.
 *
 * `frozen` marks the architecture as authorised-final. Once frozen, mutations
 * require an explicit `ArchitecturalChangeAuthorisation` (see `guard.ts`).
 */
export interface ArchitectureLayer {
  readonly projectId: ProjectId;
  readonly buildingType: BuildingType;
  readonly site: Site;
  readonly frozen: boolean;
  /** Display unit preference. Does not affect stored values, which are mm. */
  readonly displayUnit: 'ft' | 'm';
}
