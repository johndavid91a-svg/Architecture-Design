/**
 * AI DESIGN DIRECTOR — agent contracts.
 *
 * This file defines the *shape* of what the AI agents may do, not the calls
 * themselves. Keeping the contracts in the pure core package matters for one
 * reason above all: it lets the validators run on the agent's output before any
 * of it reaches the twin.
 *
 * The control flow is deliberately narrow:
 *
 *   instruction ──▶ Design Director ──▶ task list
 *                                         │
 *                        ┌────────────────┼─────────────────┐
 *                        ▼                ▼                 ▼
 *                   AI Architect   AI Interior Des.   AI Exterior Des.
 *                        │                │                 │
 *                        └────────────────┴─────────────────┘
 *                                         ▼
 *                            proposal (design-layer only)
 *                                         ▼
 *                    clearance validation + geometry fingerprint check
 *                                         ▼
 *                         accepted  or  correction brief ──┐
 *                                         ▲                │
 *                                         └────────────────┘
 *
 * An agent never writes to the twin. It returns a proposal, the proposal is
 * validated, and only a proposal that survives validation is applied. The AI
 * Architect is the one agent whose proposals touch geometry, and its output is
 * routed to the user for explicit approval rather than applied — see
 * `ArchitecturalProposal`.
 */

import type { RoomUse } from '../model/architecture.js';
import type { CeilingKind, FacadeSystem, LightingKind } from '../model/design.js';
import type { FloorId, MaterialId, RoomId, ThemeId } from '../model/ids.js';

export type AgentRole =
  | 'design_director'
  | 'architect'
  | 'interior_designer'
  | 'exterior_designer'
  | 'space_optimizer'
  | 'material_specialist'
  | 'cost_estimator'
  | 'procurement_assistant';

/** The scope a user selected before typing an instruction. */
export interface DesignRequest {
  readonly instruction: string;
  readonly scope:
    | { readonly kind: 'building' }
    | { readonly kind: 'floor'; readonly floorId: FloorId }
    | { readonly kind: 'room'; readonly roomId: RoomId }
    | { readonly kind: 'exterior' };
  readonly themeId?: ThemeId;
  /** Reference images the user supplied, as file paths on the local machine. */
  readonly referenceImages?: readonly string[];
  /** Brand assets: logo, palette, guidelines. */
  readonly brandContext?: BrandContext;
  /** How many alternatives to produce. Requirement 15. */
  readonly optionCount?: number;
  /** A cost ceiling the design must respect, when the user set one. */
  readonly budgetCeiling?: { readonly amount: number; readonly currency: string };
}

export interface BrandContext {
  readonly companyName?: string;
  readonly logoPath?: string;
  readonly websiteUrl?: string;
  readonly palette?: readonly string[];
  readonly guidelinesText?: string;
}

/** One task the Design Director decomposed the instruction into. */
export interface DirectorTask {
  readonly id: string;
  readonly role: AgentRole;
  readonly summary: string;
  readonly scope: DesignRequest['scope'];
  /** Task ids that must complete first. */
  readonly dependsOn: readonly string[];
  /** True when this task would change geometry and needs user approval. */
  readonly requiresArchitecturalApproval: boolean;
}

export interface DirectorPlan {
  readonly interpretation: string;
  readonly tasks: readonly DirectorTask[];
  /** Anything the Director could not infer and needs the user to answer. */
  readonly clarifications: readonly string[];
}

/**
 * An interior proposal. Design layer only — note the absence of any field that
 * could move a wall or resize a room.
 */
export interface InteriorProposal {
  readonly roomId: RoomId;
  readonly rationale: string;
  readonly finishes: ReadonlyArray<{
    readonly surface: 'floor' | 'ceiling' | 'wall_internal' | 'skirting';
    readonly materialId: MaterialId;
    readonly heightLimitMm?: number;
    readonly note?: string;
  }>;
  readonly ceiling: { readonly kind: CeilingKind; readonly materialId?: MaterialId; readonly dropHeightMm?: number };
  readonly lighting: ReadonlyArray<{
    readonly kind: LightingKind;
    readonly count: number;
    readonly wattsEach?: number;
    readonly colourTemperatureK?: number;
  }>;
  readonly furniture: ReadonlyArray<{
    readonly catalogueKey: string;
    readonly label: string;
    /** Millimetres, in the room's own coordinate space. */
    readonly x: number;
    readonly y: number;
    readonly rotationDeg: number;
  }>;
}

