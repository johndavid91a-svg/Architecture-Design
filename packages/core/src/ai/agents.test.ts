import { describe, expect, it } from 'vitest';
import { allFloors, createProject } from '../project.js';
import { toMm } from '../units.js';
import { THEMES } from '../themes/theme.js';
import { buildInteriorPrompt, extractJson, validateInteriorProposal } from './agents.js';
import type { DesignRequest } from './contracts.js';

const NOW = '2026-08-07T00:00:00.000Z';

function setup(widthFt = 24, depthFt = 30) {
  const project = createProject(
    {
      name: 'Agent test',
      buildingType: 'office',
      location: { city: 'Islamabad', country: 'Pakistan', authority: 'CDA' },
      displayUnit: 'ft',
      floors: [
        {
          name: 'Ground Floor',
          level: 0,
          clearHeightMm: toMm(12, 'ft'),
          floorToFloorMm: toMm(13, 'ft'),
          rooms: [
            { name: 'Reception', use: 'reception', widthMm: toMm(widthFt, 'ft'), depthMm: toMm(depthFt, 'ft') },
          ],
        },
      ],
    },
    NOW,
  );
  const floor = allFloors(project)[0]!;
  return { floor, room: floor.rooms[0]! };
}

const request: DesignRequest = {
  instruction: 'Make this reception look like a premium satellite technology company.',
  scope: { kind: 'building' },
};

describe('prompt construction', () => {
  it('gives the model the real dimensions in both units', () => {
    const { floor, room } = setup(24, 30);
    const prompt = buildInteriorPrompt({ request, room, walls: floor.walls, theme: THEMES[1] });

    expect(prompt.user).toContain('24.00 ft x 30.00 ft');
    expect(prompt.user).toContain(String(Math.round(toMm(24, 'ft'))));
    expect(prompt.user).toContain('Area: 720 sq ft');
  });

  it('marks emergency exits in the prompt', () => {
    const { floor, room } = setup();
    const prompt = buildInteriorPrompt({ request, room, walls: floor.walls });
    expect(prompt.user).toMatch(/EMERGENCY EXIT/);
  });

  it('states the hard rules in the system prompt', () => {
    const { floor, room } = setup();
    const prompt = buildInteriorPrompt({ request, room, walls: floor.walls });
    expect(prompt.system).toMatch(/base architecture is fixed/i);
    expect(prompt.system).toMatch(/Never state a price/i);
    expect(prompt.system).toMatch(/escape routes outrank/i);
  });

  it('folds a correction into a re-prompt', () => {
    const { floor, room } = setup();
    const prompt = buildInteriorPrompt({
      request,
      room,
      walls: floor.walls,
      correction: 'The table did not fit.',
    });
    expect(prompt.user).toMatch(/PREVIOUS ATTEMPT WAS REJECTED/);
    expect(prompt.user).toContain('The table did not fit.');
  });
});

describe('response extraction', () => {
  it('reads plain JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('reads JSON inside a markdown fence', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('reads JSON after a sentence of preamble', () => {
    expect(extractJson('Here is the design:\n{"a":1}')).toEqual({ a: 1 });
  });

  it('returns null on anything unparseable', () => {
    expect(extractJson('I would suggest marble flooring.')).toBeNull();
  });
});

describe('response validation', () => {
  const validFurniture = (x: number, y: number) => ({
    catalogueKey: 'reception.desk.2400',
    label: 'Reception desk',
    x,
    y,
    rotationDeg: 0,
  });

  it('accepts a well-formed proposal that fits', () => {
    const { floor, room } = setup(24, 30);
    const result = validateInteriorProposal(
      {
        rationale: 'Premium technical reception.',
        finishes: [
          { surface: 'floor', materialId: 'mat_tile_porcelain' },
          { surface: 'wall_internal', materialId: 'mat_paint_emulsion' },
        ],
        ceiling: { kind: 'gypsum_flat', materialId: 'mat_gypsum_ceiling' },
        lighting: [{ kind: 'linear_led', count: 12 }],
        furniture: [validFurniture(toMm(12, 'ft'), toMm(15, 'ft'))],
      },
      room,
      floor.walls,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.design.finishes).toHaveLength(2);
    expect(result.value.design.furniture).toHaveLength(1);
    expect(result.value.design.furniture[0]!.width).toBe(2400);
  });

  it('rejects a hallucinated material id and says which one', () => {
    const { floor, room } = setup();
    const result = validateInteriorProposal(
      {
        finishes: [{ surface: 'floor', materialId: 'mat_italian_carrara_premium' }],
        ceiling: { kind: 'gypsum_flat' },
        lighting: [],
        furniture: [],
      },
      room,
      floor.walls,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid_ids');
    expect(result.detail).toContain('mat_italian_carrara_premium');
    expect(result.correction).toMatch(/Do not invent them/);
  });

  it('rejects a hallucinated furniture key', () => {
    const { floor, room } = setup();
    const result = validateInteriorProposal(
      {
        finishes: [],
        ceiling: { kind: 'none' },
        lighting: [],
        furniture: [{ catalogueKey: 'desk.enormous.9000', label: 'Desk', x: 1000, y: 1000, rotationDeg: 0 }],
      },
      room,
      floor.walls,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_ids');
  });

  it('rejects furniture that does not fit and returns measurements to re-prompt with', () => {
    // The characteristic failure: a plausible layout that does not survive the
    // room it was designed for.
    const { floor, room } = setup(24, 30);
    const result = validateInteriorProposal(
      {
        finishes: [],
        ceiling: { kind: 'none' },
        lighting: [],
        furniture: [
          { catalogueKey: 'table.conference.14', label: 'Table', x: 100, y: 100, rotationDeg: 0 },
        ],
      },
      room,
      floor.walls,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('clearance');
    expect(result.correction).toMatch(/MUST FIX/);
    expect(result.correction).toMatch(/Do not resolve these by changing room dimensions/);
    expect(result.violations!.length).toBeGreaterThan(0);
  });

  it('rejects furniture blocking the emergency exit', () => {
    const { floor, room } = setup(24, 30);
    const wall = floor.walls.find((w) => w.openings.some((o) => o.isEmergencyExit))!;
    const exit = wall.openings.find((o) => o.isEmergencyExit)!;

    const result = validateInteriorProposal(
      {
        finishes: [],
        ceiling: { kind: 'none' },
        lighting: [],
        furniture: [validFurniture(exit.distanceAlongWall, 600)],
      },
      room,
      floor.walls,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('clearance');
      expect(result.correction).toMatch(/emergency exit/i);
    }
  });

  it('rejects a non-object response', () => {
    const { floor, room } = setup();
    const result = validateInteriorProposal('marble flooring', room, floor.walls);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('schema');
  });
});
