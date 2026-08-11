/**
 * Does the basement's design actually fit, and can you walk the floor?
 *
 *   node tools/basement-layout-check.mjs        (needs: npm run build:core)
 *
 * A layout that clears every check on paper and is unwalkable is the failure
 * this project has already hit once, so this script does not stop at geometry.
 * It runs the app's OWN clearance validator over every placement — the same
 * `validatePlacements` an AI proposal has to survive — then adds the four things
 * that validator provably does not do, and finally walks the floor from the
 * bottom of the stair to see what a person can actually reach.
 *
 * What `validatePlacements` does NOT check, and this script therefore does:
 *   - Furniture in ANOTHER room. It filters to `f.roomId === room.id`, so an
 *     item standing inside the ablution counts against nobody. The ablution's
 *     rectangle sits INSIDE GAMES FLOOR (WEST)'s boundary in this architecture,
 *     which makes that trap live rather than theoretical.
 *   - Walls that do not bound the room. Only `room.boundingWallIds` are tested.
 *   - Clearance on more than one face. `clearanceFront` is one-sided, and a 9 ft
 *     pool table needs a cue length on all four.
 *   - Whether the clearance zone is free of anything. It is tested against the
 *     room boundary only — never against walls, doors or other furniture.
 *
 * It prints its findings and exits non-zero if any check fails. Findings that
 * belong to the ARCHITECTURE rather than to the layout are printed separately:
 * the design layer cannot move a wall, so those are reported, not worked around.
 */

import {
  distancePointToSegment,
  findFurniture,
  findMaterial,
  findTheme,
  materialise,
  pointInPolygon,
  polygonArea,
  rectCorners,
  rectInsidePolygon,
  rectsOverlap,
  validatePlacements,
} from '../packages/core/dist/index.js';
import { basementFloor } from './basement-model.mjs';
import {
  EXPECTED_CLEARANCE_SHARING,
  QIBLA_BEARING_DEG,
  THEME_ID,
  basementDesign,
} from './basement-design.mjs';

const NOW = '2026-08-11T00:00:00.000Z';

/**
 * Half the shoulder width of the person doing the walking.
 *
 * 275 mm each side is a 550 mm body. It is deliberately narrower than any
 * comfortable passage: the question this answers is "can a person get there at
 * all", and answering it generously means a gap the check calls passable is one
 * nobody would argue about. Not a code figure — no bye-law was consulted.
 */
const PERSON_RADIUS = 275;
const GRID = 50;

let failures = 0;
let advisories = 0;
const check = (label, ok, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
  return ok;
};
const note = (label, detail) => {
  advisories++;
  console.log(`  ··    ${label}${detail ? ` — ${detail}` : ''}`);
};
const heading = (text) => console.log(`\n${text}\n${'-'.repeat(text.length)}`);

// ---------------------------------------------------------------------------
// Build the twin and the design over it
// ---------------------------------------------------------------------------

const result = materialise(
  {
    name: 'Basement scheme',
    buildingType: 'commercial_plaza',
    location: { city: 'Islamabad', country: 'Pakistan', authority: 'CDA' },
    displayUnit: 'ft',
    floors: [basementFloor()],
  },
  NOW,
);

const floor = result.project.architecture.site.buildings[0].floors[0];
const unmatched = [];
const design = basementDesign([floor], {
  projectId: result.project.id,
  createdAt: NOW,
  onUnmatched: (names) => unmatched.push(...names),
});
const roomDesigns = design.floors[0].rooms;
const roomById = new Map(floor.rooms.map((r) => [r.id, r]));
const allFurniture = roomDesigns.flatMap((rd) => rd.furniture);

console.log(
  `\nBasement layout check — ${floor.rooms.length} room(s) materialised, ` +
    `${roomDesigns.length} designed, ${allFurniture.length} item(s) placed.`,
);

// ---------------------------------------------------------------------------
// 1. Binding
// ---------------------------------------------------------------------------

heading('Binding by name');

