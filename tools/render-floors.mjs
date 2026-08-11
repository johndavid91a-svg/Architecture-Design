/**
 * Draw every storey a drawing set imported as, on one sheet.
 *
 * The point is to be able to look at all of it at once: which storeys came
 * through, what each one is made of, and how the areas compare with what the
 * drawing states about itself. A table of numbers does not answer "does this
 * look like my building"; this does.
 *
 *   xvfb-run -a npx electron --no-sandbox tools/render-floors.mjs <file.pdf> <out.png>
 */

import { app, BrowserWindow } from 'electron';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const passed = process.argv.slice(1).filter((a) => !a.startsWith('-') && !a.endsWith('render-floors.mjs'));
const file = resolve(passed[0]);
const out = resolve(passed[1] ?? 'floors.png');

app.disableHardwareAcceleration();

const repo = '/home/user/Architecture-Design';
const { importDrawingFile } = await import(
  pathToFileURL(`${repo}/packages/desktop/dist-test/drawing-import.js`).href
);
const core = await import(pathToFileURL(`${repo}/packages/core/dist/index.js`).href);

const result = await importDrawingFile(file);
const SQFT = 92_903.04;

const stated = new Map(
  (result.issues.find((i) => i.code === 'DRAWING_STATES_AREAS')?.message ?? '')
    .split(',')
    .map((part) => /([A-Z. ]+?)\s+([\d,]+(?:\.\d+)?)\s*sq ft/.exec(part))
    .filter(Boolean)
    .map((m) => [m[1].trim().toUpperCase(), Number(m[2].replace(/,/g, ''))]),
);

const PANEL = 430;

function panelFor(floor) {
  const points = [
    ...floor.rooms.flatMap((r) => r.boundary),
    ...floor.walls.flatMap((w) => [w.start, w.end]),
  ];
  if (points.length === 0) {
    return `<figure><figcaption><b>${floor.name}</b><br><small>nothing imported</small></figcaption>
      <svg width="${PANEL}" height="${PANEL}" style="background:#f7f6f3"></svg></figure>`;
  }

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  const pad = 18;
  const k = Math.min((PANEL - pad * 2) / w, (PANEL - pad * 2) / h);
  const X = (x) => (pad + (x - minX) * k).toFixed(1);
  // Plan y runs up; SVG y runs down.
  const Y = (y) => (pad + (maxY - y) * k).toFixed(1);

  const walls = floor.walls
    .map(
      (wall) =>
        `<line x1="${X(wall.start.x)}" y1="${Y(wall.start.y)}" x2="${X(wall.end.x)}" y2="${Y(wall.end.y)}" stroke="#8b98a6" stroke-width="0.8"/>`,
    )
    .join('');

  const rooms = floor.rooms
    .map((room) => {
      const area = core.polygonArea(room.boundary) / SQFT;
      const pts = room.boundary.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ');
      const cx = room.boundary.reduce((s, p) => s + p.x, 0) / room.boundary.length;
      const cy = room.boundary.reduce((s, p) => s + p.y, 0) / room.boundary.length;
      const big = area > 120;
      const colour =
        room.use === 'stair' ? '#2f8f52' : room.use === 'lift' ? '#2f6f9f' : room.use === 'toilet' ? '#8f5f2f' : '#3b6ea5';
      return (
        `<polygon points="${pts}" fill="${colour}22" stroke="${colour}" stroke-width="1.4"/>` +
        `<text x="${X(cx)}" y="${Y(cy)}" text-anchor="middle" font-size="${big ? 12 : 9}" font-weight="700" fill="#101418">${escape(room.name)}</text>` +
        (big
          ? `<text x="${X(cx)}" y="${Number(Y(cy)) + 13}" text-anchor="middle" font-size="10" fill="#465361">${area.toFixed(0)} sq ft</text>`
          : '')
      );
    })
    .join('');

  const total = floor.rooms.reduce((s, r) => s + core.polygonArea(r.boundary), 0) / SQFT;
  const key = floor.name.toUpperCase().replace(/^FOURTH$/, '4TH');
  const says = stated.get(key);
  const compare = says
    ? `${total.toFixed(0)} sq ft &middot; drawing says ${says.toLocaleString()}`
    : `${total.toFixed(0)} sq ft`;

  return `<figure><figcaption><b>${escape(floor.name)}</b> &nbsp;<small>${floor.rooms.length} rooms &middot; ${compare}</small></figcaption>
    <svg width="${PANEL}" height="${PANEL}" viewBox="0 0 ${PANEL} ${PANEL}" style="background:#f7f6f3">${walls}${rooms}</svg></figure>`;
}

const escape = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const html = `<body style="margin:0;background:#0b0f14;color:#e8eef5;font:13px system-ui">
<div style="padding:10px 14px;font-size:15px">
  <b>${escape(file.split('/').pop())}</b> — ${result.floors.length} storeys imported.
  Room sizes are read from the dimensions written on the drawing; positions are the label positions.
</div>
<div style="display:flex;flex-wrap:wrap;gap:10px;padding:0 14px 14px">
${result.floors.map(panelFor).join('')}
</div>
<style>figure{margin:0}figcaption{padding:3px 2px}small{color:#9fb0c2}</style>
</body>`;

const tmp = `${out}.html`;
await writeFile(tmp, html);

app.whenReady().then(async () => {
  const rows = Math.ceil(result.floors.length / 4);
  const win = new BrowserWindow({ width: 1840, height: 120 + rows * (PANEL + 34), show: true });
  await win.loadFile(tmp);
  await new Promise((r) => setTimeout(r, 900));
  const image = await win.webContents.capturePage();
  await writeFile(out, image.toPNG());
  console.log(`wrote ${out}`);
  win.destroy();
  app.exit(0);
});
