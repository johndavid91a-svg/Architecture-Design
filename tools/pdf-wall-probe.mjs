/**
 * The walls the recogniser found, in feet, longest first.
 *
 * When a floor comes out as a handful of slivers instead of a room, this is the
 * question that matters: are the long walls there at all? If they are, the fault
 * is in the face trace. If they are not, the fault is upstream in pairing.
 *
 *   node tools/pdf-wall-probe.mjs <file.pdf> <page> [--segments]
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as core from '../packages/core/dist/index.js';

const args = process.argv.slice(2);
const file = resolve(args[0]);
const pageNumber = Number(args[1]);
const showSegments = args.includes('--segments');

const bytes = new Uint8Array(await readFile(file));
const { pages } = await core.extractPdfLineWork(bytes);
const page = pages.find((p) => p.stats.pageNumber === pageNumber);
if (!page) throw new Error(`page ${pageNumber} has no line work`);

const ft = (mm) => mm / 304.8;
const pos = (p) => `(${ft(p.x * page.toMmScale).toFixed(1)}, ${ft(p.y * page.toMmScale).toFixed(1)})`;

if (showSegments) {
  const segs = page.segments
    .map((s) => ({ s, len: Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) * page.toMmScale }))
    .sort((a, b) => b.len - a.len);
  console.log(`\n${segs.length} raw segment(s); the 30 longest:`);
  for (const { s, len } of segs.slice(0, 30)) {
    console.log(`  ${ft(len).toFixed(1).padStart(7)} ft  ${pos(s.a)} -> ${pos(s.b)}  w=${s.width ?? '-'}`);
  }
}

const result = core.recogniseFloor(page, { floorName: 'probe', level: 0 });
const walls = [...(result.floor?.walls ?? [])]
  .map((w) => ({ w, len: Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y) }))
  .sort((a, b) => b.len - a.len);

console.log(`\n${walls.length} wall(s) recognised; the 25 longest:`);
for (const { w, len } of walls.slice(0, 25)) {
  const a = { x: w.start.x / page.toMmScale, y: w.start.y / page.toMmScale };
  const b = { x: w.end.x / page.toMmScale, y: w.end.y / page.toMmScale };
  console.log(
    `  ${ft(len).toFixed(1).padStart(7)} ft  t=${(w.thickness / 25.4).toFixed(1).padStart(5)} in  ` +
      `${pos(a)} -> ${pos(b)}`,
  );
}

const lengths = walls.map((x) => x.len).sort((a, b) => a - b);
const q = (p) => ft(lengths[Math.floor(lengths.length * p)] ?? 0).toFixed(2);
console.log(`\nwall length quartiles (ft): p25=${q(0.25)} median=${q(0.5)} p75=${q(0.75)} p95=${q(0.95)}`);

const rooms = result.floor?.rooms ?? [];
console.log(`\n${rooms.length} room(s):`);
for (const r of rooms.slice(0, 20)) {
  const bb = core.boundsOf(r.boundary);
  console.log(
    `  ${(core.polygonArea(r.boundary) / 92_903.04).toFixed(0).padStart(6)} sq ft  ` +
      `${ft(bb.maxX - bb.minX).toFixed(1)} x ${ft(bb.maxY - bb.minY).toFixed(1)} ft  "${r.name}"`,
  );
}

for (const issue of result.issues) console.log(`  [${issue.severity}] ${issue.code}: ${issue.message}`);
