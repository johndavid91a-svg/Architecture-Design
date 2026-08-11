/**
 * The proposed basement scheme, drawn against the architect's real shell.
 *
 * Every fixed element — stair, lift, tanks, kitchen, bath, manholes — is at the
 * size the drawing states. The proposed zones are laid over the hall and CHECKED
 * for overlap rather than eyeballed, because a games room is a packing problem
 * and a plan that looks fine at a glance is exactly how you end up with a pool
 * table you cannot cue on.
 *
 *   xvfb-run -a npx electron --no-sandbox tools/basement-scheme.mjs <out.png>
 */

import { app, BrowserWindow } from 'electron';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const passed = process.argv.slice(1).filter((a) => !a.startsWith('-') && !a.endsWith('basement-scheme.mjs'));
const out = resolve(passed[0] ?? 'basement.png');

app.disableHardwareAcceleration();

// Everything in feet, origin at the building's north-west corner.
const BUILDING = { w: 40, d: 43.5 };
/** The hall, from the drawing: 30'-2" x 42'-10", east of the service strip. */
const HALL = { x: 9.833, y: 0, w: 30.167, d: 42.833 };

/** What the architect drew. None of it moves. */
const FIXED = [
  { name: 'KITCHEN', note: `8'-5" x 6'-4"`, x: 1.2, y: 0.5, w: 8.417, d: 6.333 },
  { name: 'BATH', note: `4'-7" x 5'-5½"`, x: 1.2, y: 7.0, w: 4.583, d: 5.458 },
  { name: 'SUMP', note: `3' x 5'`, x: 0.4, y: 13.0, w: 3, d: 5 },
  { name: 'M.H', note: '', x: 4.2, y: 13.4, w: 2.6, d: 2.6 },
  { name: 'M.H', note: '', x: 7.0, y: 13.4, w: 2.6, d: 2.6 },
  { name: 'U.G.W.T', note: `10' x 10' x 6'`, x: 9.833, y: 13.0, w: 10, d: 10 },
  { name: 'STAIRS', note: `8'-4½" x 18'-10"`, x: 1.2, y: 18.8, w: 8.375, d: 18.833 },
  { name: 'LIFT', note: `7'-6" x 6'-3"`, x: 1.2, y: 38.0, w: 7.5, d: 5.25 },
];

/**
 * The scheme, after the cuts we agreed.
 *
 * `enclosed` marks a zone that gets real partitions — you cannot walk through
 * it, only into it. The games zones are open floor: their clearance IS the
 * circulation, which is what makes the numbers work at all.
 */
const ZONES = [
  {
    name: 'TUCK SHOP / CAFÉ',
    note: `10'-0" x 11'-0"  ·  110 sq ft`,
    sub: 'plus the existing kitchen behind it',
    x: 9.833, y: 0.5, w: 10, d: 11, hue: '#8a5a2b', enclosed: true,
  },
  {
    name: 'ABLUTION',
    note: `4'-4" x 9'-0"  ·  39 sq ft`,
    x: 20.0, y: 0.5, w: 4.333, d: 9, hue: '#2f7f7f', enclosed: true,
  },
  {
    name: 'PRAYER ROOM (MALE)',
    note: `15'-6" x 18'-10"  ·  292 sq ft`,
    x: 24.5, y: 0.5, w: 15.5, d: 18.833, hue: '#1f6b3a', enclosed: true,
  },
  {
    name: 'POOL TABLE',
    note: `18'-6" x 14'-0"  ·  259 sq ft`,
    sub: '9-ft table, full cue clearance · table tennis folds out here',
    x: 20.0, y: 22.5, w: 18.5, d: 14, hue: '#1d4f8c',
  },
  {
    name: 'FOOSBALL',
    note: `6'-6" x 10'-6"  ·  68 sq ft`,
    x: 9.833, y: 23.5, w: 6.5, d: 10.5, hue: '#5a3f8c',
  },
  {
    // Two boards on the hall's west wall. An oche is 7'-9¼" from the board face
    // and a thrower wants about 2 ft behind, so the lane is 10 ft deep; 4 ft of
    // width apiece keeps two games out of each other's way.
    name: 'DARTS (2 BOARDS)',
    note: `10'-0" deep x 8'-0" wide  ·  80 sq ft`,
    sub: 'boards on the west wall, two lanes',
    x: 9.833, y: 34.5, w: 10, d: 8, hue: '#8c4a1d',
  },
  {
    name: 'LOUNGE / LED',
    note: `12'-0" x 5'-10"  ·  70 sq ft`,
    sub: `LED 12'-0" x 6'-9" on the south wall`,
    x: 24.0, y: 37.0, w: 12, d: 5.833, hue: '#7a2f5a',
  },
];

