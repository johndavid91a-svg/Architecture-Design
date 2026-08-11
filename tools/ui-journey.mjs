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
 * A design cannot travel with the floors: `RoomId`s are minted inside
 * `materialise()` in the RENDERER, so nothing written on disk can name one. The
 * design is therefore installed AFTER the building is created, through the app's
 * own AI Interior Designer channel — the harness answers `ai:call` with the
 * scheme's room design instead of calling a model. That is deliberately the
 * least privileged route available: every proposal still goes through
 * `validateInteriorProposal`, so the app's real clearance validator gets a veto
 * over the layout and a room that does not fit is rejected on screen.
 *
 * The channel is lossy in two known ways, both better said than discovered:
 * a proposal carries no `wallId`, so a finish meant for one wall installs
 * unrestricted and the feature wall loses its restriction; and the agent writes
 * room designs INTO the design that is already open, so the scheme's own design
 * name, label and rationale do not travel — the active design keeps the name it
 * had and its origin becomes `ai`.
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

/** Set a React-controlled field and let React hear about it. */
const SET_FIELD = `(function (id, value, eventName) {
  const node = document.getElementById(id);
  if (!node) return { ok: false, why: 'no field ' + id };
  const proto = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value);
  node.dispatchEvent(new Event(eventName, { bubbles: true }));
  return { ok: true };
})`;

/** The rooms the Design tab offers, in the order it offers them. */
const ROOM_OPTIONS = `(function () {
  const sel = document.getElementById('dv-room');
  if (!sel) return { ok: false, why: 'the Design tab has no room selector' };
  return { ok: true, options: [...sel.options].map((o) => ({ value: o.value, label: o.textContent.trim() })) };
})`;

/** The agent's transcript for the room just run. */
const TRANSCRIPT = `(function () {
  const lines = [...document.querySelectorAll('.card .small.mono')].map((n) => n.textContent.trim());
  return { ok: lines.some((l) => l.startsWith('Accepted')), lines };
})`;

/**
 * Name plus bounding box: enough to know which room a prompt is about.
 *
 * The prompt carries the room's id, but that id was minted in the renderer and
 * the harness has never seen it. The name is not unique on this floor (there are
 * two `M.H`), and the boundary is identical between two runs of `materialise`
 * over the same drawing — so the two together identify a room without the
 * harness having to assume the click order matched the answer order.
 */
const roomSignature = (name, points) => {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return (
    `${name}@${Math.round(Math.min(...xs))},${Math.round(Math.min(...ys))},` +
    `${Math.round(Math.max(...xs))},${Math.round(Math.max(...ys))}`
  );
};

/** One `RoomDesign` as the interior agent's response schema states it. */
const asProposal = (rd) => ({
  rationale: rd.rationale,
  finishes: rd.finishes.map((f) => ({
    surface: f.surface,
    materialId: f.materialId,
    heightLimitMm: f.heightLimit,
    note: f.note,
  })),
  ceiling: { kind: rd.ceiling.kind, materialId: rd.ceiling.materialId, dropHeightMm: rd.ceiling.dropHeight },
  lighting: rd.lighting.map((l) => ({
    kind: l.kind,
    count: l.count,
    wattsEach: l.wattsEach,
    colourTemperatureK: l.colourTemperatureK,
  })),
  furniture: rd.furniture.map((f) => ({
    catalogueKey: f.catalogueKey,
    label: f.label,
    x: f.position.x,
    y: f.position.y,
    rotationDeg: f.rotationDeg,
  })),
});

/**
 * Build the scheme's design and index it by room, ready to answer `ai:call`.
 *
 * `materialise` is run here as well as in the renderer, over the same floors, so
 * the design can be built against real rooms. The ids differ between the two
 * runs and are never used; the geometry does not, and that is what is matched on.
 */
async function schemeDesignByRoom(scheme) {
  const source = designPath ?? schemePath.replace(/-model\.mjs$/, '-design.mjs');
  const builder =
    scheme.basementDesign ??
    (await import(pathToFileURL(source).href).then(
      (m) => m.basementDesign ?? m.design ?? m.default,
      () => null,
    ));
  if (typeof builder !== 'function') return null;

  // The builder needs materialised rooms, so it needs the built core. Say which
  // build is missing rather than dying on a module-not-found stack: a harness
  // that fails for an obvious reason obscurely wastes more time than the run.
  const core = await import(
    pathToFileURL(join(here, '..', 'packages', 'core', 'dist', 'index.js')).href
  ).catch((error) => {
    step(`a design was found at ${source} but @adp/core is not built (run: npm run build:core)`, {
      ok: false,
      error: error.message,
    });
    return null;
  });
  if (!core) return null;
  const built = core.materialise(
    {
      name: 'Scheme',
      buildingType: 'commercial_plaza',
      location: { city: 'Islamabad', country: 'Pakistan', authority: 'CDA' },
      displayUnit: 'ft',
      // A scheme may be one storey or a whole stack. `floors()` is the general
      // form; `basementFloor()` is kept because the basement scheme predates it.
      floors: scheme.floors ? scheme.floors() : [scheme.basementFloor()],
    },
    new Date().toISOString(),
  );
  const floors = built.project.architecture.site.buildings.flatMap((b) => b.floors);
  const rooms = new Map(floors.flatMap((f) => f.rooms).map((r) => [r.id, r]));
  const unmatched = [];
  const design = builder(floors, {
    projectId: built.project.id,
    createdAt: new Date().toISOString(),
    onUnmatched: (names) => unmatched.push(...names),
  });

  const byRoom = new Map();
  for (const fd of design.floors) {
    for (const rd of fd.rooms) {
      const room = rooms.get(rd.roomId);
      if (!room) continue;
      // A QUEUE per signature, not a single entry.
      //
      // Every storey of this tower has a room called HALL with an IDENTICAL 2D
      // boundary — only the elevation differs, and a boundary is 2D. So the
      // signature collides four ways, and a Map keyed on it kept the last
      // design and served it for all four floors: the GIS floor, the imagery
      // floor and the data centre all came out as the executive floor, which
      // looked plausible and was completely wrong.
      //
      // The prompt the app sends carries the room's name and boundary and
      // nothing else that separates them — its RoomId was minted in the
      // renderer and this process has never seen it. What IS shared is ORDER:
      // both sides walk floors in the same sequence, so the Nth request for a
      // colliding signature is the Nth design for it.
      const key = roomSignature(room.name, room.boundary);
      const queue = byRoom.get(key);
      if (queue) queue.push({ name: room.name, proposal: asProposal(rd) });
      else byRoom.set(key, [{ name: room.name, proposal: asProposal(rd) }]);
    }
  }
  return { byRoom, unmatched, source: scheme.basementDesign ? schemePath : source, name: design.name };
}

