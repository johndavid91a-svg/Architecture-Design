/**
 * Drive the built app through the screens a user actually looks at, and save a
 * picture of each one.
 *
 * A change to a view is not finished when it type-checks. The complaints this
 * harness exists to answer — "the contrast is not good", "I can't see the
 * entrance", "I can't see the stairs" — are all things you can only settle by
 * looking at the rendered pixels. So it renders them.
 *
 *   xvfb-run -a npx electron tools/ui-journey.mjs <output-directory>
 *
 * It runs the real preload and the real renderer bundle out of `out/`, so what
 * it photographs is what ships.
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { buildIndex, installViaDesignTab, serve } from './lib/scheme-design.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, '..', 'packages', 'desktop');
// Electron puts its own flags and this script into argv, so the output
// directory is the last argument that is not one of those.
const passed = process.argv
  .slice(1)
  .filter((a) => !a.startsWith('-') && !a.endsWith('ui-journey.mjs'));
const outDir = resolve(passed[passed.length - 1] ?? join(here, '..', 'journey'));

/**
 * A real drawing to import, instead of the built-in template.
 *
 *   … tools/ui-journey.mjs --pdf /path/to/set.pdf <out-dir>
 *
 * The file picker is the one thing a harness cannot drive, so the three import
 * channels are answered here with this file. Everything behind them — the same
 * `importDrawingFile` the app's own main process calls — runs for real, which is
 * the point: the interesting failures are in reading the drawing, not in the
 * dialog that chose it.
 */
const pdfFlag = process.argv.indexOf('--pdf');
const pdfPath = pdfFlag >= 0 ? resolve(process.argv[pdfFlag + 1]) : null;

/**
 * A hand-built scheme to import instead of a file.
 *
 *   … tools/ui-journey.mjs --scheme <module.mjs> <out-dir>
 *
 * The module exports floors in the same `CandidateFloor` shape a drawing
 * importer produces, so a proposal goes through the app's own validation and
 * materialise rather than a side door that would let it be wrong in ways a real
 * import could not be.
 */
const schemeFlag = process.argv.indexOf('--scheme');
const schemePath = schemeFlag >= 0 ? resolve(process.argv[schemeFlag + 1]) : null;

/**
 * The scheme's own design, installed over the building once it exists.
 *
 *   … tools/ui-journey.mjs --scheme <model.mjs> [--design <design.mjs>] <out-dir>
 *
 * Taken from the scheme module itself if it exports `basementDesign`, otherwise
 * from the sibling the naming convention implies — `basement-model.mjs` next to
 * `basement-design.mjs` — or from an explicit `--design`. Without one, the
 * journey behaves exactly as it did before.
 *
 * How it is installed, and why it cannot simply be handed over, is in
 * `lib/scheme-design.mjs` — which is where the machinery now lives, because
 * `walk-storeys.mjs` needs the same thing and had a `--design` flag it ignored.
 */
const designFlag = process.argv.indexOf('--design');
const designPath = designFlag >= 0 ? resolve(process.argv[designFlag + 1]) : null;

app.disableHardwareAcceleration();

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Click the first element whose visible text matches, and say whether it did. */
const CLICK = `(function (selector, text) {
  const nodes = [...document.querySelectorAll(selector)];
  const hit = nodes.find((n) => (n.textContent || '').trim().toLowerCase().includes(text.toLowerCase()));
  if (!hit) return { ok: false, saw: nodes.map((n) => (n.textContent || '').trim()).slice(0, 40) };
  hit.click();
  return { ok: true };
})`;

/** Tick or untick the checkbox whose label contains this text. */
const CHECK = `(function (text, on) {
  const label = [...document.querySelectorAll('label')].find((l) =>
    (l.textContent || '').toLowerCase().includes(text.toLowerCase()),
  );
  if (!label) return { ok: false };
  const box = label.querySelector('input[type=checkbox]');
  if (!box) return { ok: false };
  if (box.checked !== on) box.click();
  return { ok: true, checked: box.checked };
})`;