// ---- Check, do not assume ------------------------------------------------
const overlaps = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.d && b.y < a.y + a.d;

const problems = [];
for (let i = 0; i < ZONES.length; i++) {
  for (let j = i + 1; j < ZONES.length; j++) {
    if (overlaps(ZONES[i], ZONES[j])) problems.push(`${ZONES[i].name} overlaps ${ZONES[j].name}`);
  }
  for (const f of FIXED) {
    if (overlaps(ZONES[i], f)) problems.push(`${ZONES[i].name} overlaps the fixed ${f.name}`);
  }
  const z = ZONES[i];
  if (z.x < HALL.x - 0.01 || z.x + z.w > HALL.x + HALL.w + 0.01 || z.y + z.d > HALL.y + HALL.d + 0.01) {
    problems.push(`${z.name} falls outside the hall`);
  }
}

// ---- Can you actually walk there? ---------------------------------------
//
// Overlap is not the only way a plan fails, and it is not the one that bites.
// The first version of this scheme cleared every overlap test and still had no
// route from the stair to the prayer room: the water tank blocked the west side
// and the ablution and the pool pinched the gap between them to two inches. A
// drawing can look completely correct and be unwalkable, so the floor is
// flooded from the stair door and everything is checked for reachability.
const CELL = 0.5; // feet
const cols = Math.ceil(BUILDING.w / CELL);
const rows = Math.ceil(BUILDING.d / CELL);
const blocked = (cx, cy) => {
  const p = { x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2, w: 0, d: 0 };
  const inside = (r) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.d;
  if (!inside({ x: HALL.x, y: HALL.y, w: HALL.w, d: HALL.d })) return true;
  if (FIXED.some(inside)) return true;
  if (ZONES.filter((z) => z.enclosed).some(inside)) return true;
  return false;
};

// The stair arrives at the hall's west edge. Where exactly along the flight the
// door sits is the architect's business, so every point along it is tried and
// the first that is not already inside something becomes the start — otherwise
// the check reports the whole floor unreachable because the one point it picked
// happened to land inside the water tank, which is what it did first time.
const stair = FIXED.find((f) => f.name === 'STAIRS');
const startX = Math.floor((HALL.x + 0.6) / CELL);
let startY = -1;
for (let y = stair.y; y < stair.y + stair.d; y += CELL) {
  const cy = Math.floor(y / CELL);
  if (!blocked(startX, cy)) {
    startY = cy;
    break;
  }
}
const seen = new Set();
const queue = [];
if (startY >= 0) {
  seen.add(`${startX},${startY}`);
  queue.push([startX, startY]);
} else {
  problems.push('the stair has no clear landing onto the hall at all');
}
while (queue.length > 0) {
  const [cx, cy] = queue.pop();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = cx + dx;
    const ny = cy + dy;
    const key = `${nx},${ny}`;
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || seen.has(key) || blocked(nx, ny)) continue;
    seen.add(key);
    queue.push([nx, ny]);
  }
}

// Every enclosed room needs a walkable cell against one of its edges — a door.
for (const z of ZONES.filter((x) => x.enclosed)) {
  let reachable = false;
  for (const key of seen) {
    const [cx, cy] = key.split(',').map(Number);
    const px = cx * CELL + CELL / 2;
    const py = cy * CELL + CELL / 2;
    const near =
      px > z.x - CELL && px < z.x + z.w + CELL && py > z.y - CELL && py < z.y + z.d + CELL;
    if (near) {
      reachable = true;
      break;
    }
  }
  if (!reachable) problems.push(`${z.name} cannot be reached on foot from the stair`);
}
for (const z of ZONES.filter((x) => !x.enclosed)) {
  const cx = Math.floor((z.x + z.w / 2) / CELL);
  const cy = Math.floor((z.y + z.d / 2) / CELL);
  if (!seen.has(`${cx},${cy}`)) problems.push(`${z.name} cannot be reached on foot from the stair`);
}
console.log(`walkable floor reachable from the stair: ${(seen.size * CELL * CELL).toFixed(0)} sq ft`);

const zoneArea = ZONES.reduce((s, z) => s + z.w * z.d, 0);
const hallArea = HALL.w * HALL.d;
const tankInHall = 10 * 10;
const usable = hallArea - tankInHall;

console.log(`hall ${hallArea.toFixed(0)} sq ft, less the water tank = ${usable.toFixed(0)} usable`);
console.log(`zones ${zoneArea.toFixed(0)} sq ft → circulation ${(usable - zoneArea).toFixed(0)} sq ft (${(((usable - zoneArea) / usable) * 100).toFixed(0)}%)`);
if (problems.length === 0) console.log('no overlaps: every zone clears every other zone and every fixed element');
else for (const p of problems) console.log(`  CLASH: ${p}`);