export interface ExteriorProposal {
  readonly rationale: string;
  readonly facadeSystem: FacadeSystem;
  readonly finishes: ReadonlyArray<{ readonly surface: 'facade' | 'roof' | 'soffit'; readonly materialId: MaterialId }>;
  readonly lighting: ReadonlyArray<{ readonly kind: LightingKind; readonly count: number }>;
  readonly signage?: string;
  readonly landscaping?: string;
}

/**
 * An architectural proposal. Distinct from the interior/exterior proposals
 * because it is NOT applied automatically under any circumstances.
 *
 * Requirement 5: "The user must approve major architectural changes" and such
 * suggestions must be "clearly labeled as requiring review by a qualified
 * architect/engineer before construction."
 */
export interface ArchitecturalProposal {
  readonly rationale: string;
  readonly floorId: FloorId;
  readonly rooms: ReadonlyArray<{
    readonly name: string;
    readonly use: RoomUse;
    readonly approximateWidthMm: number;
    readonly approximateDepthMm: number;
    readonly adjacency: readonly string[];
  }>;
  readonly circulationNotes: string;
  readonly assumptions: readonly string[];
  /** Always true. Present in the type so it cannot be forgotten at a call site. */
  readonly requiresProfessionalReview: true;
  /** Structural elements the proposal assumes stay put. */
  readonly preservedElements: readonly string[];
}

/** A generated option in a multi-option set. Requirement 15. */
export interface DesignOption {
  readonly label: string;
  readonly summary: string;
  readonly themeId?: ThemeId;
  readonly interiors: readonly InteriorProposal[];
  readonly exterior?: ExteriorProposal;
}

/**
 * Value-engineering suggestion. Requirement 52.
 *
 * `estimatedSaving` is deliberately optional: the agent proposes the substitution,
 * and the saving is computed by the estimation engine from real prices. An agent
 * must never assert a monetary saving it has not had priced, because that is
 * fabricating a price by another route.
 */
export interface ValueEngineeringSuggestion {
  readonly current: { readonly materialId: MaterialId; readonly description: string };
  readonly alternative: { readonly materialId: MaterialId; readonly description: string };
  readonly qualityImpact: string;
  readonly visualImpact: string;
  readonly recommendation: 'recommended' | 'acceptable' | 'last_resort';
  readonly estimatedSaving?: { readonly amount: number; readonly currency: string };
}

/** System prompt fragment shared by every design agent. */
export const AGENT_GROUND_RULES = `
You are one agent in an architectural design platform that works on a measured
digital twin of a real building.

HARD RULES

1. The base architecture is fixed. Room dimensions, wall positions, wall
   thicknesses, floor heights, door and window positions and sizes are given to
   you as measured facts. You must not change them, and you must not propose a
   design that only works if they change. If a room is 15 ft x 20 ft, every
   layout you propose fits in 15 ft x 20 ft.

2. If you believe an architectural change is genuinely necessary, say so as a
   separate recommendation. Do not implement it. It goes to the user for
   approval and to a qualified architect or engineer for review.

3. Never obstruct a door, and never obstruct anything marked as an emergency
   exit. Escape routes outrank every layout preference without exception.

4. Furniture you place must physically fit, including the clearance a person
   needs to use it. Your layout will be checked by a geometric validator and
   returned to you with measurements if it fails.

5. Use only material ids and furniture catalogue keys from the lists supplied to
   you. Do not invent them.

6. Never state a price, a cost, a saving or a quantity. You do not have pricing
   data. The estimation engine computes those from the model and from sourced
   prices, and a number you invent would be indistinguishable from a real one to
   the user reading it.

7. Give reasons. Every proposal carries a rationale that a client could be shown.
`.trim();
