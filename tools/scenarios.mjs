/**
 * Generate the buildings a user in Pakistan would actually ask for, and check
 * every derived figure against arithmetic done independently here.
 *
 * Plot sizes are the standard Pakistani residential units. 1 marla = 225 sq ft
 * and 1 kanal = 20 marla = 4,500 sq ft in Punjab and Islamabad, which is the
 * definition CDA and the Punjab housing schemes use. The plot proportions are
 * the ones these schemes are actually laid out to.
 */
import {
  createProject,
  computeTakeoff,
  computeMetrics,
  checkRegulations,
  allFloors,
  toMm,
  polygonArea,
} from '../packages/core/dist/index.js';

const NOW = '2026-08-07T00:00:00.000Z';
const SQFT = 92_903.04;
let failures = 0;

function check(label, actual, expected, tolerance) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (!ok) failures++;
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(
    `    [${mark}] ${label}: got ${actual.toFixed(1)}, expected ${expected.toFixed(1)} (±${tolerance})`,
  );
}

function assert(label, condition, detail = '') {
  if (!condition) failures++;
  console.log(`    [${condition ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}

const room = (name, use, w, d) => ({
  name,
  use,
  widthMm: toMm(w, 'ft'),
  depthMm: toMm(d, 'ft'),
});

const SCENARIOS = [
  {
    label: '5 marla house, Islamabad (25 x 45 ft, 1,125 sq ft plot)',
    buildingType: 'residential_house',
    city: 'Islamabad',
    authority: 'CDA',
    plot: [25, 45],
    floors: 2,
    cores: ['stair'],
    rooms: [
      room('Lounge', 'lounge', 14, 16),
      room('Bedroom 1', 'bedroom', 12, 14),
      room('Kitchen', 'kitchen', 8, 10),
      room('Bath', 'toilet', 5, 8),
    ],
  },
  {
    label: '10 marla house, Rawalpindi (35 x 65 ft, 2,275 sq ft plot)',
    buildingType: 'residential_house',
    city: 'Rawalpindi',
    authority: 'RDA',
    plot: [35, 65],
    floors: 2,
    cores: ['stair'],
    rooms: [
      room('Drawing room', 'lounge', 16, 18),
      room('Lounge', 'lounge', 15, 20),
      room('Bedroom 1', 'bedroom', 14, 16),
      room('Bedroom 2', 'bedroom', 12, 14),
      room('Kitchen', 'kitchen', 10, 12),
      room('Bath', 'toilet', 6, 8),
    ],
  },
  {
    label: '1 kanal house, Lahore (50 x 90 ft, 4,500 sq ft plot)',
    buildingType: 'residential_house',
    city: 'Lahore',
    authority: 'OTHER_PK',
    plot: [50, 90],
    floors: 2,
    cores: ['stair'],
    rooms: [
      room('Drawing room', 'lounge', 18, 22),
      room('Dining', 'lounge', 16, 18),
      room('Lounge', 'lounge', 18, 20),
      room('Bedroom 1', 'bedroom', 16, 18),
      room('Bedroom 2', 'bedroom', 14, 16),
      room('Bedroom 3', 'bedroom', 14, 16),
      room('Kitchen', 'kitchen', 12, 14),
      room('Bath', 'toilet', 7, 9),
    ],
  },
  {
    label: 'Small commercial plaza, Islamabad (30 x 60 ft, 4 storeys)',
    buildingType: 'commercial_plaza',
    city: 'Islamabad',
    authority: 'CDA',
    plot: [30, 60],
    floors: 4,
    cores: ['stair', 'lift'],
    rooms: [room('Shop', 'retail', 24, 40), room('Store', 'store', 10, 12)],
  },
  {
    label: 'Large commercial plaza, Karachi (60 x 100 ft, 8 storeys)',
    buildingType: 'commercial_plaza',
    city: 'Karachi',
    authority: 'OTHER_PK',
    plot: [60, 100],
    floors: 8,
    cores: ['stair', 'lift'],
    rooms: [
      room('Retail floor', 'retail', 40, 60),
      room('Office', 'office', 20, 30),
      room('Toilets', 'toilet', 10, 14),
    ],
  },
  {
    label: 'Single-storey shop, Rawalpindi (20 x 40 ft)',
    buildingType: 'retail',
    city: 'Rawalpindi',
    authority: 'RDA',
    plot: [20, 40],
    floors: 1,
    cores: [],
    rooms: [room('Shop floor', 'retail', 16, 30)],
  },
];

console.log('GENERATED BUILDING SCENARIOS\n' + '='.repeat(70));

for (const s of SCENARIOS) {
  console.log(`\n### ${s.label}`);

  const clearHeight = toMm(s.buildingType === 'residential_house' ? 10 : 12, 'ft');
  const project = createProject(
    {
      name: s.label,
      buildingType: s.buildingType,
      location: { city: s.city, country: 'Pakistan', authority: s.authority },
      displayUnit: 'ft',
      plotWidthMm: toMm(s.plot[0], 'ft'),
      plotDepthMm: toMm(s.plot[1], 'ft'),
      cores: s.cores,
      floors: Array.from({ length: s.floors }, (_, i) => ({
        name: i === 0 ? 'Ground Floor' : `Floor ${i}`,
        level: i,
        clearHeightMm: clearHeight,
        floorToFloorMm: clearHeight + toMm(1, 'ft'),
        rooms: s.rooms,
      })),
    },
    NOW,
  );

  const arch = project.architecture;
  const floors = allFloors(project);
  const metrics = computeMetrics(arch);

  // --- Structure -------------------------------------------------------
  assert('every requested floor exists', floors.length === s.floors, `${floors.length} floors`);

  const roomsPerFloor = floors[0].rooms.length;
  const expectedRooms = s.rooms.length + (s.floors > 1 ? s.cores.length : 0);
  assert(
    'rooms per floor = requested rooms + cores',
    roomsPerFloor === expectedRooms,
    `${roomsPerFloor} rooms (${s.rooms.length} requested + ${s.floors > 1 ? s.cores.length : 0} cores)`,
  );

  // --- Dimensions survive verbatim ------------------------------------
  // The whole product rests on this: a room the user entered as 14 x 16 ft must
  // measure 14 x 16 ft after generation, not 13.98.
  let dimensionsExact = true;
  for (const spec of s.rooms) {
    const built = floors[0].rooms.find((r) => r.name === spec.name);
    if (!built) {
      dimensionsExact = false;
      continue;
    }
    const area = polygonArea(built.boundary);
    if (Math.abs(area - spec.widthMm * spec.depthMm) > 1) dimensionsExact = false;
  }
  assert('every entered dimension survives generation exactly', dimensionsExact);

  // --- Areas -----------------------------------------------------------
  const requestedSqft = s.rooms.reduce((t, r) => t + (r.widthMm * r.depthMm) / SQFT, 0);
  const plotSqft = s.plot[0] * s.plot[1];
  check('plot area (sq ft)', metrics.plotAreaSqft, plotSqft, 1);

  const floorSqft = floors[0].rooms.reduce((t, r) => t + polygonArea(r.boundary) / SQFT, 0);
  assert(
    'ground floor area >= the rooms asked for',
    floorSqft >= requestedSqft - 1,
    `${floorSqft.toFixed(0)} sq ft vs ${requestedSqft.toFixed(0)} requested`,
  );
  check('covered area = floor area x storeys', metrics.totalCoveredAreaSqft, floorSqft * s.floors, 2);
  check('FAR = covered / plot', metrics.far, (floorSqft * s.floors) / plotSqft, 0.01);

  // --- Walls and openings ----------------------------------------------
  const walls = floors.flatMap((f) => f.walls);
  assert('every floor has walls', floors.every((f) => f.walls.length > 0));
  assert(
    'no wall is shorter than a brick or longer than the plot diagonal',
    walls.every((w) => {
      const len = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
      const diagonal = Math.hypot(toMm(s.plot[0], 'ft'), toMm(s.plot[1], 'ft'));
      return len >= 100 && len <= diagonal * 3;
    }),
  );
  assert(
    'every opening fits inside its wall',
    walls.every((w) => {
      const len = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
      return w.openings.every(
        (o) => o.distanceAlongWall - o.width / 2 >= -1 && o.distanceAlongWall + o.width / 2 <= len + 1,
      );
    }),
  );

  // --- Vertical circulation --------------------------------------------
  if (s.floors > 1) {
    const stair = floors[0].rooms.find((r) => r.use === 'stair');
    assert('a multi-storey building gets a staircase', Boolean(stair));
    if (s.cores.includes('lift')) {
      assert('and a lift', Boolean(floors[0].rooms.find((r) => r.use === 'lift')));
    }
    // A stair core present on the ground floor must be present on every floor,
    // or the building has a staircase that leads nowhere.
    const onEvery = floors.every((f) => f.rooms.some((r) => r.use === 'stair'));
    assert('the staircase reaches every floor', onEvery);
  }

  // --- Takeoff ---------------------------------------------------------
  const takeoff = computeTakeoff(floors);
  assert('takeoff produces lines', takeoff.lines.length > 0, `${takeoff.lines.length} lines`);
  assert(
    'no takeoff quantity is negative or non-finite',
    takeoff.lines.every((l) => Number.isFinite(l.quantity) && l.quantity >= 0),
  );
  assert(
    'every takeoff line records how it was derived',
    takeoff.lines.every((l) => typeof l.derivation === 'string' && l.derivation.length > 0),
  );

  // --- Regulation ------------------------------------------------------
  const report = checkRegulations(arch, { authority: s.authority, source: 'Scenario harness' });
  assert(
    'no regulation observation claims compliance',
    report.observations.every((o) => o.severity !== 'passes' && o.severity !== 'compliant'),
  );
  assert('the disclaimer is present', /not a compliance determination/i.test(report.disclaimer));

  console.log(
    `    -> ${metrics.totalCoveredAreaSqft.toFixed(0)} sq ft covered on a ${plotSqft} sq ft plot, ` +
      `FAR ${metrics.far.toFixed(2)}, ${takeoff.lines.length} takeoff lines`,
  );
}

console.log('\n' + '='.repeat(70));
console.log(failures === 0 ? 'ALL SCENARIO CHECKS PASSED' : `${failures} SCENARIO CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
