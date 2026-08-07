/**
 * AI agent prompt construction and response validation.
 *
 * This module builds what goes to the model and checks what comes back. It does
 * not make the network call — that lives in the Electron main process, because
 * the renderer must never hold an API key and because every outbound call
 * belongs somewhere it can be logged.
 *
 * The shape is: build a prompt containing the real geometry, get JSON back,
 * validate it against the model, and either apply it or return a correction
 * brief. The validation is not a formality. A model asked to furnish a 3 m room
 * will specify a 3.6 m table, reliably, because it is reasoning about what the
 * room should feel like rather than about whether the furniture fits.
 */

import { boundsOf, centroid, polygonArea } from '../geometry.js';
import type { Floor, Room, Wall } from '../model/architecture.js';
import type {
  FinishAssignment,
  FurniturePlacement,
  LightingAssignment,
  RoomDesign,
} from '../model/design.js';
import { newId, type FurnitureId, type MaterialId, type RoomId } from '../model/ids.js';
import { BASE_MATERIALS, findMaterial } from '../catalogue/materials.js';
import { FURNITURE, findFurniture } from '../catalogue/furniture.js';
import { themeToBrief, type Theme } from '../themes/theme.js';
import {
  hasBlockingViolations,
  validatePlacements,
  violationsToCorrectionBrief,
  type ClearanceViolation,
} from '../design/clearance.js';
import { fromMm, fromMm2 } from '../units.js';
import { AGENT_GROUND_RULES, type DesignRequest, type InteriorProposal } from './contracts.js';

/** A message pair ready for the model. The transport is the caller's problem. */
export interface AgentPrompt {
  readonly system: string;
  readonly user: string;
  /** For the audit trail and for reproducing a design later. */
  readonly context: {
    readonly roomIds: readonly RoomId[];
    readonly themeId?: string;
    readonly instruction: string;
  };
}

/**
 * Describe a room to the model in the terms it must respect.
 *
 * Dimensions are given in both feet and millimetres. Feet because the user
 * thinks in feet and the model's training does too; millimetres because that is
 * what the response must be expressed in, and asking for a unit conversion in
 * the same breath as a design decision is asking for an arithmetic error.
 */
function describeRoom(room: Room, walls: readonly Wall[]): string {
  const bounds = boundsOf(room.boundary);
  const c = centroid(room.boundary);
  const areaSqft = fromMm2(polygonArea(room.boundary), 'ft2');

  const boundingWalls = walls.filter((w) => room.boundingWallIds.includes(w.id));
  const openings = boundingWalls.flatMap((w) =>
    w.openings.map((o) => {
      const dx = w.end.x - w.start.x;
      const dy = w.end.y - w.start.y;
      const len = Math.hypot(dx, dy) || 1;
      const x = w.start.x + (dx / len) * o.distanceAlongWall;
      const y = w.start.y + (dy / len) * o.distanceAlongWall;
      return (
        `    - ${o.kind}${o.isEmergencyExit ? ' (EMERGENCY EXIT — must stay clear)' : ''}: ` +
        `${fromMm(o.width, 'ft').toFixed(2)} ft wide, centred at (${x.toFixed(0)}, ${y.toFixed(0)}) mm`
      );
    }),
  );

  return [
    `ROOM: "${room.name}" (id ${room.id})`,
    `  Use: ${room.use.replace(/_/g, ' ')}`,
    `  Boundary (mm, plan coordinates): ${room.boundary.map((p) => `(${p.x.toFixed(0)}, ${p.y.toFixed(0)})`).join(' ')}`,
    `  Extent: ${fromMm(bounds.maxX - bounds.minX, 'ft').toFixed(2)} ft x ` +
      `${fromMm(bounds.maxY - bounds.minY, 'ft').toFixed(2)} ft ` +
      `(${(bounds.maxX - bounds.minX).toFixed(0)} x ${(bounds.maxY - bounds.minY).toFixed(0)} mm)`,
    `  Area: ${areaSqft.toFixed(0)} sq ft`,
    `  Clear height: ${fromMm(room.clearHeight, 'ft').toFixed(2)} ft (${room.clearHeight.toFixed(0)} mm)`,
    `  Centre: (${c.x.toFixed(0)}, ${c.y.toFixed(0)}) mm`,
    openings.length > 0 ? `  Openings:\n${openings.join('\n')}` : '  Openings: none recorded',
  ].join('\n');
}

function materialList(): string {
  const byCategory = new Map<string, string[]>();
  for (const m of BASE_MATERIALS) {
    const list = byCategory.get(m.category) ?? [];
    list.push(`${m.id} (${m.name})`);
    byCategory.set(m.category, list);
  }
  return [...byCategory.entries()]
    .map(([category, items]) => `  ${category}: ${items.join(', ')}`)
    .join('\n');
}

