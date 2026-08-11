/**
 * Install a scheme's own design over a building the app has just created.
 *
 * Shared because two harnesses need it and only one had it. `walk-storeys.mjs`
 * accepted a `--design` flag and did nothing with it — it photographed seven
 * storeys of bare architecture while printing the design path as though it had
 * loaded it. The machinery lived in `ui-journey.mjs` and nowhere else, so the
 * good tool was looking at the wrong building.
 *
 * WHY A DESIGN CANNOT SIMPLY BE HANDED OVER. `RoomId`s are minted inside
 * `materialise()` in the RENDERER, from `crypto.randomUUID()`. Nothing written
 * on disk can name one. So the design is installed AFTER the building exists,
 * through the app's own AI Interior Designer channel: the harness answers
 * `ai:call` with the scheme's room design instead of calling a model.
 *
 * That route is chosen deliberately, and it is the least privileged one
 * available. Every proposal still goes through `validateInteriorProposal`, so
 * the app's real clearance validator keeps its veto and a room that does not fit
 * is rejected on screen rather than quietly installed.
 *
 * IT IS LOSSY IN TWO KNOWN WAYS, both better said than discovered:
 *   - a proposal carries no `wallId`, so a finish meant for one wall installs
 *     unrestricted and a feature wall loses its restriction;
 *   - the agent writes room designs INTO the design already open, so the
 *     scheme's own name, label and rationale do not travel.
 */

import { pathToFileURL } from 'node:url';

/**
 * Name plus bounding box: enough to know which room a prompt is about.
 *
 * The prompt carries the room's id, but that id was minted in the renderer and
 * this process has never seen it.
 */
export const roomSignature = (name, points) => {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return (
    `${name}@${Math.round(Math.min(...xs))},${Math.round(Math.min(...ys))},` +
    `${Math.round(Math.max(...xs))},${Math.round(Math.max(...ys))}`
  );
};

/** One `RoomDesign` as the interior agent's response schema states it. */
export const asProposal = (rd) => ({
  rationale: rd.rationale,
  finishes: rd.finishes.map((f) => ({
    surface: f.surface,
    materialId: f.materialId,
    heightLimitMm: f.heightLimit,
    note: f.note,
  })),
  ceiling: {
    kind: rd.ceiling.kind,
    materialId: rd.ceiling.materialId,
    dropHeightMm: rd.ceiling.dropHeight,
  },
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
 * Build the scheme's design and index it by room signature.
 *
 * Returns null when there is no design to install, so a caller can carry on
 * photographing the architecture instead of failing.
 */
export async function buildIndex({ schemePath, designPath, coreDist, concept, onError }) {
  if (!schemePath) return null;
  const scheme = await import(pathToFileURL(schemePath).href);
  const source = designPath ?? schemePath.replace(/-model\.mjs$/, '-design.mjs');
  let builder = scheme.basementDesign ?? scheme.towerDesign;
  if (typeof builder !== 'function' && source !== schemePath) {
    const mod = await import(pathToFileURL(source).href).catch(() => null);
    builder = mod?.basementDesign ?? mod?.towerDesign ?? mod?.design ?? mod?.default ?? null;
  }
  if (typeof builder !== 'function') return null;

  // Say which build is missing rather than dying on a module-not-found stack: a
  // harness that fails for an obvious reason obscurely wastes more time than the
  // run it was going to save.
  const core = await import(pathToFileURL(coreDist).href).catch((error) => {
    onError?.(`a design was found at ${source} but @adp/core is not built (run: npm run build:core)`, error);
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
    ...(concept ? { concept } : {}),
    onUnmatched: (names) => unmatched.push(...names),
  });

  // `floors[].rooms[]` is the shape `Design` declares and the only one every
  // design module has; a flat `rooms` is an extra some of them offer. Walking
  // the declared shape means one code path for both, and it walks the floors in
  // the order the design states them, which is what the queue below relies on.
  const roomDesigns =
    design.floors?.flatMap((f) => f.rooms ?? []) ?? design.rooms ?? [];

  // A QUEUE per signature, not a single entry. Every storey of a tower has a
  // room called HALL with an identical 2D boundary — only the elevation differs
  // and a boundary is 2D — so the signature collides once per floor. A Map keyed
  // on it keeps the last design and serves it for every floor, which looks
  // entirely plausible and is completely wrong. Both sides walk floors in the
  // same order, so the Nth request takes the Nth design.
  const byRoom = new Map();
  let count = 0;
  for (const rd of roomDesigns) {
    const room = rooms.get(rd.roomId);
    if (!room) continue;
    const key = roomSignature(room.name, room.boundary);
    const entry = { name: room.name, proposal: asProposal(rd) };
    const queue = byRoom.get(key);
    if (queue) queue.push(entry);
    else byRoom.set(key, [entry]);
    count++;
  }
  return { byRoom, count, unmatched, source, name: design.name ?? 'scheme design' };
}

/**
 * Answer the app's designer channel with the scheme's design.
 *
 * Refusing beats guessing: a room the scheme does not cover is refused by name
 * rather than answered with somebody else's design, which would install
 * something that fits and is wrong.
 */
export function serve(ipcMain, index) {
  const served = [];
  const refused = [];
  // The key is never read: the harness answers `ai:call` itself and no request
  // leaves this machine. Saying "Ready" is what un-disables the button the
  // design is installed through.
  ipcMain.handle('ai:status', async () => ({
    configured: Boolean(index),
    keyLocation: 'not used — answered by the harness',
    model: 'scheme-design (harness, not a model)',
  }));
  ipcMain.handle('ai:call', async (_e, request) => {
    if (!index) return { ok: false, reason: 'no_design' };
    const name = /ROOM: "([^"]+)"/.exec(request.user)?.[1];
    const boundary = /Boundary \(mm, plan coordinates\): (.+)/.exec(request.user)?.[1] ?? '';
    const points = [...boundary.matchAll(/\((-?[\d.]+), (-?[\d.]+)\)/g)].map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
    }));
    const queue = name && points.length > 0 ? index.byRoom.get(roomSignature(name, points)) : null;
    const held = queue && queue.length > 0 ? queue.shift() : null;
    if (!held) {
      refused.push(name ?? '(unnamed)');
      return { ok: false, reason: 'no_design', detail: `No design for "${name}".` };
    }
    served.push(held.name);
    // `text`, because that is the field the view parses. A response shaped any
    // other way leaves the agent waiting on a promise that never settles: the
    // button stays on "Designing…" and every room reads as a rejection.
    return {
      ok: true,
      text: JSON.stringify(held.proposal),
      model: 'scheme-design (harness, not a model)',
      stopReason: 'end_turn',
    };
  });
  return { served, refused };
}