for (const issue of result.issues.filter((i) => i.code === 'ROOM_AREA' || i.code === 'ROOM_DEGENERATE')) {
  note('materialise dropped a room', issue.message);
}
check(
  'every designed room resolved to a real room id',
  roomDesigns.every((rd) => roomById.has(rd.roomId)),
);
if (unmatched.length > 0) {
  note(`${unmatched.length} design entr(ies) had no room`, `${unmatched.join(', ')} — reported, not assumed away`);
}
const named = new Map();
for (const room of floor.rooms) named.set(room.name, (named.get(room.name) ?? 0) + 1);
for (const [name, count] of named) {
  if (count > 1) note(`"${name}" is not a unique name`, `${count} rooms; bound north-to-south by centroid`);
}
check('the theme this design belongs to still exists', Boolean(findTheme(THEME_ID)), THEME_ID);

// ---------------------------------------------------------------------------
// 2. The design references only things that exist
// ---------------------------------------------------------------------------

heading('Catalogue agreement');

let badMaterial = 0;
let badFurniture = 0;
for (const rd of roomDesigns) {
  const room = roomById.get(rd.roomId);
  for (const finish of rd.finishes) {
    if (!findMaterial(finish.materialId)) {
      console.log(` FAIL  ${room.name}: material "${finish.materialId}" does not exist`);
      badMaterial++;
    }
    if (finish.wallId && !floor.walls.some((w) => w.id === finish.wallId)) {
      console.log(` FAIL  ${room.name}: finish names a wall that is not on this floor`);
      badMaterial++;
    }
  }
  if (rd.ceiling.materialId && !findMaterial(rd.ceiling.materialId)) {
    console.log(` FAIL  ${room.name}: ceiling material "${rd.ceiling.materialId}" does not exist`);
    badMaterial++;
  }
  for (const item of rd.furniture) {
    const spec = findFurniture(item.catalogueKey);
    if (!spec) {
      console.log(` FAIL  ${room.name}: catalogue key "${item.catalogueKey}" does not exist`);
      badFurniture++;
      continue;
    }
    // A placement carries its own dimensions and the validator measures those,
    // not the catalogue's. A copy that has drifted validates against sizes the
    // catalogue no longer holds, which is a fault nothing else would catch.
    const drift = ['width', 'depth', 'height', 'clearanceFront'].filter(
      (field) => (item[field] ?? 0) !== (spec[field] ?? 0),
    );
    if (drift.length > 0) {
      console.log(
        ` FAIL  ${item.label}: ${drift.map((f) => `${f} ${item[f] ?? '—'} vs catalogue ${spec[f] ?? '—'}`).join(', ')}`,
      );
      badFurniture++;
    }
  }
}
failures += badMaterial + badFurniture;
check('every material id in the design exists in the catalogue', badMaterial === 0);
check('every placement matches its catalogue entry exactly', badFurniture === 0);

const finished = roomDesigns.filter((rd) => rd.finishes.length > 0);
check(
  `every room that should be finished has a floor and a wall finish (${finished.length} of ${roomDesigns.length})`,
  finished.every(
    (rd) =>
      rd.finishes.some((f) => f.surface === 'floor') &&
      rd.finishes.some((f) => f.surface === 'wall_internal'),
  ),
);

// ---------------------------------------------------------------------------
// 3. The app's own clearance validator
// ---------------------------------------------------------------------------

heading("The app's clearance validator");

let blocking = 0;
for (const rd of roomDesigns) {
  const room = roomById.get(rd.roomId);
  const violations = validatePlacements(room, rd.furniture, floor.walls);
  for (const v of violations) {
    if (v.severity === 'error') {
      blocking++;
      console.log(` FAIL  ${room.name}: ${v.kind} — ${v.message}`);
    } else {
      note(`${room.name}: ${v.kind}`, v.message);
    }
  }
}
failures += blocking;
check(`validatePlacements reports no blocking violation (${allFurniture.length} items)`, blocking === 0);

// ---------------------------------------------------------------------------
// 4. What that validator does not check
// ---------------------------------------------------------------------------

heading('What the validator does not check');