function furnitureList(style?: string): string {
  const items = style ? FURNITURE.filter((f) => f.styles.includes(style)) : FURNITURE;
  const usable = items.length > 0 ? items : FURNITURE;
  return usable
    .map(
      (f) =>
        `  ${f.key} — ${f.name}, ${f.width}x${f.depth}x${f.height} mm` +
        (f.clearanceFront ? `, needs ${f.clearanceFront} mm clear in front` : ''),
    )
    .join('\n');
}

const RESPONSE_SCHEMA = `
Respond with JSON only. No prose before or after, no markdown fence.

{
  "rationale": "two or three sentences a client could be shown",
  "finishes": [
    { "surface": "floor" | "ceiling" | "wall_internal" | "skirting",
      "materialId": "<from the material list>",
      "heightLimitMm": <optional, for a dado>,
      "note": "<optional>" }
  ],
  "ceiling": { "kind": "none"|"gypsum_flat"|"gypsum_coffered"|"grid_tile"|"wooden"|"stretch"|"exposed",
               "materialId": "<optional>", "dropHeightMm": <optional> },
  "lighting": [
    { "kind": "recessed_downlight"|"linear_led"|"cove"|"pendant"|"chandelier"|"track"|"wall_washer"|"floor_lamp"|"table_lamp",
      "count": <integer>, "wattsEach": <optional>, "colourTemperatureK": <optional> }
  ],
  "furniture": [
    { "catalogueKey": "<from the furniture list>", "label": "<what to call it>",
      "x": <millimetres, plan coordinates>, "y": <millimetres>, "rotationDeg": <0|90|180|270> }
  ]
}
`.trim();

export function buildInteriorPrompt(params: {
  request: DesignRequest;
  room: Room;
  walls: readonly Wall[];
  theme?: Theme;
  /** A previous attempt's failures, when re-prompting. */
  correction?: string;
}): AgentPrompt {
  const { request, room, walls, theme } = params;

  const system = [
    AGENT_GROUND_RULES,
    '',
    'You are the AI INTERIOR DESIGNER. You produce a design-layer proposal for one room.',
    '',
    RESPONSE_SCHEMA,
  ].join('\n');

  const sections: string[] = [
    `INSTRUCTION FROM THE USER:\n${request.instruction}`,
    '',
    describeRoom(room, walls),
    '',
    `AVAILABLE MATERIALS (use these ids exactly, invent nothing):\n${materialList()}`,
    '',
    `AVAILABLE FURNITURE (use these keys exactly):\n${furnitureList(theme?.furnitureStyle)}`,
  ];

  if (theme) {
    sections.push('', themeToBrief(theme));
  }

  if (request.brandContext) {
    const b = request.brandContext;
    sections.push(
      '',
      'CLIENT BRAND:',
      b.companyName ? `  Company: ${b.companyName}` : '',
      b.palette?.length ? `  Palette: ${b.palette.join(', ')}` : '',
      b.guidelinesText ? `  Guidelines: ${b.guidelinesText}` : '',
    );
  }

  if (params.correction) {
    sections.push(
      '',
      '=== YOUR PREVIOUS ATTEMPT WAS REJECTED ===',
      params.correction,
    );
  }

  sections.push(
    '',
    'Place furniture inside the room boundary given above, in the same plan coordinates.',
    'Check each item against the room extent before you place it. Leave circulation between items.',
  );

  return {
    system,
    user: sections.filter((s) => s !== '').join('\n'),
    context: { roomIds: [room.id], themeId: theme?.id, instruction: request.instruction },
  };
}

// ---------------------------------------------------------------------------
// Response parsing and validation
// ---------------------------------------------------------------------------

export type AgentOutcome<T> =
  | { readonly ok: true; readonly value: T; readonly warnings: readonly string[] }
  | {
      readonly ok: false;
      readonly reason: 'unparseable' | 'schema' | 'invalid_ids' | 'clearance';
      readonly detail: string;
      /** Feed back to the model on the next attempt. */
      readonly correction: string;
      readonly violations?: readonly ClearanceViolation[];
    };

/**
 * Extract JSON from a model response.
 *
 * Models add a markdown fence or a sentence of preamble often enough that
 * refusing on the first `JSON.parse` failure would waste a lot of calls. This
 * strips a fence and falls back to the outermost brace pair, then gives up.
 */
export function extractJson(raw: string): unknown | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], trimmed].filter((c): c is string => typeof c === 'string');

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      /* try the next candidate */
    }
  }

  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch {
      return null;
    }
  }
  return null;
}

