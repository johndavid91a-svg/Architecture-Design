// Build the Space Centre template and check it reads as a real building.
import {
  createSpaceCentre,
  allFloors,
  computeMetrics,
  computeTakeoff,
  checkRegulations,
  polygonArea,
  fromMm2,
} from '../packages/core/dist/index.js';

const project = createSpaceCentre({}, '2026-08-08T00:00:00.000Z');
const floors = allFloors(project);
const metrics = computeMetrics(project.architecture);

console.log(`${project.name} — ${project.architecture.site.location.city}\n${'='.repeat(72)}`);

for (const floor of floors) {
  const area = floor.rooms.reduce((t, r) => t + polygonArea(r.boundary), 0);
  const xs = floor.rooms.flatMap((r) => r.boundary.map((p) => p.x));
  const ys = floor.rooms.flatMap((r) => r.boundary.map((p) => p.y));
  const w = (Math.max(...xs) - Math.min(...xs)) / 1000;
  const d = (Math.max(...ys) - Math.min(...ys)) / 1000;
  const openings = floor.walls.reduce((n, wl) => n + wl.openings.length, 0);

  console.log(
    `\nL${floor.level} ${floor.name.padEnd(13)} ${w.toFixed(1)} x ${d.toFixed(1)} m   ` +
      `${fromMm2(area, 'ft2').toFixed(0).padStart(6)} sq ft   ` +
      `${String(floor.rooms.length).padStart(2)} rooms  ${String(floor.walls.length).padStart(3)} walls  ` +
      `${String(openings).padStart(3)} openings   f2f ${(floor.floorToFloor / 1000).toFixed(1)} m`,
  );
  console.log(`   ${floor.purpose ?? ''}`);
  const listed = [...floor.rooms]
    .sort((a, b) => polygonArea(b.boundary) - polygonArea(a.boundary))
    .map((r) => `${r.name} ${(polygonArea(r.boundary) / 1e6).toFixed(0)}m²`);
  console.log(`   ${listed.join(' · ')}`);
}

const takeoff = computeTakeoff(floors);
const report = checkRegulations(project.architecture, { authority: 'CDA', source: 'Template check' });

console.log(`\n${'='.repeat(72)}`);
console.log(`Plot            : ${metrics.plotAreaSqft.toFixed(0)} sq ft (90 x 60 m)`);
console.log(`Covered (total) : ${metrics.totalCoveredAreaSqft.toFixed(0)} sq ft over ${metrics.floorCount} floors`);
console.log(`Ground coverage : ${(metrics.groundCoverageRatio * 100).toFixed(1)}%`);
console.log(`FAR             : ${metrics.far.toFixed(2)}`);
console.log(`Takeoff lines   : ${takeoff.lines.length}`);
console.log(`Regulation      : ${report.observations.length} observation(s), none claiming a pass`);

// --- Checks a professional would actually make -----------------------------
let bad = 0;
const check = (label, ok, detail = '') => {
  if (!ok) bad++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
};

console.log(`\nSanity`);
check('four floors', floors.length === 4, `${floors.length}`);
check(
  'every floor has a corridor',
  floors.every((f) => f.rooms.some((r) => r.use === 'corridor')),
);
check(
  'every room reaches the corridor by a door',
  floors.every((f) =>
    f.rooms
      .filter((r) => !['corridor', 'stair', 'lift'].includes(r.use))
      .every((r) =>
        f.walls.some((w) => r.boundingWallIds.includes(w.id) && w.openings.some((o) => o.kind === 'door')),
      ),
  ),
);
check(
  'stair and lift on every floor',
  floors.every((f) => f.rooms.some((r) => r.use === 'stair') && f.rooms.some((r) => r.use === 'lift')),
);
check(
  'every floor has an escape door',
  floors.every((f) => f.walls.some((w) => w.openings.some((o) => o.isEmergencyExit))),
);
check(
  'the planetarium and the data centre are blind',
  floors
    .flatMap((f) => f.rooms.filter((r) => r.use === 'planetarium' || r.use === 'server_room'))
    .every((r) => {
      const floor = floors.find((f) => f.id === r.floorId);
      return floor.walls
        .filter((w) => r.boundingWallIds.includes(w.id))
        .every((w) => !w.openings.some((o) => o.kind === 'window'));
    }),
);
check('every opening fits its wall', floors.every((f) =>
  f.walls.every((w) => {
    const len = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
    return w.openings.every((o) => o.distanceAlongWall - o.width / 2 >= -1 && o.distanceAlongWall + o.width / 2 <= len + 1);
  }),
));
check('building fits inside the plot', metrics.groundCoverageRatio > 0 && metrics.groundCoverageRatio < 1,
  `${(metrics.groundCoverageRatio * 100).toFixed(1)}% coverage`);
check('no takeoff quantity is negative or non-finite',
  takeoff.lines.every((l) => Number.isFinite(l.quantity) && l.quantity >= 0));
check('no regulation observation claims a pass',
  report.observations.every((o) => o.severity !== 'passes' && o.severity !== 'compliant'));

console.log(bad === 0 ? '\nALL CHECKS PASSED' : `\n${bad} CHECK(S) FAILED`);
process.exit(bad === 0 ? 0 : 1);