const rad = (deg) => (deg * Math.PI) / 180;
const toRect = (f) => ({ centre: f.position, width: f.width, depth: f.depth, rotationDeg: f.rotationDeg });
/** The same construction `clearance.ts` uses: the zone grows off the local −Y face. */
const toClearanceRect = (f) => {
  const front = f.clearanceFront ?? 0;
  if (front === 0) return null;
  const r = rad(f.rotationDeg);
  return {
    centre: {
      x: f.position.x + (front / 2) * Math.sin(r),
      y: f.position.y - (front / 2) * Math.cos(r),
    },
    width: f.width,
    depth: f.depth + front,
    rotationDeg: f.rotationDeg,
  };
};
/** A ring of `gap` all round an item — what a cue swing needs and the field cannot say. */
const toRingRect = (f, gap) => ({
  centre: f.position,
  width: f.width + gap * 2,
  depth: f.depth + gap * 2,
  rotationDeg: f.rotationDeg,
});

const roomOf = (item) => roomById.get(item.roomId);
const clashesWall = (rect) => {
  const corners = rectCorners(rect);
  for (const w of floor.walls) {
    const half = w.thickness / 2;
    for (const c of corners) {
      if (distancePointToSegment(c, w.start, w.end) < half) return w;
    }
  }
  return null;
};

// (a) One item inside another room's boundary.
let strays = 0;
for (const item of allFurniture) {
  const home = roomOf(item);
  const corners = rectCorners(toRect(item));
  for (const other of floor.rooms) {
    if (other.id === home.id) continue;
    if (corners.some((c) => pointInPolygon(c, other.boundary))) {
      console.log(` FAIL  ${item.label} (${home.name}) stands inside ${other.name}`);
      strays++;
    }
  }
}
failures += strays;
check('no item stands inside another room', strays === 0);

// (b) Every item against EVERY wall on the floor, not only the ones that bound it.
let wallClashes = 0;
for (const item of allFurniture) {
  const hit = clashesWall(toRect(item));
  if (hit) {
    console.log(
      ` FAIL  ${item.label} (${roomOf(item).name}) overlaps a ${hit.thickness} mm ${hit.function} wall`,
    );
    wallClashes++;
  }
}
failures += wallClashes;
check('no item overlaps any wall on the floor', wallClashes === 0);

// (c) Every pair on the floor, including pairs in different rooms.
let overlaps = 0;
for (let i = 0; i < allFurniture.length; i++) {
  for (let j = i + 1; j < allFurniture.length; j++) {
    const a = allFurniture[i];
    const b = allFurniture[j];
    if (rectsOverlap(toRect(a), toRect(b))) {
      console.log(` FAIL  ${a.label} overlaps ${b.label}`);
      overlaps++;
    }
  }
}
failures += overlaps;
check('no two items overlap, across the whole floor', overlaps === 0);

// (d) Clearance zones: inside the room, off the walls, and free of other items.
const shared = new Map();
for (const [a, b, why] of EXPECTED_CLEARANCE_SHARING) {
  shared.set(`${a}|${b}`, why);
  shared.set(`${b}|${a}`, why);
}
let zoneFaults = 0;
for (const item of allFurniture) {
  const zone = toClearanceRect(item);
  if (!zone) continue;
  const home = roomOf(item);
  if (!rectInsidePolygon(zone, home.boundary)) {
    console.log(` FAIL  ${item.label}: its ${item.clearanceFront} mm clearance leaves ${home.name}`);
    zoneFaults++;
  }
  const hit = clashesWall(zone);
  if (hit) {
    console.log(` FAIL  ${item.label}: its ${item.clearanceFront} mm clearance runs into a wall`);
    zoneFaults++;
  }
  for (const other of allFurniture) {
    if (other.id === item.id) continue;
    if (!rectsOverlap(zone, toRect(other))) continue;
    const why = shared.get(`${item.catalogueKey}|${other.catalogueKey}`);
    if (why) {
      note(`${other.label} stands in ${item.label}'s clearance`, why);
    } else {
      console.log(` FAIL  ${other.label} stands in ${item.label}'s ${item.clearanceFront} mm clearance`);
      zoneFaults++;
    }
  }
}
failures += zoneFaults;
check('every clearance zone is on free floor', zoneFaults === 0);

