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

import { app, BrowserWindow } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, '..', 'packages', 'desktop');
// Electron puts its own flags and this script into argv, so the output
// directory is the last argument that is not one of those.
const passed = process.argv
  .slice(1)
  .filter((a) => !a.startsWith('-') && !a.endsWith('ui-journey.mjs'));
const outDir = resolve(passed[passed.length - 1] ?? join(here, '..', 'journey'));

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

async function main() {
  await mkdir(outDir, { recursive: true });

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
  step('the template screen offers a building', await run(CLICK, 'button', 'Create this building'));
  await wait(900);

  // ---- Drawings ----------------------------------------------------------
  step('the Drawings tab opens', await run(CLICK, 'nav button', 'Drawings'));
  await wait(600);
  await shot('drawings-empty');
  const emptyText = await win.webContents.executeJavaScript(
    `(document.querySelector('.list-empty')?.textContent || '').trim()`,
  );
  step('it says plainly that no drawing is attached', {
    ok: /no drawing is attached/i.test(emptyText),
    saw: emptyText.slice(0, 120),
  });

  // ---- 2D plan -----------------------------------------------------------
  step('the 2D Plan tab opens', await run(CLICK, 'nav button', '2D Plan'));
  await wait(700);
  await shot('plan-dark');

  step('the Paper contrast button is there', await run(CLICK, 'button', 'Paper'));
  await wait(500);
  await shot('plan-paper');

  step('back to dark', await run(CLICK, 'button', 'Dark'));
  await wait(400);

  // ---- 3D ----------------------------------------------------------------
  step('the 3D tab opens', await run(CLICK, 'nav button', '3D'));
  await wait(1500);
  await shot('model-orbit');

  const status = await win.webContents.executeJavaScript(
    `(document.querySelector('.overlay.bl')?.textContent || '')`,
  );
  console.log(`        status: ${status.trim().slice(0, 240)}`);
  step('the model reports its lifts and stairs', {
    ok: /lift shaft/i.test(status),
  });

  step('one floor at a time can be turned on', await run(CHECK, 'Only this floor', true));
  await wait(700);
  await shot('model-one-floor');

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
