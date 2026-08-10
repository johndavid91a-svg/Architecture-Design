/**
 * Does an imported building have a way in, and a way up?
 *
 * Runs the real import pipeline over a synthetic set shaped like the user's:
 * nine storeys, a hall rather than a grid of rooms, a wide front door, and — as
 * every PDF import does — no stair and no lift anywhere in the drawing.
 *
 *   node tools/circulation-check.mjs
 */

import {
  findEntrances,
  justInside,
  landingFor,
  materialise,
  transportNear,
  transportPoints,
} from '../packages/core/dist/index.js';

const NOW = '2026-08-10T00:00:00.000Z';
const STOREYS = ['Basement', 'Ground', 'Mezzanine', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Mumty'];

const rect = (x, y, w, d) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + d },
  { x, y: y + d },
];

const wall = (x1, y1, x2, y2, openings = []) => ({
  start: { x: x1, y: y1 },
  end: { x: x2, y: y2 },
  thickness: 229,
  height: 3000,
  function: 'exterior',
  loadBearing: true,
  confidence: 'extracted',
  openings,
});

const floors = STOREYS.map((name, i) => ({
  name,
  level: i - 1,
  elevation: (i - 1) * 3600,
  floorToFloor: 3600,
  clearHeight: 3000,
  confidence: 'extracted',
  rooms: [
    { name: 'HALL', use: 'open_office', boundary: rect(0, 0, 9000, 14000), clearHeight: 3000, confidence: 'extracted' },
    { name: 'KITCHEN', use: 'kitchen', boundary: rect(9600, 0, 4000, 4000), clearHeight: 3000, confidence: 'extracted' },
    { name: 'W.C.', use: 'toilet', boundary: rect(9600, 4600, 4000, 2600), clearHeight: 3000, confidence: 'extracted' },
  ],
  walls: [
    wall(0, 0, 19500, 0, [
      { kind: 'door', distanceAlongWall: 4500, width: 2100, height: 2400, sillHeight: 0, confidence: 'extracted' },
      { kind: 'door', distanceAlongWall: 17000, width: 900, height: 2100, sillHeight: 0, confidence: 'extracted' },
    ]),
    wall(19500, 0, 19500, 14000),
    wall(19500, 14000, 0, 14000),
    wall(0, 14000, 0, 0),
  ],
}));

const result = materialise(
  {
    name: 'Circulation check',
    buildingType: 'commercial_plaza',
    location: { city: 'Islamabad', country: 'Pakistan', authority: 'CDA' },
    displayUnit: 'ft',
    floors,
  },
  NOW,
);

const built = result.project.architecture.site.buildings[0].floors;
let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
};

console.log(`\n${built.length} storey(s) built from ${floors.length} imported.\n`);

check('every storey has a staircase', built.every((f) => f.rooms.some((r) => r.use === 'stair')));
check('every storey has a lift', built.every((f) => f.rooms.some((r) => r.use === 'lift')));
check('every storey has a stair flight to draw', built.every((f) => f.stairs.length === 1));

const added = result.issues.find((i) => i.code === 'CORES_ADDED');
check('the addition is declared to the user', Boolean(added), added?.severity);
check('it is declared as needing review, not as a note', added?.severity === 'review');

const cores = transportPoints(built);
check(`a landing on every storey (${cores.length} found)`, cores.length === built.length * 2);

// Can you actually get from the bottom to the top?
let level = built[0].level;
let hops = 0;
for (;;) {
  const here = cores.find((c) => c.level === level && c.kind === 'lift');
  if (!here) break;
  const up = landingFor(here, level + 1, cores);
  if (!up) break;
  level = up.level;
  hops++;
  if (hops > 50) break;
}
check(
  `the lift reaches the top: ${hops} hop(s) from ${built[0].name} to ${built[hops]?.name}`,
  level === built[built.length - 1].level,
);

// Standing in the middle of the lift, is the lift "near"?
const liftGround = cores.find((c) => c.kind === 'lift' && c.level === 0);
check('standing in the lift, the lift is offered', Boolean(transportNear(liftGround.at, 0, cores)));

const entrances = findEntrances(built);
check(`an entrance was found (${entrances.length} candidate(s))`, entrances.length > 0);
if (entrances.length > 0) {
  const main = entrances[0];
  check('the widest door is the main entrance', main.widthMm === 2100, `${main.widthMm} mm`);
  check('it is on the ground floor', main.level === 0, `level ${main.level}`);
  const spot = justInside(main);
  // The front wall runs along y = 0 with the building at positive y.
  check('stepping inside puts you inside', spot.y > main.at.y, `y ${main.at.y} -> ${spot.y}`);
  console.log(`        basis: ${main.basis}`);
}

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}\n`);
process.exit(failures === 0 ? 0 : 1);