// ---- Draw ----------------------------------------------------------------
const K = 26; // pixels per foot
const PAD = 60;
const W = BUILDING.w * K + PAD * 2;
const H = BUILDING.d * K + PAD * 2;
const X = (v) => (PAD + v * K).toFixed(1);
const Y = (v) => (PAD + v * K).toFixed(1);

const box = (r, fill, stroke, dashed) =>
  `<rect x="${X(r.x)}" y="${Y(r.y)}" width="${(r.w * K).toFixed(1)}" height="${(r.d * K).toFixed(1)}" ` +
  `fill="${fill}" stroke="${stroke}" stroke-width="1.6"${dashed ? ' stroke-dasharray="5 4"' : ''}/>`;

const label = (r, title, note, sub, colour) => {
  const cx = X(r.x + r.w / 2);
  const cy = Y(r.y + r.d / 2);
  const wide = r.w * K > 110;
  return (
    `<text x="${cx}" y="${Number(cy) - (note ? 7 : 0)}" text-anchor="middle" font-size="${wide ? 12 : 9}" font-weight="700" fill="${colour}">${title}</text>` +
    (note && wide ? `<text x="${cx}" y="${Number(cy) + 8}" text-anchor="middle" font-size="10" fill="#3a4653">${note}</text>` : '') +
    (sub && wide ? `<text x="${cx}" y="${Number(cy) + 21}" text-anchor="middle" font-size="9" font-style="italic" fill="#6b7785">${sub}</text>` : '')
  );
};

const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="background:#faf9f6">
  <!-- shell -->
  <rect x="${X(0)}" y="${Y(0)}" width="${(BUILDING.w * K).toFixed(1)}" height="${(BUILDING.d * K).toFixed(1)}"
        fill="none" stroke="#101418" stroke-width="5"/>
  ${box(HALL, 'none', '#b8c2cc', true)}

  <!-- proposed zones -->
  ${ZONES.map((z) => box(z, `${z.hue}22`, z.hue)).join('')}
  ${ZONES.map((z) => label(z, z.name, z.note, z.sub, z.hue)).join('')}

  <!-- what the architect drew -->
  ${FIXED.map((f) => box(f, '#dfe4ea', '#5a6470')).join('')}
  ${FIXED.map((f) => label(f, f.name, f.note, null, '#26303a')).join('')}

  <!-- overall dimensions -->
  <text x="${X(BUILDING.w / 2)}" y="${Y(0) - 22}" text-anchor="middle" font-size="13" font-weight="700">40'-0"</text>
  <text x="${X(BUILDING.w) + 34}" y="${Y(BUILDING.d / 2)}" text-anchor="middle" font-size="13" font-weight="700"
        transform="rotate(90 ${X(BUILDING.w) + 34} ${Y(BUILDING.d / 2)})">43'-6"</text>
  <text x="${X(HALL.x + HALL.w / 2)}" y="${Y(HALL.d) + 26}" text-anchor="middle" font-size="11" fill="#6b7785">HALL 30'-2" x 42'-10" (dashed)</text>
</svg>`;

const html = `<body style="margin:0;background:#0b0f14;color:#e8eef5;font:13px system-ui">
<div style="padding:12px 16px">
  <div style="font-size:17px;font-weight:700">BASEMENT — Entertainment &amp; Recreation Lounge</div>
  <div style="color:#9fb0c2;margin-top:3px">
    Laid over the architect's shell. Grey = existing, unchanged. Colour = proposed, new partitions.
    Floor-to-floor 9'-9" (Section A-A) → about 8'-3" clear under beams.
  </div>
  <div style="color:#9fb0c2;margin-top:3px">
    Hall ${hallArea.toFixed(0)} sq ft − ${tankInHall} sq ft water tank = ${usable.toFixed(0)} usable ·
    zones ${zoneArea.toFixed(0)} sq ft · circulation ${(usable - zoneArea).toFixed(0)} sq ft
    (${(((usable - zoneArea) / usable) * 100).toFixed(0)}%) ·
    ${problems.length === 0 ? 'no clashes' : `${problems.length} CLASH(ES)`}
  </div>
</div>
<div style="padding:0 16px 16px">${svg}</div>
</body>`;

const tmp = `${out}.html`;
await writeFile(tmp, html);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: W + 40, height: H + 130, show: true });
  await win.loadFile(tmp);
  await new Promise((r) => setTimeout(r, 800));
  await writeFile(out, (await win.webContents.capturePage()).toPNG());
  console.log(`wrote ${out}`);
  win.destroy();
  app.exit(problems.length === 0 ? 0 : 1);
});
