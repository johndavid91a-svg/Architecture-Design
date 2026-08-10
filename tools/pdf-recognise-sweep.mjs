/**
 * Does filtering the line work by stroke weight recover the real rooms?
 *
 * The ground truth for this file is printed on the drawing: the schedule of
 * covered area gives 1717.34 sq ft for each of the seven main storeys, and the
 * second-floor sheet titles its hall 30'-2" x 42'-10" = 1292 sq ft. Anything the
 * recogniser produces is measured against those, not against whether it looks
 * plausible.
 *
 *   node tools/pdf-recognise-sweep.mjs <file.pdf> <page> <expected-sqft>
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as core from '../packages/core/dist/index.js';

const args = process.argv.slice(2);
const file = resolve(args[0]);
const pageNumber = Number(args[1]);
const expected = Number(args[2] ?? 1717.34);

const bytes = new Uint8Array(await readFile(file));
const { pages } = await core.extractPdfLineWork(bytes);
const page = pages.find((p) => p.stats.pageNumber === pageNumber);
if (!page) throw new Error(`page ${pageNumber} has no vector line work`);

const widths = [...new Set(page.segments.map((s) => s.width ?? 0))].sort((a, b) => a - b);
console.log(`\nPage ${pageNumber}: ${page.segments.length} segments, stroke widths ${widths.join(', ')}`);
console.log(`Ground truth from the drawing: ${expected} sq ft\n`);

const SQFT = 92_903.04;

function run(label, segments, opts = {}) {
  const work = { ...page, segments };
  const result = core.recogniseFloor(work, { floorName: 'test', level: 0, ...opts });
  const rooms = result.floor?.rooms ?? [];
  const area = rooms.reduce((s, r) => s + core.polygonArea(r.boundary), 0) / SQFT;
  const biggest = rooms.reduce((m, r) => Math.max(m, core.polygonArea(r.boundary) / SQFT), 0);
  console.log(
    `${label.padEnd(42)} segs=${String(segments.length).padStart(5)}  ` +
      `walls=${String(result.floor?.walls.length ?? 0).padStart(4)}  ` +
      `rooms=${String(rooms.length).padStart(3)}  ` +
      `area=${area.toFixed(0).padStart(6)}  biggest=${biggest.toFixed(0).padStart(6)}  ` +
      `(${((area / expected) * 100).toFixed(0)}% of stated)`,
  );
  return { area, rooms };
}

run('everything, defaults', page.segments);

for (const min of widths) {
  if (min === 0) continue;
  const kept = page.segments.filter((s) => (s.width ?? 0) >= min);
  if (kept.length < 20) continue;
  run(`stroke width >= ${min}`, kept);
}

// Stroke width plus a longer minimum wall run: hatching is short heavy strokes
// as often as it is thin ones.
for (const min of [0.5, 0.8]) {
  const kept = page.segments.filter((s) => (s.width ?? 0) >= min);
  if (kept.length < 20) continue;
  for (const minRun of [600, 1200, 2000]) {
    run(`width >= ${min}, minWallRun ${minRun}`, kept, { minWallRunMm: minRun });
  }
}
