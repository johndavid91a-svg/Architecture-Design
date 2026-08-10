/**
 * Look at the drawing, and at what the recogniser made of it.
 *
 * Every other probe in this directory prints numbers. Numbers told us a floor
 * came back as eight slivers; they did not tell us the slivers were triangles
 * between hatch lines. Some questions are only answerable by looking, so this
 * draws three panels side by side for one page:
 *
 *   1. the raw line work, coloured by stroke weight
 *   2. the walls the recogniser paired
 *   3. the rooms it closed
 *
 *   xvfb-run -a npx electron --no-sandbox tools/pdf-render.mjs <file.pdf> <page> <out.png>
 */

import { app, BrowserWindow } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const passed = process.argv.slice(1).filter((a) => !a.startsWith('-') && !a.endsWith('pdf-render.mjs'));
const file = resolve(passed[0]);
const pageNumber = Number(passed[1]);
const out = resolve(passed[2] ?? 'page.png');

app.disableHardwareAcceleration();

const core = await import(
  pathToFileURL('/home/user/Architecture-Design/packages/core/dist/index.js').href
);

const bytes = new Uint8Array(await readFile(file));
const { pages } = await core.extractPdfLineWork(bytes);
const page = pages.find((p) => p.stats.pageNumber === pageNumber);
if (!page) throw new Error(`page ${pageNumber} has no line work`);

const result = core.recogniseFloor(page, { floorName: 'render', level: 0 });
const walls = result.floor?.walls ?? [];
const rooms = result.floor?.rooms ?? [];

const e = page.extent;
const w = e.maxX - e.minX;
const h = e.maxY - e.minY;
const PANEL = 900;
const k = Math.min(PANEL / w, PANEL / h);
// PDF y runs up, screen y runs down.
const X = (x) => ((x - e.minX) * k).toFixed(1);
const Y = (y) => ((e.maxY - y) * k).toFixed(1);
// Walls and rooms come back in millimetres; the page is in points.
const MX = (x) => ((x / page.toMmScale - e.minX) * k).toFixed(1);
const MY = (y) => ((e.maxY - y / page.toMmScale) * k).toFixed(1);

const weights = [...new Set(page.segments.map((s) => s.width ?? 0))].sort((a, b) => a - b);
const HUES = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#bcf60c', '#808000'];
const colourFor = (s) => HUES[weights.indexOf(s.width ?? 0) % HUES.length];

const rawSvg = page.segments
  .map(
    (s) =>
      `<line x1="${X(s.a.x)}" y1="${Y(s.a.y)}" x2="${X(s.b.x)}" y2="${Y(s.b.y)}" stroke="${colourFor(s)}" stroke-width="0.7"/>`,
  )
  .join('');

const wallSvg = walls
  .map((wall) => {
    const len = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) / 304.8;
    const colour = len > 20 ? '#e6194b' : len > 6 ? '#f58231' : '#4363d8';
    return `<line x1="${MX(wall.start.x)}" y1="${MY(wall.start.y)}" x2="${MX(wall.end.x)}" y2="${MY(wall.end.y)}" stroke="${colour}" stroke-width="1.4"/>`;
  })
  .join('');

const roomSvg = rooms
  .map((r) => {
    const points = r.boundary.map((p) => `${MX(p.x)},${MY(p.y)}`).join(' ');
    return `<polygon points="${points}" fill="rgba(60,180,75,0.45)" stroke="#2a7d3f" stroke-width="1"/>`;
  })
  .join('');

const legend = weights
  .map((weight, i) => {
    const n = page.segments.filter((s) => (s.width ?? 0) === weight).length;
    return `<span style="color:${HUES[i % HUES.length]}">&#9632;</span> w=${weight} (${n})`;
  })
  .join(' &nbsp; ');

const panel = (title, body, note) =>
  `<figure><figcaption>${title}<br><small>${note}</small></figcaption>
   <svg width="${PANEL}" height="${(h * k).toFixed(0)}" viewBox="0 0 ${PANEL} ${(h * k).toFixed(0)}"
        style="background:#fff">${body}</svg></figure>`;

const html = `<body style="margin:0;background:#111;color:#eee;font:13px system-ui">
<div style="padding:8px">Page ${pageNumber} — ${page.segments.length} segments, ${walls.length} walls, ${rooms.length} rooms. ${legend}</div>
<div style="display:flex;gap:8px;padding:8px">
${panel('raw line work', rawSvg, 'coloured by stroke weight')}
${panel('walls paired', wallSvg, 'red &gt;20 ft, orange &gt;6 ft, blue short')}
${panel('rooms closed', roomSvg, `${rooms.length} face(s)`)}
</div></body>`;

const tmp = `${out}.html`;
await writeFile(tmp, html);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 2800, height: 1150, show: true });
  await win.loadFile(tmp);
  await new Promise((r) => setTimeout(r, 900));
  const image = await win.webContents.capturePage();
  await writeFile(out, image.toPNG());
  console.log(`wrote ${out}`);
  win.destroy();
  app.exit(0);
});
