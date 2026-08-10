/**
 * Everything one page of a drawing says about itself.
 *
 * The text as read, the scale the page states, and what the recogniser made of
 * the geometry. This is the tool for the question "why did that sheet come out
 * wrong", which cannot be answered from a summary.
 *
 *   node tools/pdf-page-dump.mjs <file.pdf> <page> [more pages…]
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

  const sheet = core.identifySheet(n, page.texts);
  console.log(`\n${'='.repeat(78)}`);
  console.log(`PAGE ${n}   ${sheet.kind} / ${sheet.family} / ${sheet.storey ?? '-'}`);
  console.log(`title: ${JSON.stringify(sheet.title)}${sheet.titleRecovered ? '  [font recovered]' : ''}`);
  console.log(`extent (pt): ${(page.extent.maxX - page.extent.minX).toFixed(0)} x ${(page.extent.maxY - page.extent.minY).toFixed(0)}`);
  console.log(`toMmScale: ${page.toMmScale} mm per point   (units: ${page.units?.unit}, ${page.units?.source})`);
  console.log(`note: ${page.units?.note ?? ''}`);
  console.log(`segments: ${page.segments.length}, texts: ${page.texts.length}`);

  // Longest few segments, in the units the page claims — the fastest way to see
  // a scale that is out by a factor.
  const lengths = page.segments
    .map((s) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y))
    .sort((a, b) => b - a);
  const ft = (pt) => ((pt * page.toMmScale) / 304.8).toFixed(1);
  console.log(
    `longest runs: ${lengths.slice(0, 6).map((l) => `${ft(l)} ft`).join(', ')}` +
      `   median ${ft(lengths[Math.floor(lengths.length / 2)] ?? 0)} ft`,
  );

  const texts = page.texts
    .map((t) => t.text.trim())
    .filter((t) => t.length > 0);
  console.log(`\ntext on the sheet (${texts.length} run(s)):`);
  console.log(texts.slice(0, 120).map((t) => JSON.stringify(t)).join(' '));

  console.log(
    `\nextent in feet: ${(((page.extent.maxX - page.extent.minX) * page.toMmScale) / 304.8).toFixed(1)} x ` +
      `${(((page.extent.maxY - page.extent.minY) * page.toMmScale) / 304.8).toFixed(1)}`,
  );
}
