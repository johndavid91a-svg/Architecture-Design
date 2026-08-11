/**
 * Walk every storey of a building and photograph it.
 *
 *   xvfb-run -a npx electron tools/walk-storeys.mjs \
 *     --scheme tools/tower-model.mjs --design tools/tower-design.mjs <out-dir>
 *
 * WHY THIS EXISTS SEPARATELY. Every judgement about how this building looks came
 * from one orbit view of the whole stack, and that is the view that hides
 * everything: at that distance a floor with no internal walls, a camera pointing
 * at nothing, and a room finished correctly all look identical. Two defects had
 * been sitting in the model through every screenshot taken of it — the mumty had
 * no partitions at all, and isolating a storey never moved the camera, so
 * picking a floor showed you whatever happened to be in front of the lens.
 *
 * It was a flag on `ui-journey.mjs` first, which was wrong: that harness spends
 * seven minutes proving the 2D plan, the design tab and the lift work before it
 * gets anywhere near a photograph. Inspecting a building is its own job and
 * should cost what it costs and nothing more.
 *
 * IT PHOTOGRAPHS ARCHITECTURE, NOT DESIGN. Installing a design means driving the
 * app's designer channel, which `ui-journey.mjs` does; until that is shared
 * between them, passing --design here is refused rather than ignored.
 *
 * WHAT IT DOES. For each storey, in order: isolate it, orbit it through several
 * bearings, then stand inside it at the stair and at the entrance. Everything it
 * drives is a real control in the real renderer — it clicks the same buttons a
 * person clicks, so what it photographs is what ships.
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, '..', 'packages', 'desktop');

const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
};
const schemePath = arg('--scheme') ? resolve(arg('--scheme')) : null;
const designPath = arg('--design') ? resolve(arg('--design')) : null;
/** How many bearings to orbit each storey through. */
const ANGLES = Number(arg('--angles') ?? 3);
const outDir = resolve(
  process.argv.slice(1).filter((a) => !a.startsWith('-') && !a.endsWith('.mjs')).pop() ??
    join(here, '..', 'walk'),
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

/** Drag the 3D canvas, which is how a person turns the model. */
const DRAG = `(function (dx) {
  const c = document.querySelector('.viewport canvas');
  if (!c) return { ok: false };
  const r = c.getBoundingClientRect();
  const y = r.top + r.height / 2;
  const from = r.left + r.width / 2;
  c.dispatchEvent(new PointerEvent('pointerdown', { clientX: from, clientY: y, bubbles: true, pointerId: 1 }));
  for (let i = 1; i <= 8; i++) {
    c.dispatchEvent(new PointerEvent('pointermove', {
      clientX: from + (dx * i) / 8, clientY: y, bubbles: true, pointerId: 1,
    }));
  }
  c.dispatchEvent(new PointerEvent('pointerup', { clientX: from + dx, clientY: y, bubbles: true, pointerId: 1 }));
  return { ok: true };
})`;

const FLOOR_LABELS = `(function () {
  const row = document.querySelector('.floor-buttons');
  if (!row) return { ok: false, labels: [] };
  return { ok: true, labels: [...row.querySelectorAll('button')].map((b) => b.textContent.trim()) };
})`;

const STATUS = `((document.querySelector('.overlay.bl') || {}).textContent || '')`;

async function main() {
  await mkdir(outDir, { recursive: true });

  // The scheme is answered on the app's own import channel, so the building is
  // created by the code that creates every other building — validation,
  // materialise and all.
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
  }
  ipcMain.handle('ai:status', async () => ({ configured: false }));

  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    // Shown, not hidden. A hidden window does not composite, so `capturePage`
    // hands back whatever frame was painted last — a full set of screenshots of
    // the previous screen, every one of them plausible and every one a lie.
    show: true,
    webPreferences: {
      preload: join(desktop, 'out', 'preload', 'index.js'),
      sandbox: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  // The renderer bundle lives under the DESKTOP package, not the repo root.
  await win.loadFile(join(desktop, 'out', 'renderer', 'index.html'));
  await wait(1500);

  const run = (fn, ...args) =>
    win.webContents.executeJavaScript(`(${fn})(${args.map((a) => JSON.stringify(a)).join(',')})`);

  const shots = [];
  const shot = async (name, caption) => {
    const image = await win.webContents.capturePage();
    await writeFile(join(outDir, `${name}.png`), image.toPNG());
    shots.push({ name, caption });
    console.log(`  saved ${name}.png`);
  };

  // ---- Get a building on screen -------------------------------------------
  await run(CLICK, 'button', 'Attach an architectural drawing');
  await wait(500);
  await run(CLICK, 'button', 'Attach a drawing');
  await wait(3000);
  await run(CLICK, 'button', 'Use this as the building');
  await wait(1500);

  if (designPath) {
    // REFUSE, do not pretend.
    //
    // This tool accepted --design and then did nothing with it, so the first
    // full run photographed seven storeys of bare architecture while the status
    // line read "0 furniture item(s)" and every caption claimed a design was
    // loaded. A flag that is accepted and ignored is worse than one that does
    // not exist: it produces a plausible, complete, wrong answer.
    //
    // Installing a design means driving the app's designer channel, which
    // ui-journey.mjs already does. Until that is shared between the two, this
    // says so and stops.
    console.error(
      '\n  --design is not implemented here yet.\n' +
        '  A design is installed through the app\'s designer channel, which\n' +
        '  tools/ui-journey.mjs drives. Use that with --inspect for a designed\n' +
        '  building, or drop --design to photograph the architecture alone.\n',
    );
    app.exit(2);
    return;
  }

  await run(CLICK, 'nav button', '3D');
  await wait(4000);

  const status = (await win.webContents.executeJavaScript(STATUS)).trim();
  console.log(`  ${status.slice(0, 160)}`);

  await shot('00-whole-building', `The stack. ${status.slice(0, 120)}`);

  // ---- Every storey, one at a time ----------------------------------------
  const floors = await run(FLOOR_LABELS);
  if (!floors.ok || floors.labels.length === 0) {
    console.log('  no floor list — nothing to walk');
    app.quit();
    return;
  }
  await run(CHECK, 'Only this floor', true);
  await wait(600);

  for (const label of floors.labels) {
    const picked = await win.webContents.executeJavaScript(`(function () {
      const row = document.querySelector('.floor-buttons');
      const b = [...row.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
      if (!b) return { ok: false };
      b.click();
      return { ok: true, name: (document.querySelector('.floor-buttons') || {}).nextElementSibling?.textContent || '' };
    })()`);
    if (!picked.ok) {
      console.log(`  FAIL could not select floor ${label}`);
      continue;
    }
    await wait(1500);
    const safe = label.replace(/[^\w.-]/g, '_');

    for (let a = 0; a < ANGLES; a++) {
      if (a > 0) {
        await run(DRAG, Math.round(340 / ANGLES) * 2);
        await wait(900);
      }
      await shot(`floor-${safe}-orbit-${a + 1}`, `Floor ${label}, bearing ${a + 1} of ${ANGLES}.`);
    }

    // And from inside, at the two places a person actually arrives.
    for (const [button, tag] of [
      ['Go to stairs', 'at-the-stair'],
      ['Go to entrance', 'at-the-entrance'],
    ]) {
      const went = await run(CLICK, 'button', button);
      if (!went.ok) continue;
      await wait(1500);
      await shot(`floor-${safe}-${tag}`, `Floor ${label}, standing ${tag.replace(/-/g, ' ')}.`);
      await run(CLICK, 'button', 'Orbit');
      await wait(600);
    }
  }

  // ---- An index, so the set can be read rather than guessed at ------------
  const index =
    `# Storey walk\n\n${status}\n\n` +
    `${shots.length} photograph(s), ${floors.labels.length} storey(s), ${ANGLES} bearing(s) each.\n\n` +
    shots.map((s) => `- **${s.name}** — ${s.caption}`).join('\n') +
    `\n\nEvery control driven here is a real control in the real renderer.\n`;
  await writeFile(join(outDir, 'index.md'), index);

  console.log(`\n${shots.length} photograph(s) in ${outDir}`);
  app.quit();
}

app.whenReady().then(() =>
  main().catch((e) => {
    console.error(e);
    app.exit(1);
  }),
);
