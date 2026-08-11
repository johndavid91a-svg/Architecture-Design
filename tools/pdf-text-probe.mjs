/**
 * Every text run on a page, with its position and size.
 *
 * The question this answers: a plan writes `HALL` and `30'-2" x 42'-10"` under
 * it, so how do those two strings actually arrive from the PDF, and what sits
 * between them?
 *
 *   node tools/pdf-text-probe.mjs <file.pdf> <page>
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as core from '../packages/core/dist/index.js';

const args = process.argv.slice(2);
const file = resolve(args[0]);
const pageNumber = Number(args[1]);

const bytes = new Uint8Array(await readFile(file));
const { pages } = await core.extractPdfLineWork(bytes);
const page = pages.find((p) => p.stats.pageNumber === pageNumber);
if (!page) throw new Error(`page ${pageNumber} has no line work`);

// Sorted the way a reader reads: down the page, then across.
const items = [...page.texts].sort((a, b) => b.at.y - a.at.y || a.at.x - b.at.x);
console.log(`page ${pageNumber}: ${items.length} text run(s)\n`);
for (const t of items) {
  console.log(
    `  y=${t.at.y.toFixed(1).padStart(7)} x=${t.at.x.toFixed(1).padStart(7)} ` +
      `h=${(t.heightHint ?? 0).toFixed(1).padStart(5)}  ${JSON.stringify(t.text)}`,
  );
}