let failures = 0;
const step = (label, result) => {
  const ok = result && result.ok !== false;
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok ? '' : ` — ${JSON.stringify(result).slice(0, 300)}`}`);
  return ok;
};

/** The scheme's design, indexed by room, and which rooms it was asked for. */
let schemeDesign = null;
const servedRooms = [];
const refusedRooms = [];

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

    schemeDesign = await schemeDesignByRoom(scheme);
    if (schemeDesign) {
      console.log(
        `        design "${schemeDesign.name}" from ${schemeDesign.source}: ` +
          `${schemeDesign.byRoom.size} room(s)` +
          (schemeDesign.unmatched.length > 0
            ? `, ${schemeDesign.unmatched.length} named space(s) with no room (${schemeDesign.unmatched.join(', ')})`
            : ''),
      );
      // The key is never read: the harness answers `ai:call` itself and no
      // request leaves this machine. Saying "Ready" is what un-disables the
      // button the design is installed through.
      ipcMain.handle('ai:status', async () => ({
        configured: true,
        keyLocation: 'not used — answered by tools/ui-journey.mjs',
        model: 'scheme-design (harness, not a model)',
      }));
      ipcMain.handle('ai:call', async (_event, request) => {
        const name = /ROOM: "([^"]+)"/.exec(request.user)?.[1];
        const boundary = /Boundary \(mm, plan coordinates\): (.+)/.exec(request.user)?.[1] ?? '';
        const points = [...boundary.matchAll(/\((-?[\d.]+), (-?[\d.]+)\)/g)].map((m) => ({
          x: Number(m[1]),
          y: Number(m[2]),
        }));
        // Take the next design for this signature. `shift()` is what makes the
        // Nth identical HALL get the Nth floor's design rather than the last.
        const queue = name && points.length > 0 ? schemeDesign.byRoom.get(roomSignature(name, points)) : null;
        const held = queue && queue.length > 0 ? queue.shift() : null;
        if (!held) {
          // Refusing beats guessing: answering with somebody else's room would
          // install a design that fits and is wrong.
          refusedRooms.push(name ?? '(unnamed)');
          return { ok: false, reason: 'no_design', detail: `The scheme holds no design for "${name}".` };
        }
        servedRooms.push(held.name);
        return {
          ok: true,
          text: JSON.stringify(held.proposal),
          model: 'tools/basement-design.mjs (harness, not a model)',
          stopReason: 'end_turn',
        };
      });
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
  if (!pdfPath) {
    const emptyText = await win.webContents.executeJavaScript(
      `(document.querySelector('.list-empty')?.textContent || '').trim()`,
    );
    step('it says plainly that no drawing is attached', {
      ok: /no drawing is attached/i.test(emptyText),
      saw: emptyText.slice(0, 120),
    });
  } else {
    const shown = await win.webContents.executeJavaScript(
      `(document.querySelector('.overlay.bl')?.textContent || '').trim()`,
    );
    console.log(`        ${shown.replace(/\s+/g, ' ').slice(0, 160)}`);
    step('it draws a sheet from the set', { ok: /line\(s\)/i.test(shown), saw: shown.slice(0, 120) });
  }

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
    step(
      'the design agent is offered a way to run',
      await run(SET_FIELD, 'dv-instr', `Install the agreed basement scheme, from ${schemeDesign.source}.`, 'input'),
    );
    const listed = await run(ROOM_OPTIONS);
    step(`the Design tab lists the building's rooms (${listed.options?.length ?? 0})`, listed);

    let installed = 0;
    for (const option of listed.options ?? []) {
      await run(SET_FIELD, 'dv-room', option.value, 'change');
      await wait(120);
      await run(CLICK, 'button', 'Run AI Interior Designer');
      await wait(500);
      const transcript = await run(TRANSCRIPT);
      // "Basement — GAMES FLOOR (WEST) (125 sq ft)" is the label; the area is
      // what has to come off, not everything after the first bracket.
      const room = option.label.replace(/^.*? — /, '').replace(/\s*\([\d,]+ sq ft\)$/, '');
      if (transcript.ok) {
        installed++;
      } else {
        // A room the scheme does not cover is a skip and says so. A room it does
        // cover but the app rejected is a failure, and the reason is on screen.
        if (refusedRooms.includes(room)) {
          console.log(`        skipped ${room} — the scheme holds no design for it`);
        } else {
          step(`the scheme's design for ${room} is accepted`, { ok: false, saw: transcript.lines.slice(-2) });
        }
      }
    }
    step(
      `the scheme's own design is installed (${installed} of ${schemeDesign.byRoom.size} room(s))`,
      { ok: installed === schemeDesign.byRoom.size, served: servedRooms.length, refused: refusedRooms },
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