const VALID_SURFACES = new Set(['floor', 'ceiling', 'wall_internal', 'skirting']);
const VALID_CEILINGS = new Set([
  'none',
  'gypsum_flat',
  'gypsum_coffered',
  'grid_tile',
  'wooden',
  'stretch',
  'exposed',
]);
const VALID_LIGHTING = new Set([
  'recessed_downlight',
  'linear_led',
  'cove',
  'pendant',
  'chandelier',
  'track',
  'wall_washer',
  'floor_lamp',
  'table_lamp',
  'facade_wash',
  'bollard',
  'street',
]);

/**
 * Validate a parsed interior proposal against the catalogue and the geometry.
 *
 * Runs in two stages, and the order matters: identifiers first, because a
 * hallucinated furniture key has no dimensions and cannot be clearance-checked
 * at all; then clearance, on what survived.
 */
export function validateInteriorProposal(
  parsed: unknown,
  room: Room,
  walls: readonly Wall[],
): AgentOutcome<{ design: RoomDesign; proposal: InteriorProposal }> {
  if (typeof parsed !== 'object' || parsed === null) {
    return {
      ok: false,
      reason: 'schema',
      detail: 'The response was not a JSON object.',
      correction: 'Respond with a single JSON object matching the schema. No prose, no fence.',
    };
  }

  const p = parsed as Record<string, unknown>;
  const warnings: string[] = [];
  const badIds: string[] = [];

  // ---- Finishes --------------------------------------------------------
  const finishes: FinishAssignment[] = [];
  for (const raw of Array.isArray(p['finishes']) ? p['finishes'] : []) {
    const f = raw as Record<string, unknown>;
    const surface = String(f['surface'] ?? '');
    const materialId = String(f['materialId'] ?? '');

    if (!VALID_SURFACES.has(surface)) {
      badIds.push(`surface "${surface}" is not one of ${[...VALID_SURFACES].join(', ')}`);
      continue;
    }
    if (!findMaterial(materialId as MaterialId)) {
      badIds.push(`material id "${materialId}" does not exist`);
      continue;
    }
    finishes.push({
      surface: surface as FinishAssignment['surface'],
      materialId: materialId as MaterialId,
      heightLimit: typeof f['heightLimitMm'] === 'number' ? f['heightLimitMm'] : undefined,
      note: typeof f['note'] === 'string' ? f['note'] : undefined,
    });
  }

  // ---- Ceiling ---------------------------------------------------------
  const rawCeiling = (p['ceiling'] ?? {}) as Record<string, unknown>;
  const ceilingKind = String(rawCeiling['kind'] ?? 'none');
  if (!VALID_CEILINGS.has(ceilingKind)) {
    badIds.push(`ceiling kind "${ceilingKind}" is not valid`);
  }
  const ceilingMaterial = rawCeiling['materialId'];
  if (typeof ceilingMaterial === 'string' && !findMaterial(ceilingMaterial as MaterialId)) {
    badIds.push(`ceiling material id "${ceilingMaterial}" does not exist`);
  }

  // ---- Lighting --------------------------------------------------------
  const lighting: LightingAssignment[] = [];
  for (const raw of Array.isArray(p['lighting']) ? p['lighting'] : []) {
    const l = raw as Record<string, unknown>;
    const kind = String(l['kind'] ?? '');
    if (!VALID_LIGHTING.has(kind)) {
      badIds.push(`lighting kind "${kind}" is not valid`);
      continue;
    }
    const count = Number(l['count']);
    if (!Number.isFinite(count) || count < 0) {
      warnings.push(`Lighting "${kind}" had an unreadable count; treated as 0.`);
      continue;
    }
    lighting.push({
      kind: kind as LightingAssignment['kind'],
      count: Math.round(count),
      wattsEach: typeof l['wattsEach'] === 'number' ? l['wattsEach'] : undefined,
      colourTemperatureK:
        typeof l['colourTemperatureK'] === 'number' ? l['colourTemperatureK'] : undefined,
    });
  }

  // ---- Furniture -------------------------------------------------------
  const furniture: FurniturePlacement[] = [];
  for (const raw of Array.isArray(p['furniture']) ? p['furniture'] : []) {
    const f = raw as Record<string, unknown>;
    const key = String(f['catalogueKey'] ?? '');
    const spec = findFurniture(key);
    if (!spec) {
      badIds.push(`furniture key "${key}" does not exist in the catalogue`);
      continue;
    }
    const x = Number(f['x']);
    const y = Number(f['y']);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      badIds.push(`furniture "${key}" has an unreadable position`);
      continue;
    }
    furniture.push({
      id: newId<FurnitureId>('fur'),
      roomId: room.id,
      catalogueKey: spec.key,
      label: typeof f['label'] === 'string' && f['label'] ? f['label'] : spec.name,
      position: { x, y },
      rotationDeg: Number(f['rotationDeg']) || 0,
      width: spec.width,
      depth: spec.depth,
      height: spec.height,
      clearanceFront: spec.clearanceFront,
    });
  }

  if (badIds.length > 0) {
    return {
      ok: false,
      reason: 'invalid_ids',
      detail: badIds.join('; '),
      correction: [
        'The response used identifiers that do not exist:',
        ...badIds.map((b) => `  - ${b}`),
        '',
        'Use only the material ids and furniture keys from the lists supplied. Do not invent them,',
        'and do not adapt a name you remember from elsewhere.',
      ].join('\n'),
    };
  }

  // ---- Clearance -------------------------------------------------------
  const violations = validatePlacements(room, furniture, walls);
  if (hasBlockingViolations(violations)) {
    return {
      ok: false,
      reason: 'clearance',
      detail: `${violations.filter((v) => v.severity === 'error').length} blocking clearance violation(s).`,
      correction: violationsToCorrectionBrief(violations),
      violations,
    };
  }

  for (const v of violations) warnings.push(v.message);

  const design: RoomDesign = {
    roomId: room.id,
    finishes,
    ceiling: {
      kind: ceilingKind as RoomDesign['ceiling']['kind'],
      materialId: typeof ceilingMaterial === 'string' ? (ceilingMaterial as MaterialId) : undefined,
      dropHeight:
        typeof rawCeiling['dropHeightMm'] === 'number' ? rawCeiling['dropHeightMm'] : undefined,
    },
    lighting,
    furniture,
    rationale: typeof p['rationale'] === 'string' ? p['rationale'] : undefined,
  };

  const proposal: InteriorProposal = {
    roomId: room.id,
    rationale: design.rationale ?? '',
    finishes: finishes.map((f) => ({
      surface: f.surface as 'floor' | 'ceiling' | 'wall_internal' | 'skirting',
      materialId: f.materialId,
      heightLimitMm: f.heightLimit,
      note: f.note,
    })),
    ceiling: {
      kind: design.ceiling.kind,
      materialId: design.ceiling.materialId,
      dropHeightMm: design.ceiling.dropHeight,
    },
    lighting: design.lighting.map((l) => ({
      kind: l.kind,
      count: l.count,
      wattsEach: l.wattsEach,
      colourTemperatureK: l.colourTemperatureK,
    })),
    furniture: furniture.map((f) => ({
      catalogueKey: f.catalogueKey,
      label: f.label,
      x: f.position.x,
      y: f.position.y,
      rotationDeg: f.rotationDeg,
    })),
  };

  return { ok: true, value: { design, proposal }, warnings };
}

