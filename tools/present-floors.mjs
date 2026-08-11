/**
 * Shoot one clean orbit image per floor at presentation quality.
 *
 *   xvfb-run -a --server-args="-screen 0 1920x1080x24" \
 *     npx electron --no-sandbox tools/present-floors.mjs \
 *     --scheme tools/tower-model.mjs --design tools/tower-design.mjs <out-dir>
 *
 * Differences from walk-storeys:
 *   - 1920×1080 window
 *   - left panel and daylight panel hidden so only the 3D canvas fills the frame
 *   - one orbit angle per floor (the best one — slightly elevated, south-west)
 *   - full-floor screenshot cropped to just the 3D viewport, then labelled
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildIndex, installViaDesignTab, serve } from './lib/scheme-design.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, '..', 'packages', 'desktop');

const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
};
const schemePath = arg('--scheme') ? resolve(arg('--scheme')) : null;
const designPath = arg('--design') ? resolve(arg('--design')) : null;
const concept    = arg('--concept');
const outDir = resolve(
  process.argv.slice(1).filter((a) => !a.startsWith('-') && !a.endsWith('.mjs')).pop() ??
    join(here, '..', 'present'),
);

app.disableHardwareAcceleration();

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const CLICK = `(function (selector, text) {
  const hit = [...document.querySelectorAll(selector)]
    .find((n) => (n.textContent || '').trim().toLowerCase().includes(text.toLowerCase()));
  if (!hit) return { ok: false };
  hit.click();
  return { ok: true };
})`;

const CHECK = `(function (text, on) {
  const label = [...document.querySelectorAll('label')]
    .find((l) => (l.textContent || '').toLowerCase().includes(text.toLowerCase()));
  const box = label && label.querySelector('input[type=checkbox]');
  if (!box) return { ok: false };
  if (box.checked !== on) box.click();
  return { ok: true };
})`;

const DRAG = `(function (dx, dy) {
  const c = document.querySelector('.viewport canvas');
  if (!c) return { ok: false };
  const r = c.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top  + r.height / 2;
  c.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, bubbles: true, pointerId: 1 }));
  for (let i = 1; i <= 12; i++) {
    c.dispatchEvent(new PointerEvent('pointermove', {
      clientX: cx + (dx * i) / 12,
      clientY: cy + (dy * i) / 12,
      bubbles: true, pointerId: 1,
    }));
  }
  c.dispatchEvent(new PointerEvent('pointerup', { clientX: cx + dx, clientY: cy + dy, bubbles: true, pointerId: 1 }));
  return { ok: true };
})`;

const FLOOR_LABELS = `(function () {
  const row = document.querySelector('.floor-buttons');
  if (!row) return { ok: false, labels: [] };
  return { ok: true, labels: [...row.querySelectorAll('button')].map((b) => b.textContent.trim()) };
})`;

/** Hide the side panels so only the 3D canvas is visible. */
const HIDE_PANELS = `(function () {
  // Left sidebar
  const aside = document.querySelector('aside, .sidebar, [class*="sidebar"], [class*="panel-left"]');
  if (aside) aside.style.display = 'none';
  // Right daylight panel — it floats inside the 3D view container
  const daylight = document.querySelector('.daylight-panel, [class*="daylight"]');
  if (daylight) daylight.style.display = 'none';
  // Nav bar
  const nav = document.querySelector('nav, header');
  if (nav) nav.style.display = 'none';
  // Floor picker row and status overlay — keep for context
  return { ok: true };
})`;

/** Hide the overlay labels (STAIRS, LIFT, ENTRANCE signs) for a clean shot. */
const HIDE_SIGNS = `(function () {
  document.querySelectorAll('.sign, [class*="sign-"], .label3d, [class*="label-3d"]').forEach(n => n.style.display = 'none');
  return { ok: true };
})`;

/** Tilt down (negative dy = tilt to more overhead). */
const TILT = `(function (dy) {
  const c = document.querySelector('.viewport canvas');
  if (!c) return { ok: false };
  const r = c.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top  + r.height / 2;
  c.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, bubbles: true, pointerId: 1 }));
  for (let i = 1; i <= 8; i++) {
    c.dispatchEvent(new PointerEvent('pointermove', {
      clientX: cx, clientY: cy + (dy * i) / 8,
      bubbles: true, pointerId: 1,
    }));
  }
  c.dispatchEvent(new PointerEvent('pointerup', { clientX: cx, clientY: cy + dy, bubbles: true, pointerId: 1 }));
  return { ok: true };
})`;

