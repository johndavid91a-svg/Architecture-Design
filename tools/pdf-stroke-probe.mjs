/**
 * What is actually on this page, sorted by how it was drawn.
 *
 * A PDF has no layers, but it does have stroke styles, and a CAD plot uses them
 * consistently: wall lines are heavy, dimension lines and hatching are hair
 * lines. If the two separate, the recogniser can stop reading a dimension chain
 * as a row of walls. This prints the evidence for that, per page.
 *
 *   node tools/pdf-stroke-probe.mjs <file.pdf> <page>
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as core from '../packages/core/dist/index.js';

const args = process.argv.slice(2);
const file = resolve(args[0]);
const wanted = new Set(args.slice(1).map(Number));

const bytes = new Uint8Array(await readFile(file));
const { pages } = await core.extractPdfLineWork(bytes);

for (const page of pages) {
  const n = page.stats.pageNumber;
  if (wanted.size > 0 && !wanted.has(n)) continue;

  console.log(`\n${'='.repeat(78)}\nPAGE ${n} — ${page.segments.length} segments`);

  const groups = new Map();
  for (const s of page.segments) {
    const key = `${s.layer ?? '-'}`;
    const length = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) * page.toMmScale;
    const g = groups.get(key) ?? { count: 0, total: 0, lengths: [], width: s.width };
    g.count++;
    g.total += length;
    g.lengths.push(length);
    groups.set(key, g);
  }

  console.log(`\n${groups.size} stroke style(s):`);
  const rows = [...groups].sort((a, b) => b[1].total - a[1].total);
  for (const [key, g] of rows.slice(0, 20)) {
    g.lengths.sort((a, b) => a - b);
    const median = g.lengths[Math.floor(g.lengths.length / 2)] ?? 0;
    const longest = g.lengths[g.lengths.length - 1] ?? 0;
    console.log(
      `  ${key.padEnd(34)} n=${String(g.count).padStart(5)}  ` +
        `run=${(g.total / 304.8).toFixed(0).padStart(6)} ft  ` +
        `median=${(median / 304.8).toFixed(2).padStart(6)} ft  ` +
        `longest=${(longest / 304.8).toFixed(1).padStart(6)} ft  ` +
        `width=${g.width ?? '-'}`,
    );
  }

  // Where the ink is. A plan's building fabric sits inside the drawing frame;
  // the title block is a separate cluster in the corner.
  const xs = page.segments.flatMap((s) => [s.a.x, s.b.x]).sort((a, b) => a - b);
  const ys = page.segments.flatMap((s) => [s.a.y, s.b.y]).sort((a, b) => a - b);
  const pct = (arr, p) => arr[Math.floor(arr.length * p)] ?? 0;
  const ft = (pt) => ((pt * page.toMmScale) / 304.8).toFixed(1);
  console.log(
    `\nink spread: x ${ft(pct(xs, 0.02))}..${ft(pct(xs, 0.98))} ft, ` +
      `y ${ft(pct(ys, 0.02))}..${ft(pct(ys, 0.98))} ft ` +
      `(so about ${ft(pct(xs, 0.98) - pct(xs, 0.02))} x ${ft(pct(ys, 0.98) - pct(ys, 0.02))} ft)`,
  );
}
