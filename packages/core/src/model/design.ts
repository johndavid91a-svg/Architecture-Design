/**
 * DESIGN LAYER.
 *
 * Everything that can change without a structural engineer being involved:
 * finishes, furniture, lighting, façade treatment, landscaping.
 *
 * The design layer holds no geometry of its own for rooms or walls. It only
 * *references* architecture entities by id and attaches appearance and content
 * to them. That is what makes "generate five design options" cheap — five
 * designs share one architecture — and what makes it structurally impossible
 * for a design operation to move a wall.
 *
 * Furniture is the one exception: it carries a placement, because furniture is
 * design-layer content that occupies real space. Its placement is validated
 * against the architecture by `clearance.ts` rather than being free to overlap.
 */

import type { Millimetres } from '../units.js';
import type { Point2 } from './architecture.js';
import type {
  DesignId,
  FloorId,
  FurnitureId,
  MaterialId,
  ProjectId,
  RoomId,
  ThemeId,
  VersionId,
  WallId,
} from './ids.js';

/** Where a finish is applied. Drives which takeoff rule computes its quantity. */
export type SurfaceKind =
  | 'floor'
  | 'ceiling'
  | 'wall_internal'
  | 'wall_external'
  | 'skirting'
  | 'cornice'
  | 'facade'
  | 'roof'
  | 'soffit';

/** A finish assignment: this material, on this surface, of this element. */
export interface FinishAssignment {
  readonly surface: SurfaceKind;
  readonly materialId: MaterialId;
  /**
   * Optional restriction to one wall. When absent, a `wall_internal` finish
   * applies to every internal face bounding the room.
   */
  readonly wallId?: WallId;
  /** Wall finishes that stop below ceiling, e.g. 1200 mm marble dado. */
  readonly heightLimit?: Millimetres;
  readonly note?: string;
}

export type LightingKind =
  | 'recessed_downlight'
  | 'linear_led'
  | 'cove'
  | 'pendant'
  | 'chandelier'
  | 'track'
  | 'wall_washer'
  | 'floor_lamp'
  | 'table_lamp'
  | 'facade_wash'
  | 'bollard'
  | 'street';

export interface LightingAssignment {
  readonly kind: LightingKind;
  readonly count: number;
  /** Nominal wattage per fitting, for the electrical load summary. */
  readonly wattsEach?: number;
  readonly colourTemperatureK?: number;
  readonly materialId?: MaterialId;
  readonly note?: string;
}

export type CeilingKind = 'none' | 'gypsum_flat' | 'gypsum_coffered' | 'grid_tile' | 'wooden' | 'stretch' | 'exposed';

export interface CeilingTreatment {
  readonly kind: CeilingKind;
  readonly materialId?: MaterialId;
  /** Drop from structural soffit to finished ceiling. Reduces clear height. */
  readonly dropHeight?: Millimetres;
}

/** A placed furniture instance. Position is the centre of its footprint. */
export interface FurniturePlacement {
  readonly id: FurnitureId;
  readonly roomId: RoomId;
  /** Catalogue key into the furniture library, e.g. "desk.executive.1800". */
  readonly catalogueKey: string;
  readonly label: string;
  readonly position: Point2;
  /** Rotation about the vertical axis, degrees clockwise from +X. */
  readonly rotationDeg: number;
  readonly width: Millimetres;
  readonly depth: Millimetres;
  readonly height: Millimetres;
  /** Clear space that must remain in front of the item to use it (chair pull-out, drawer). */
  readonly clearanceFront?: Millimetres;
  readonly materialId?: MaterialId;
}

/** Design content attached to one room. */
export interface RoomDesign {
  readonly roomId: RoomId;
  readonly themeId?: ThemeId;
  readonly finishes: readonly FinishAssignment[];
  readonly ceiling: CeilingTreatment;
  readonly lighting: readonly LightingAssignment[];
  readonly furniture: readonly FurniturePlacement[];
  /** The AI's stated reasoning, shown in presentations as design rationale. */
  readonly rationale?: string;
}

export interface FloorDesign {
  readonly floorId: FloorId;
  readonly themeId?: ThemeId;
  readonly rooms: readonly RoomDesign[];
  readonly rationale?: string;
}

export type FacadeSystem =
  | 'plaster_paint'
  | 'stone_cladding'
  | 'aluminium_composite'
  | 'curtain_wall'
  | 'structural_glazing'
  | 'brick_facing'
  | 'gfrc_panel'
  | 'terracotta'
  | 'mixed';

export interface ExteriorDesign {
  readonly themeId?: ThemeId;
  readonly facadeSystem: FacadeSystem;
  readonly finishes: readonly FinishAssignment[];
  readonly lighting: readonly LightingAssignment[];
  /** Free description of signage, used for both rendering and the BOQ line. */
  readonly signage?: string;
  readonly landscaping?: string;
  readonly rationale?: string;
}

export type DesignScope = 'building' | 'floor' | 'room' | 'exterior';

/**
 * One complete design option over the shared architecture.
 *
 * Designs are versioned and never edited in place once saved — "Option B" in a
 * comparison must still mean what it meant when its cost was calculated.
 */
export interface Design {
  readonly id: DesignId;
  readonly projectId: ProjectId;
  readonly versionId: VersionId;
  readonly name: string;
  /** e.g. "Option C — Futuristic Space". Shown in comparison views. */
  readonly label?: string;
  readonly themeId?: ThemeId;
  readonly floors: readonly FloorDesign[];
  readonly exterior?: ExteriorDesign;
  readonly createdAt: string;
  /** What produced this design, for the audit trail. */
  readonly origin: DesignOrigin;
  readonly rationale?: string;
}

export interface DesignOrigin {
  readonly kind: 'manual' | 'ai' | 'theme_applied' | 'imported' | 'duplicated';
  /** The user's natural-language instruction, when AI-generated. */
  readonly instruction?: string;
  /** Model identifier, when AI-generated. Part of the reproducibility record. */
  readonly model?: string;
  readonly parentDesignId?: DesignId;
}

/** An empty design over an architecture — the starting point before any styling. */
export function emptyDesign(params: {
  id: DesignId;
  projectId: ProjectId;
  versionId: VersionId;
  name: string;
  createdAt: string;
  floorIds: readonly FloorId[];
  roomsByFloor: ReadonlyMap<FloorId, readonly RoomId[]>;
}): Design {
  return {
    id: params.id,
    projectId: params.projectId,
    versionId: params.versionId,
    name: params.name,
    createdAt: params.createdAt,
    origin: { kind: 'manual' },
    floors: params.floorIds.map((floorId) => ({
      floorId,
      rooms: (params.roomsByFloor.get(floorId) ?? []).map((roomId) => ({
        roomId,
        finishes: [],
        ceiling: { kind: 'none' as const },
        lighting: [],
        furniture: [],
      })),
    })),
  };
}