/**
 * Director prompt: decompose a building-level instruction into tasks.
 *
 * Kept simple on purpose. The Director's value is deciding *what* to do and
 * flagging what needs approval, not doing any of it — so it sees the building's
 * structure and none of the material catalogue.
 */
export function buildDirectorPrompt(request: DesignRequest, floors: readonly Floor[]): AgentPrompt {
  const structure = floors
    .map((f) => {
      const rooms = f.rooms
        .map((r) => `      - "${r.name}" (${r.use.replace(/_/g, ' ')}, ${fromMm2(polygonArea(r.boundary), 'ft2').toFixed(0)} sq ft) [${r.id}]`)
        .join('\n');
      return `  ${f.name} (level ${f.level})${f.purpose ? ` — ${f.purpose}` : ''}\n${rooms}`;
    })
    .join('\n');

  const system = [
    AGENT_GROUND_RULES,
    '',
    'You are the AI DESIGN DIRECTOR. You do not design anything yourself. You read the',
    "user's instruction and the building's structure, and you produce a task list for the",
    'specialist agents.',
    '',
    'Respond with JSON only:',
    '{',
    '  "interpretation": "what you understand the user to want, in two sentences",',
    '  "tasks": [',
    '    { "id": "t1", "role": "interior_designer"|"exterior_designer"|"architect"|"space_optimizer",',
    '      "summary": "what this task achieves",',
    '      "roomId": "<room id, for room-scoped tasks>",',
    '      "floorId": "<floor id, for floor-scoped tasks>",',
    '      "dependsOn": ["<task ids>"],',
    '      "requiresArchitecturalApproval": true|false }',
    '  ],',
    '  "clarifications": ["anything you could not infer and need the user to answer"]',
    '}',
    '',
    'Set requiresArchitecturalApproval to true for any task that would change room sizes,',
    'wall positions or openings. Those tasks are not executed automatically.',
  ].join('\n');

  const user = [
    `INSTRUCTION:\n${request.instruction}`,
    '',
    `BUILDING STRUCTURE:\n${structure}`,
    '',
    'Produce the smallest task list that fulfils the instruction. Do not invent rooms.',
  ].join('\n');

  return {
    system,
    user,
    context: {
      roomIds: floors.flatMap((f) => f.rooms.map((r) => r.id)),
      instruction: request.instruction,
    },
  };
}

/** How many times to re-prompt with a correction before giving up. */
export const MAX_CORRECTION_ROUNDS = 3;