/**
 * Drive the Design tab, room by room, to install what `serve` is answering.
 *
 * `run` executes a function string in the renderer; `wait` sleeps. Both are
 * passed in so this file needs no Electron import and can be read on its own.
 */
export async function installViaDesignTab({ run, wait, index, refused, log = () => {} }) {
  const SET_FIELD = `(function (id, value, eventName) {
    const node = document.getElementById(id);
    if (!node) return { ok: false };
    const proto = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value);
    node.dispatchEvent(new Event(eventName, { bubbles: true }));
    return { ok: true };
  })`;
  const ROOM_OPTIONS = `(function () {
    const sel = document.getElementById('dv-room');
    if (!sel) return { ok: false, options: [] };
    return { ok: true, options: [...sel.options].map((o) => ({ value: o.value, label: o.textContent.trim() })) };
  })`;
  // `settled` matters as much as `ok`. Reading the transcript on a fixed sleep
  // caught every room mid-round — the last line still said "calling…" — and
  // scored all 69 of them as rejected, which is the same wrong answer as
  // installing nothing, told confidently.
  //
  // Settling is read off the BUTTON, not the transcript: the agent re-prompts
  // itself on a proposal that does not fit, so "Rejected" is a line it prints
  // and then carries on past. The button says "Designing…" for exactly as long
  // as it is still working, which is the question being asked.
  const TRANSCRIPT = `(function () {
    const lines = [...document.querySelectorAll('.card .small.mono')].map((n) => n.textContent.trim());
    const button = [...document.querySelectorAll('button')]
      .find((b) => /Run AI Interior Designer|Designing/.test(b.textContent || ''));
    return {
      ok: lines.some((l) => l.startsWith('Accepted')),
      settled: !button || !/Designing/.test(button.textContent || ''),
      lines,
    };
  })`;
  const CLICK = `(function (selector, text) {
    const hit = [...document.querySelectorAll(selector)]
      .find((n) => (n.textContent || '').trim().toLowerCase().includes(text.toLowerCase()));
    if (!hit) return { ok: false };
    hit.click();
    return { ok: true };
  })`;

  await run(SET_FIELD, 'dv-instr', `Install the scheme's design, from ${index.source}.`, 'input');
  const listed = await run(ROOM_OPTIONS);

  let installed = 0;
  for (const option of listed.options ?? []) {
    await run(SET_FIELD, 'dv-room', option.value, 'change');
    await wait(120);
    await run(CLICK, 'button', 'Run AI Interior Designer');
    let transcript = { ok: false, settled: false, lines: [] };
    for (let tick = 0; tick < 40 && !transcript.settled; tick++) {
      await wait(150);
      transcript = await run(TRANSCRIPT);
    }
    // "Ground — HALL (1,245 sq ft)" is the label; only the area comes off, not
    // everything after the first bracket.
    const room = option.label.replace(/^.*? — /, '').replace(/\s*\([\d,]+ sq ft\)$/, '');
    if (transcript.ok) installed++;
    else if (refused.includes(room)) log(`    skipped ${room} — the scheme holds no design for it`);
    else log(`    REJECTED ${room} — ${(transcript.lines ?? []).slice(-1)[0] ?? ''}`);
  }
  return { installed, offered: listed.options?.length ?? 0 };
}