// (e) The pool table needs a cue length on all four sides, which no field says.
const CUE_MM = 1500;
let ringFaults = 0;
for (const item of allFurniture.filter((f) => f.catalogueKey === 'games.pool.9ft')) {
  const ring = toRingRect(item, CUE_MM);
  const home = roomOf(item);
  if (!rectInsidePolygon(ring, home.boundary)) {
    console.log(` FAIL  ${item.label}: ${CUE_MM} mm cue clearance does not fit inside ${home.name}`);
    ringFaults++;
  }
  if (clashesWall(ring)) {
    console.log(` FAIL  ${item.label}: ${CUE_MM} mm cue clearance runs into a wall`);
    ringFaults++;
  }
  for (const other of allFurniture) {
    if (other.id === item.id) continue;
    if (rectsOverlap(ring, toRect(other))) {
      console.log(` FAIL  ${other.label} is inside the pool table's ${CUE_MM} mm cue swing`);
      ringFaults++;
    }
  }
}
failures += ringFaults;
check(`the 9 ft table has ${CUE_MM} mm of cue clearance on all four sides`, ringFaults === 0);

// (f) Both darts lanes keep the oche throw clear, on the throwing side only.
let oche = 0;
for (const item of allFurniture.filter((f) => f.catalogueKey === 'games.dartboard')) {
  const zone = toClearanceRect(item);
  for (const other of allFurniture) {
    if (other.id === item.id) continue;
    if (rectsOverlap(zone, toRect(other))) {
      console.log(` FAIL  ${other.label} stands in ${item.label}'s ${item.clearanceFront} mm throw`);
      oche++;
    }
  }
}
failures += oche;
check('both darts lanes keep the oche throw clear', oche === 0);

// ---------------------------------------------------------------------------
// 5. Can you walk it?
// ---------------------------------------------------------------------------

heading(`Walking the floor (a ${PERSON_RADIUS * 2} mm body, ${GRID} mm grid)`);

const xs = floor.walls.flatMap((w) => [w.start.x, w.end.x]);
const ys = floor.walls.flatMap((w) => [w.start.y, w.end.y]);
const minX = Math.min(...xs);
const minY = Math.min(...ys);
const cols = Math.ceil((Math.max(...xs) - minX) / GRID) + 1;
const rowsN = Math.ceil((Math.max(...ys) - minY) / GRID) + 1;
const px = (c) => minX + c * GRID;
const py = (r) => minY + r * GRID;

/**
 * Is this point walkable?
 *
 * Blocked by a wall unless the nearest point on that wall falls inside a door or
 * an archway, with the body's width taken off each jamb — a 914 mm door with a
 * 550 mm body leaves 364 mm of usable span, and a narrower opening blocks.
 * Furniture blocks by its own footprint; a clearance zone does NOT, because a
 * cue swing with nobody playing is floor you can cross.
 */
function walkable(p, withFurniture) {
  for (const w of floor.walls) {
    const d = distancePointToSegment(p, w.start, w.end);
    if (d >= w.thickness / 2 + PERSON_RADIUS) continue;
    const len = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
    const t =
      ((p.x - w.start.x) * (w.end.x - w.start.x) + (p.y - w.start.y) * (w.end.y - w.start.y)) / (len * len);
    const along = t * len;
    // `distanceAlongWall` is the CENTRE of the opening, not its near jamb —
    // model/edit.ts validates it as `distance ± width / 2` against the wall
    // length, and clearance.ts measures door swings from that same point.
    const through = w.openings.some(
      (o) =>
        (o.kind === 'door' || o.kind === 'archway') &&
        Math.abs(along - o.distanceAlongWall) < o.width / 2 - PERSON_RADIUS,
    );
    if (!through) return false;
  }
  if (withFurniture) {
    for (const f of allFurniture) {
      if (pointInPolygon(p, rectCorners(toRingRect(f, PERSON_RADIUS)))) return false;
    }
  }
  return true;
}

