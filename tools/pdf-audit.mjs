/**
 * What did we actually read off this drawing set?
 *
 * Runs the real pipeline — the same `extractPdfLineWork`, `identifySheet` and
 * `chooseFloorSheets` the app runs — over one file and prints every decision it
 * made, sheet by sheet. It is not a pass/fail check; it is the thing you read
 * before you are entitled to claim the import worked.
 *
 *   node tools/pdf-audit.mjs <file.pdf> [--sheets] [--rooms]
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as core from '../packages/core/dist/index.js';

const args = process.argv.slice(2);
const file = resolve(args.find((a) => !a.startsWith('--')) ?? '');
const showSheets = args.includes('--sheets');
const showRooms = args.includes('--rooms');

const bytes = new Uint8Array(await readFile(file));
console.log(`\n${file}\n${(bytes.length / 1e6).toFixed(1)} MB\n`);

const started = Date.now();
const { pages, issues } = await core.extractPdfLineWork(bytes);
console.log(`${pages.length} page(s) of vector line work read in ${((Date.now() - started) / 1000).toFixed(1)} s`);
for (const issue of issues) console.log(`  [${issue.severity}] ${issue.code}: ${issue.message}`);

// ---- Sheet classification ------------------------------------------------
const sheets = pages.map((p) => core.identifySheet(p.stats.pageNumber, p.texts));
const byKind = new Map();
for (const s of sheets) byKind.set(s.kind, (byKind.get(s.kind) ?? 0) + 1);
console.log('\nSheet kinds:');
for (const [kind, n] of [...byKind].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${kind}`);

const byFamily = new Map();
for (const s of sheets) if (s.kind === 'floor_plan') byFamily.set(s.family, (byFamily.get(s.family) ?? 0) + 1);
console.log('\nFloor-plan families:');
for (const [family, n] of [...byFamily].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${family}`);

if (showSheets) {
  console.log('\nEvery sheet:');
  for (const s of sheets) {
    const scale = pages.find((p) => p.stats.pageNumber === s.pageNumber)?.toMmScale ?? 0;
    console.log(
      `  p${String(s.pageNumber).padStart(3)}  ${s.kind.padEnd(16)} ${String(s.family).padEnd(8)} ` +
        `${(s.storey ?? '-').padEnd(12)} scale=${scale.toFixed(3).padStart(8)} ` +
        `${s.titleRecovered ? '[recovered] ' : ''}${JSON.stringify(s.title).slice(0, 70)}`,
    );
  }
}

const chosen = core.chooseFloorSheets(sheets);
console.log(`\nChosen family: ${chosen.family}`);
console.log(`Storeys imported (${chosen.floors.length}):`);
for (const f of chosen.floors) {
  console.log(`  level ${String(f.level).padStart(3)}  ${String(f.storey).padEnd(12)} from page ${f.pageNumber}`);
}

// ---- What each storey turned into ---------------------------------------
const byPage = new Map(pages.map((p) => [p.stats.pageNumber, p]));
let totalRooms = 0;
let named = 0;
console.log('\nWhat each storey produced:');
for (const sheet of chosen.floors) {
  const page = byPage.get(sheet.pageNumber);
  if (!page || page.toMmScale <= 0) {
    console.log(`  ${sheet.storey}: no usable scale`);
    continue;
  }
  const r = core.recogniseFloor(page, { floorName: sheet.storey ?? '', level: sheet.level ?? 0 });
  const rooms = r.floor?.rooms ?? [];
  const area = rooms.reduce((s, x) => s + core.polygonArea(x.boundary), 0) / 92_903.04;
  const withNames = rooms.filter((x) => x.name !== 'Unnamed space');
  totalRooms += rooms.length;
  named += withNames.length;
  console.log(
    `  ${String(sheet.storey).padEnd(12)} ${String(rooms.length).padStart(3)} space(s), ` +
      `${String(withNames.length).padStart(3)} named, ${area.toFixed(0).padStart(6)} sq ft, ` +
      `${String(r.floor?.walls.length ?? 0).padStart(4)} walls`,
  );
  if (showRooms) {
    const counts = new Map();
    for (const room of rooms) counts.set(room.name, (counts.get(room.name) ?? 0) + 1);
    for (const [name, n] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
      console.log(`        ${String(n).padStart(3)} x ${name}`);
    }
  }
}
console.log(`\nTotal: ${totalRooms} space(s), ${named} named (${((named / (totalRooms || 1)) * 100).toFixed(0)}%).\n`);