let failures = 0;
const step = (label, result) => {
  const ok = result && result.ok !== false;
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok ? '' : ` — ${JSON.stringify(result).slice(0, 300)}`}`);
  return ok;
};

/** The scheme's design, indexed by room, and which rooms it was asked for. */
let schemeDesign = null;
let servedRooms = [];
let refusedRooms = [];

async function main() {
  await mkdir(outDir, { recursive: true });

  if (schemePath) {
    const scheme = await import(pathToFileURL(schemePath).href);
    ipcMain.handle('import:drawing', async () => ({
      cancelled: false,
      ok: true,
      filename: schemePath,
      format: 'pdf',
      // A scheme may be one storey or a whole stack. `floors()` is the general
      // form; `basementFloor()` is kept because the basement scheme predates it.
      floors: scheme.floors ? scheme.floors() : [scheme.basementFloor()],
      units: { unit: 'mm', source: 'file_header', confident: true, note: 'Scheme drawn to the architect’s dimensions.' },
      issues: [],
      stats: null,
    }));
    ipcMain.handle('import:drawingSheets', async () => []);
    ipcMain.handle('import:drawingSheet', async () => ({ error: 'no sheets' }));

    schemeDesign = await buildIndex({
      schemePath,
      designPath,
      coreDist: join(here, '..', 'packages', 'core', 'dist', 'index.js'),
      onError: (message, error) => step(message, { ok: false, error: error.message }),
    });
    if (schemeDesign) {
      console.log(
        `        design "${schemeDesign.name}" from ${schemeDesign.source}: ` +
          `${schemeDesign.count} room(s)` +
          (schemeDesign.unmatched.length > 0
            ? `, ${schemeDesign.unmatched.length} named space(s) with no room (${schemeDesign.unmatched.join(', ')})`
            : ''),
      );
      const channel = serve(ipcMain, schemeDesign);
      servedRooms = channel.served;
      refusedRooms = channel.refused;
    }
  } else if (pdfPath) {
    const drawing = await import(
      pathToFileURL(join(desktop, 'dist-test', 'drawing-import.js')).href
    );
    ipcMain.handle('import:drawing', async () => {
      const payload = await drawing.importDrawingFile(pdfPath);
      return { cancelled: false, ...payload };
    });
    ipcMain.handle('import:drawingSheets', async (_e, path) => drawing.listDrawingSheets(path));
    ipcMain.handle('import:drawingSheet', async (_e, path, page) =>
      drawing.readDrawingSheet(path, page),
    );
  }

  // The window is SHOWN, and throttling is off.
  //
  // A hidden window does not composite, so `capturePage` hands back whatever
  // frame was last painted — which silently produced a set of screenshots of the
  // previous screen, all of them plausible and every one a lie. Under Xvfb
  // showing the window costs nothing.
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    show: true,
    webPreferences: {
      preload: join(desktop, 'out', 'preload', 'index.js'),
      sandbox: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });

  const errors = [];
  // Under Xvfb there is no GPU, so Chromium falls back to software WebGL and
  // logs about it on every readback. That is the harness's environment talking,
  // not the app, and counting it as a failure would make the check useless.
  const environmentNoise =
    /swiftshader|software WebGL|GPU stall|GroupMarkerNotSet|Failed to connect to the bus/i;
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2 && !environmentNoise.test(message)) errors.push(message);
  });

  await win.loadFile(join(desktop, 'out', 'renderer', 'index.html'));
  await wait(1200);

  const run = (fn, ...args) =>
    win.webContents.executeJavaScript(`(${fn})(${args.map((a) => JSON.stringify(a)).join(',')})`);

  const shot = async (name) => {
    const image = await win.webContents.capturePage();
    await writeFile(join(outDir, `${name}.png`), image.toPNG());
    console.log(`        saved ${name}.png`);
  };

  // ---- Build a building --------------------------------------------------
  const importing = pdfPath || schemePath;
  if (importing) {
    // The setup screen asks how to start before it offers the file picker.
    step('the setup screen offers to attach a drawing', await run(CLICK, 'button', 'Attach an architectural drawing'));
    await wait(600);
    step('the file picker is offered', await run(CLICK, 'button', 'Attach a drawing'));
    // A 56-sheet set takes about ten seconds to read.
    await wait(schemePath ? 2500 : 30_000);
    const read = await win.webContents.executeJavaScript(
      `(document.querySelector('.card')?.textContent || '').trim()`,
    );
    console.log(`        ${read.replace(/\s+/g, ' ').slice(0, 150)}`);
    await shot('import-review');
    step('it uses the drawing as the building', await run(CLICK, 'button', 'Use this as the building'));
    await wait(2500);
  } else {
    step('the template screen offers a building', await run(CLICK, 'button', 'Create this building'));
    await wait(900);
  }

  // ---- Drawings ----------------------------------------------------------
  step('the Drawings tab opens', await run(CLICK, 'nav button', 'Drawings'));
  await wait(pdfPath ? 25_000 : 600);
  await shot(pdfPath ? 'drawings-sheet' : 'drawings-empty');
  if (!pdfPath && !schemePath) {
    // Only when nothing was imported. A scheme run has a drawing attached by
    // this point — it is what built the building three steps ago — so asking
    // for the empty state here failed every scheme run for a reason that had
    // nothing to do with what the run was checking.
    const emptyText = await win.webContents.executeJavaScript(
      `(document.querySelector('.list-empty')?.textContent || '').trim()`,
    );
    step('it says plainly that no drawing is attached', {
      ok: /no drawing is attached/i.test(emptyText),
      saw: emptyText.slice(0, 120),
    });
  } else if (pdfPath) {
    const shown = await win.webContents.executeJavaScript(
      `(document.querySelector('.overlay.bl')?.textContent || '').trim()`,
    );
    console.log(`        ${shown.replace(/\s+/g, ' ').slice(0, 160)}`);
    step('it draws a sheet from the set', { ok: /line\(s\)/i.test(shown), saw: shown.slice(0, 120) });
  }
  // A scheme has floors but no sheets — there is no PDF behind it to draw — so
  // there is nothing to assert on this tab either way.

  // ---- 2D plan -----------------------------------------------------------
  step('the 2D Plan tab opens', await run(CLICK, 'nav button', '2D Plan'));
  await wait(importing ? 3000 : 700);
  await shot('plan-dark');

  step('the Paper contrast button is there', await run(CLICK, 'button', 'Paper'));
  await wait(500);
  await shot('plan-paper');

  step('back to dark', await run(CLICK, 'button', 'Dark'));
  await wait(400);

  // ---- Dress the building ------------------------------------------------
  // Without this the walkthrough is checked bare: no finishes, no furniture,
  // every surface on its fallback colour. That is the one state the 3D view is
  // NOT meant to be judged in, and checking only that state is how the furniture
  // and the materials went unlooked-at.
  step('the Design tab opens', await run(CLICK, 'nav button', 'Design'));
  await wait(600);
  step('furniture is laid out with the theme', await run(CHECK, 'Lay out furniture', true));
  step('a theme can be applied to the building', await run(CLICK, 'button', 'Apply to current design'));
  await wait(importing ? 4000 : 1200);
  await shot('design-applied');

  // ---- The scheme's own design -------------------------------------------
  //
  // AFTER the theme, not instead of it. The theme step above is what the app
  // does for a building nobody has designed, and it stays in the journey — but
  // it stamps a generic office scheme over every room, which is exactly the
  // complaint this run exists to answer. The scheme's design goes on top, room
  // by room, so the last thing the 3D tab sees is the design the building was
  // actually drawn for.
  if (schemeDesign) {
    const result = await installViaDesignTab({
      run,
      wait,
      index: schemeDesign,
      refused: refusedRooms,
      // A room the scheme does not cover is a skip and says so. A room it does
      // cover but the app rejected is a failure of this journey, so it goes
      // through `step` and counts against the run.
      log: (line) =>
        /^\s*REJECTED /.test(line)
          ? step(line.trim(), { ok: false })
          : console.log(`      ${line.trim()}`),
    });
    step(`the Design tab lists the building's rooms (${result.offered})`, { ok: result.offered > 0 });
    step(
      `the scheme's own design is installed (${result.installed} of ${schemeDesign.count} room(s))`,
      { ok: result.installed === schemeDesign.count, served: servedRooms.length, refused: refusedRooms },
    );
    await wait(400);
    await shot('design-scheme');
  }

  // ---- 3D ----------------------------------------------------------------
  step('the 3D tab opens', await run(CLICK, 'nav button', '3D'));
  // A nine-storey import is 3,000-odd walls to extrude, and under software
  // rendering the first painted frame lags the DOM by seconds. Screenshotting
  // too early captures the previous tab, which looks like a working screenshot.
  await wait(importing ? 9000 : 1500);
  await shot('model-orbit');

  const status = await win.webContents.executeJavaScript(
    `(document.querySelector('.overlay.bl')?.textContent || '')`,
  );
  console.log(`        status: ${status.trim().slice(0, 240)}`);
  step('the model reports its lifts and stairs', {
    ok: /lift shaft/i.test(status),
  });

  // ---- A close look ------------------------------------------------------
  // The wide orbit shot is where a rendering problem hides: at that distance a
  // tiled floor, a flat colour and a blown-out white all look the same. Zooming
  // in is what showed the furniture reading as crates and the interiors clipping
  // to white, neither of which was visible from the default framing.
  const zoomed = await win.webContents.executeJavaScript(`(function () {
    const canvas = document.querySelector('.viewport canvas');
    if (!canvas) return { ok: false };
    const r = canvas.getBoundingClientRect();
    for (let i = 0; i < 22; i++) {
      canvas.dispatchEvent(new WheelEvent('wheel', {
        deltaY: -60, bubbles: true, cancelable: true,
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
      }));
    }
    return { ok: true };
  })()`);
  step('the model can be zoomed into', zoomed);
  await wait(900);
  await shot('model-close');

  step('one floor at a time can be turned on', await run(CHECK, 'Only this floor', true));
  await wait(importing ? 3000 : 700);
  await shot('model-one-floor');

  // ---- Inspect every storey ----------------------------------------------
  //
  //   … tools/ui-journey.mjs --inspect <out-dir>
  //
  // Every judgement about how this building looks has so far come from one
  // orbit view of the whole stack, which is the view that hides everything: at
  // that distance a room with the wrong floor, a chair through a desk and a
  // light that never fires all look identical. This isolates each storey in
  // turn and photographs it from above and from inside, so there is a picture
  // of every floor to actually look at.
  if (process.argv.includes('--inspect')) {
    const buttons = await win.webContents.executeJavaScript(`(function () {
      const row = document.querySelector('.floor-buttons');
      if (!row) return { ok: false, why: 'no floor buttons' };
      return { ok: true, labels: [...row.querySelectorAll('button')].map((b) => b.textContent.trim()) };
    })()`);
    step('the floor list is readable', buttons);
    for (const label of buttons.labels ?? []) {
      // Interpolate the label directly. The first version built the comparison
      // with a placeholder and then tried to `.replace()` it — matching single
      // quotes against a string JSON.stringify had written with double ones, so
      // the swap never happened, every button compared against the literal word
      // and not one floor was photographed. The loop still reported success,
      // because it only counted the labels it had READ.
      const picked = await win.webContents.executeJavaScript(`(function () {
        const row = document.querySelector('.floor-buttons');
        if (!row) return { ok: false };
        const b = [...row.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
        if (!b) return { ok: false, saw: [...row.querySelectorAll('button')].map((x) => x.textContent.trim()) };
        b.click();
        return { ok: true };
      })()`);
      step(`floor ${label} selected`, picked);
      if (!picked.ok) continue;
      await wait(1600);
      const name = label.replace(/[^\w.-]/g, '_');
      await shot(`floor-${name}-plan`);
      // And from inside it, standing at the stair.
      await run(CLICK, 'button', 'Go to stairs');
      await wait(1400);
      await shot(`floor-${name}-inside`);
      await run(CLICK, 'button', 'Orbit');
      await wait(600);
    }
    step('every storey was photographed', { ok: (buttons.labels ?? []).length > 0 });
  }

  step('and turned off again', await run(CHECK, 'Only this floor', false));
  await wait(500);

  step('signs can be turned off', await run(CHECK, 'Show signs', false));
  await wait(500);
  await shot('model-no-signs');
  step('and back on', await run(CHECK, 'Show signs', true));
  await wait(500);

  step('there is a way to the entrance', await run(CLICK, 'button', 'Go to entrance'));
  await wait(1600);
  // The button only means anything if it also put you in walk mode. Checking the
  // pixels alone would pass on an orbit view that merely looks plausible.
  const inWalk = await win.webContents.executeJavaScript(`(function () {
    const walk = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Walk');
    return { ok: Boolean(walk && walk.className.includes('primary')), className: walk && walk.className };
  })()`);
  step('and it puts you in the building, walking', inWalk);
  await shot('walk-entrance');

  // ---- Ride the lift -----------------------------------------------------
  // Stand in the car, note the floor, press E, wait out the doors and the
  // travel, and check the floor CHANGED. Pressing E somewhere that is not a lift
  // and calling that a pass is how a broken lift ships.
  const floorName = () =>
    win.webContents.executeJavaScript(
      `(document.querySelector('.overlay.tl .small.muted')?.textContent || '').trim()`,
    );

  // Walk into a wall on purpose. The old resolver pushed out of every wall in
  // turn, so a walker in a corner ended the frame wedged inside geometry with no
  // way out — the commonest complaint about the walkthrough.
  step('walls can be walked through when the geometry traps you', await run(CHECK, 'Walk through walls', true));
  await wait(400);
  step('and made solid again', await run(CHECK, 'Walk through walls', false));
  await wait(400);

  step('there is a way to the stairs', await run(CLICK, 'button', 'Go to stairs'));
  await wait(1200);
  await shot('walk-in-stairs');

  step('there is a way to the lift', await run(CLICK, 'button', 'Go to lift'));
  await wait(1200);
  await shot('walk-in-lift');
  const before = await floorName();
  console.log(`        standing on: ${before}`);

  await win.webContents.executeJavaScript(
    `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }))`,
  );
  await wait(900);
  const during = await win.webContents.executeJavaScript(
    `(document.querySelector('.transport-prompt')?.textContent || '').trim()`,
  );
  console.log(`        mid-ride: ${during || '(nothing)'}`);
  step('the lift says what it is doing', { ok: during.length > 0 });
  await shot('walk-lift-moving');

  // Long enough for doors, travel and doors again: a 5.5 m storey at 1.2 m/s is
  // most of five seconds on its own.
  await wait(9000);
  const after = await floorName();
  console.log(`        arrived on: ${after}`);
  step('the lift actually took you to another floor', { ok: after !== before && after.length > 0 });
  await shot('walk-lift-arrived');

  if (errors.length > 0) {
    failures += errors.length;
    console.log(`\n${errors.length} console error(s):`);
    for (const e of errors.slice(0, 10)) console.log(`   ${e}`);
  }

  console.log(`\n${failures === 0 ? 'Journey complete, no failures.' : `${failures} failure(s).`}`);
  console.log(`Screens in ${outDir}\n`);
  win.destroy();
  app.exit(failures === 0 ? 0 : 1);
}

app.whenReady().then(() =>
  main().catch((error) => {
    console.error(error);
    app.exit(1);
  }),
);