function flood(withFurniture) {
  const seen = new Uint8Array(cols * rowsN);
  const stair = floor.rooms.find((r) => r.use === 'stair');
  // Start at the stair's centroid, which is where a person arriving on this
  // floor is standing before they take a step.
  const start = {
    x: stair.boundary.reduce((s, p) => s + p.x, 0) / stair.boundary.length,
    y: stair.boundary.reduce((s, p) => s + p.y, 0) / stair.boundary.length,
  };
  const c0 = Math.round((start.x - minX) / GRID);
  const r0 = Math.round((start.y - minY) / GRID);
  const queue = [[c0, r0]];
  seen[r0 * cols + c0] = 1;
  while (queue.length > 0) {
    const [c, r] = queue.pop();
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rowsN) continue;
      const k = nr * cols + nc;
      if (seen[k]) continue;
      seen[k] = 1;
      if (walkable({ x: px(nc), y: py(nr) }, withFurniture)) queue.push([nc, nr]);
      else seen[k] = 2; // visited, blocked
    }
  }
  return seen;
}

const reachedWith = flood(true);
const reachedWithout = flood(false);
const isReached = (grid, p) => {
  const c = Math.round((p.x - minX) / GRID);
  const r = Math.round((p.y - minY) / GRID);
  return c >= 0 && r >= 0 && c < cols && r < rowsN && grid[r * cols + c] === 1;
};

/** Any walkable cell inside this room that the walk reached. */
function roomReached(room, grid) {
  const b = room.boundary;
  const lo = { x: Math.min(...b.map((p) => p.x)), y: Math.min(...b.map((p) => p.y)) };
  const hi = { x: Math.max(...b.map((p) => p.x)), y: Math.max(...b.map((p) => p.y)) };
  for (let x = lo.x; x <= hi.x; x += GRID) {
    for (let y = lo.y; y <= hi.y; y += GRID) {
      const p = { x, y };
      if (!pointInPolygon(p, b)) continue;
      if (isReached(grid, p)) return true;
    }
  }
  return false;
}

const blockedByLayout = [];
const blockedByBuilding = [];
for (const room of floor.rooms) {
  if (roomReached(room, reachedWith)) continue;
  (roomReached(room, reachedWithout) ? blockedByLayout : blockedByBuilding).push(room);
}
const walkableRooms = floor.rooms.length - blockedByLayout.length - blockedByBuilding.length;

check(
  `no room is shut off by this layout (${walkableRooms} of ${floor.rooms.length} reachable from the stair)`,
  blockedByLayout.length === 0,
  blockedByLayout.length > 0
    ? `shut off by furniture: ${blockedByLayout.map((r) => r.name).join(', ')}`
    : blockedByBuilding.length > 0
      ? `${blockedByBuilding.length} more are shut off by the building itself — see below`
      : undefined,
);

// Every item has to be walked up to, or it is decoration nobody can use. An
// item in a room the BUILDING shuts off is counted against the building, not
// against the layout: no arrangement of furniture can open that door.
let unreachableItems = 0;
const strandedByBuilding = new Set();
for (const item of allFurniture) {
  // Somewhere a person can stand and touch it: any reached cell inside a ring
  // one body deep round the item. Testing only the ring's corners would call an
  // item unreachable whenever its neighbours happen to sit on the diagonals.
  const approach = rectCorners(toRingRect(item, PERSON_RADIUS + GRID * 2));
  const lo = { x: Math.min(...approach.map((p) => p.x)), y: Math.min(...approach.map((p) => p.y)) };
  const hi = { x: Math.max(...approach.map((p) => p.x)), y: Math.max(...approach.map((p) => p.y)) };
  let standing = false;
  for (let x = lo.x; x <= hi.x && !standing; x += GRID) {
    for (let y = lo.y; y <= hi.y && !standing; y += GRID) {
      const p = { x, y };
      if (pointInPolygon(p, approach) && isReached(reachedWith, p)) standing = true;
    }
  }
  if (standing) continue;
  const home = roomOf(item);
  if (blockedByBuilding.includes(home)) {
    strandedByBuilding.add(home.name);
    continue;
  }
  console.log(` FAIL  ${item.label} (${home.name}) cannot be walked up to`);
  unreachableItems++;
}
failures += unreachableItems;
check(
  'every item in a reachable room can be walked up to',
  unreachableItems === 0,
  strandedByBuilding.size > 0
    ? `${[...strandedByBuilding].join(', ')} stranded with the room, not by the layout`
    : undefined,
);