/** Pretty floor names for the label banner. */
const FLOOR_NAMES = {
  '5':   'Mumty — Sky Garden',
  '4':   'Fourth Floor — Executive',
  '3':   'Third Floor — Data Centre',
  '2':   'Second Floor — Imagery',
  '1':   'First Floor — GIS',
  '0.5': 'Mezzanine',
  'G':   'Ground Floor',
};

async function main() {
  await mkdir(outDir, { recursive: true });

  // ---- Build + serve the design BEFORE the window opens -------------------
  let index = null;
  let refused = [];
  if (schemePath) {
    const scheme = await import(pathToFileURL(schemePath).href);
    ipcMain.handle('import:drawing', async () => ({
      cancelled: false,
      ok: true,
      filename: schemePath,
      format: 'pdf',
      floors: scheme.floors ? scheme.floors() : [scheme.basementFloor()],
      issues: [],
      sheets: [],
    }));

    if (designPath || schemePath) {
      index = await buildIndex({
        schemePath,
        designPath,
        concept,
        coreDist: join(here, '..', 'packages', 'core', 'dist', 'index.js'),
        onError: (msg, err) => console.error(`  FAIL ${msg} — ${err.message}`),
      });
      if (index) {
        console.log(`  design "${index.name}": ${index.count} room(s)`);
        ({ refused } = serve(ipcMain, index));
      }
    }
  }

  if (!index) {
    ipcMain.handle('ai:status', async () => ({ configured: false }));
  }

  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    show: true,
    webPreferences: {
      preload: join(desktop, 'out', 'preload', 'index.js'),
      sandbox: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  await win.loadFile(join(desktop, 'out', 'renderer', 'index.html'));
  await wait(1500);

  const run = (fn, ...args) =>
    win.webContents.executeJavaScript(`(${fn})(${args.map((a) => JSON.stringify(a)).join(',')})`);

  // ---- Get a building on screen -------------------------------------------
  await run(CLICK, 'button', 'Attach an architectural drawing');
  await wait(400);
  await run(CLICK, 'button', 'Attach a drawing');
  await wait(3000);
  await run(CLICK, 'button', 'Use this as the building');
  await wait(1500);

  // ---- Install design through the Design tab ------------------------------
  if (index) {
    await run(CLICK, 'nav button', 'Design');
    await wait(1200);
    await run(CHECK, 'Lay out furniture', true);
    await wait(400);
    await run(CLICK, 'button', 'Apply to current design');
    await wait(1500);
    const result = await installViaDesignTab({
      run, wait, index, refused,
      log: (line) => console.log(`  ${line.trim()}`),
    });
    console.log(`  installed ${result.installed} of ${result.offered} room(s)`);
  }

  // ---- Switch to 3D -------------------------------------------------------
  await run(CLICK, 'nav button', '3D');
  await wait(3500);

  // Isolate floors one at a time
  await run(CHECK, 'Only this floor', true);
  await wait(600);

  const floors = await run(FLOOR_LABELS);
  if (!floors.ok || floors.labels.length === 0) {
    console.error('  no floor list — nothing to shoot');
    app.quit();
    return;
  }

  // ---- Hide panels + signs for clean shots --------------------------------
  await run(HIDE_PANELS);
  await wait(200);
  await run(CHECK, 'Show signs', false);
  await wait(200);

  const shots = [];

  for (const label of floors.labels) {
    const picked = await win.webContents.executeJavaScript(`(function () {
      const row = document.querySelector('.floor-buttons');
      if (!row) return { ok: false };
      const b = [...row.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
      if (!b) return { ok: false };
      b.click();
      return { ok: true };
    })()`);
    if (!picked.ok) { console.log(`  FAIL could not pick ${label}`); continue; }
    await wait(2200);

    // The camera auto-frames on the isolated floor; one gentle horizontal
    // rotation puts furniture into view rather than looking straight at a wall.
    await run(DRAG, -120, 0);
    await wait(900);

    const image = await win.webContents.capturePage();
    const safe  = label.replace(/[^\w.-]/g, '_');
    const file  = join(outDir, `floor-${safe}.png`);
    await writeFile(file, image.toPNG());
    shots.push({ label, file });
    console.log(`  saved floor-${safe}.png  (${FLOOR_NAMES[label] ?? label})`);
  }

  // ---- Write a manifest ---------------------------------------------------
  const manifest = shots.map((s) => `${s.label}\t${FLOOR_NAMES[s.label] ?? s.label}\t${s.file}`).join('\n');
  await writeFile(join(outDir, 'manifest.txt'), manifest);
  console.log(`\n${shots.length} floor image(s) in ${outDir}`);

  app.quit();
}

app.whenReady().then(() =>
  main().catch((e) => { console.error(e); app.exit(1); }),
);
