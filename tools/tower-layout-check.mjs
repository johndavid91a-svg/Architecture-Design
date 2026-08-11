/**
 * Prove the tower's layout before it is looked at.
 *
 * The app's own clearance validator has a veto over anything the design layer
 * proposes, so a layout that has not been run through it is a layout that has
 * not been checked — it will simply be refused on screen, one room at a time,
 * with no clue as to which item was at fault. This runs it here, names every
 * item, and says what would be rejected and why.
 *
 *   node tools/tower-layout-check.mjs
 */

import { materialise, validatePlacements, findFurniture } from '../packages/core/dist/index.js';
import { towerFloors } from './tower-model.mjs';
import { towerDesign, EXPECTED_CLEARANCE_SHARING } from './tower-design.mjs';

const FT = 304.8;
const ft = (mm) => (mm / FT).toFixed(2);

const built = materialise(
  {
    name: 'Tower',
    buildingType: 'commercial_plaza',
    location: { city: 'Islamabad', country: 'Pakistan', authority: 'CDA' },
    displayUnit: 'ft',
    floors: towerFloors(),
  },
  new Date().toISOString(),
);

const floors = built.project.architecture.site.buildings.flatMap((b) => b.floors);
const unmatched = [];
const design = towerDesign(floors, {
  projectId: built.project.id,
  onUnmatched: (names) => unmatched.push(...names),
});

const byRoom = new Map(design.rooms.map((rd) => [rd.roomId, rd]));

let errors = 0;
let warnings = 0;
const shared = new Set(EXPECTED_CLEARANCE_SHARING.map(([a, b]) => `${a}|${b}`));

console.log('TOWER LAYOUT CHECK');
console.log('='.repeat(78));

if (unmatched.length > 0) {
  console.log('\nDesign entries that matched no room:');
  for (const u of unmatched) console.log(`  !!  ${u}`);
}

for (const floor of floors) {
  const designed = floor.rooms.filter((r) => byRoom.has(r.id));
  const items = designed.reduce((n, r) => n + byRoom.get(r.id).furniture.length, 0);
  console.log(`\n${floor.name}  (level ${floor.level})  ${designed.length}/${floor.rooms.length} rooms designed, ${items} item(s)`);

  for (const room of floor.rooms) {
    const rd = byRoom.get(room.id);
    if (!rd) {
      console.log(`   --  ${room.name} — no design`);
      continue;
    }
    const violations = validatePlacements(room, rd.furniture, floor.walls);
    // A pair listed as expected to share a clearance is not a fault. Everything
    // else that lands in one is, and is printed rather than passed over.
    const real = violations.filter((v) => {
      if (v.kind !== 'clearance_blocked') return true;
      const a = rd.furniture.find((f) => f.id === v.furnitureId);
      const b = rd.furniture.find((f) => f.label === v.blockedBy || f.id === v.blockedBy);
      if (!a || !b) return true;
      return !shared.has(`${a.catalogueKey}|${b.catalogueKey}`) && !shared.has(`${b.catalogueKey}|${a.catalogueKey}`);
    });
    const blocking = real.filter((v) => v.severity === 'error');
    const advisory = real.filter((v) => v.severity !== 'error');
    errors += blocking.length;
    warnings += advisory.length;

    const mark = blocking.length === 0 ? ' ok ' : 'FAIL';
    console.log(`   ${mark}  ${room.name.padEnd(16)} ${String(rd.furniture.length).padStart(3)} item(s)` +
      (blocking.length ? `  — ${blocking.length} blocking` : '') +
      (advisory.length ? `, ${advisory.length} advisory` : ''));
    for (const v of blocking.slice(0, 8)) console.log(`          ${v.kind}: ${v.message}`);
    if (blocking.length > 8) console.log(`          … and ${blocking.length - 8} more`);
  }
}

// Every catalogue key the design uses must exist, at the size it claims.
console.log('\nCatalogue agreement');
console.log('-'.repeat(78));
const keys = new Set(design.rooms.flatMap((rd) => rd.furniture.map((f) => f.catalogueKey)));
let drift = 0;
for (const key of [...keys].sort()) {
  const spec = findFurniture(key);
  if (!spec) {
    console.log(`  FAIL  ${key} — not in the catalogue`);
    drift++;
    continue;
  }
  const used = design.rooms.flatMap((rd) => rd.furniture).find((f) => f.catalogueKey === key);
  const same =
    used.width === spec.width && used.depth === spec.depth && used.height === spec.height;
  if (!same) {
    console.log(`  FAIL  ${key} — placement ${used.width}x${used.depth}x${used.height} vs catalogue ${spec.width}x${spec.depth}x${spec.height}`);
    drift++;
  }
}
if (drift === 0) console.log(`   ok   all ${keys.size} catalogue key(s) exist and match their placements`);

console.log('\nSummary');
console.log('-'.repeat(78));
console.log(`  ${errors} blocking violation(s), ${warnings} advisory, ${drift} catalogue mismatch(es).`);
console.log('  Clearances are conventional working dimensions. NOT checked against local bye-laws.');
process.exitCode = errors + drift > 0 ? 1 : 0;