/**
 * Why a room cannot be entered — the outside face of each of its doors.
 *
 * "Unreachable" on its own is a result nobody can act on. Stepping out through
 * each door until the floor becomes walkable, and naming what is standing there,
 * turns it into something an architect can answer.
 */
function doorDiagnosis(room) {
  const c = {
    x: room.boundary.reduce((s, p) => s + p.x, 0) / room.boundary.length,
    y: room.boundary.reduce((s, p) => s + p.y, 0) / room.boundary.length,
  };
  const lines = [];
  for (const w of floor.walls.filter((x) => room.boundingWallIds.includes(x.id))) {
    const dx = w.end.x - w.start.x;
    const dy = w.end.y - w.start.y;
    const len = Math.hypot(dx, dy);
    for (const o of w.openings.filter((x) => x.kind === 'door' || x.kind === 'archway')) {
      const t = o.distanceAlongWall;
      const p = { x: w.start.x + (dx * t) / len, y: w.start.y + (dy * t) / len };
      // The normal pointing away from the room this door serves.
      let n = { x: -dy / len, y: dx / len };
      if ((p.x + n.x - c.x) ** 2 + (p.y + n.y - c.y) ** 2 < (p.x - c.x) ** 2 + (p.y - c.y) ** 2) {
        n = { x: -n.x, y: -n.y };
      }
      let clearAt = null;
      let clearPoint = null;
      for (let d = 100; d <= 3000 && clearAt === null; d += 25) {
        const q = { x: p.x + n.x * d, y: p.y + n.y * d };
        if (walkable(q, false)) {
          clearAt = d;
          clearPoint = q;
        }
      }
      const probe = { x: p.x + n.x * 150, y: p.y + n.y * 150 };
      const facing = floor.walls
        .filter((x) => x.id !== w.id)
        .map((x) => ({ wall: x, d: distancePointToSegment(probe, x.start, x.end) }))
        .sort((a, b) => a.d - b.d)[0];
      const owner = floor.rooms.find(
        (r) => r.id !== room.id && r.boundingWallIds.includes(facing.wall.id),
      );
      lines.push(
        `door ${o.width} mm at (${Math.round(p.x)}, ${Math.round(p.y)}) opens onto ` +
          `${owner ? `${owner.name}'s wall` : 'a wall'} ${Math.round(facing.d)} mm away; ` +
          (clearAt === null
            ? 'no walkable floor within 3 m of it'
            : `walkable floor begins ${clearAt} mm out, and ` +
              `${isReached(reachedWithout, clearPoint) ? 'it does connect to the stair' : 'that floor is itself cut off from the stair'}`),
      );
    }
  }
  return lines.length > 0 ? lines : ['no door on any wall that bounds it'];
}

if (blockedByBuilding.length > 0) {
  heading('Architecture findings (not fixable in the design layer)');
  for (const room of blockedByBuilding) {
    console.log(
      `  !!    ${room.name} cannot be reached even with the floor cleared of furniture ` +
        `(${(polygonArea(room.boundary) / 92903.04).toFixed(0)} sq ft)`,
    );
    for (const line of doorDiagnosis(room)) console.log(`          ${line}`);
  }
  console.log(
    '\n  These are properties of tools/basement-model.mjs, which is settled and must not move.\n' +
      '  A design cannot open a door, so they are reported here rather than worked around. The\n' +
      '  finishes and the contents of these rooms are designed and costed as if they were entered.',
  );
}

// ---------------------------------------------------------------------------

heading('Summary');
console.log(`  Qibla used for the prayer rows: ${QIBLA_BEARING_DEG}° — a SAMPLE bearing, not surveyed.`);
console.log('  Clearances are conventional working dimensions. Not checked against local bye-laws.');
console.log(
  `\n${failures === 0 ? 'Layout checks passed' : `${failures} check(s) FAILED`}` +
    `, ${advisories} advisor(y/ies)` +
    `${blockedByBuilding.length > 0 ? `, ${blockedByBuilding.length} architecture finding(s)` : ''}.\n`,
);
process.exit(failures === 0 ? 0 : 1);
