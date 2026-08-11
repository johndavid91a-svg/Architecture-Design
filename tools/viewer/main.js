/**
 * The standalone 3D viewer.
 *
 * Bundled with three.js into one file and inlined into a published page, because
 * that page runs under a CSP that blocks every external request. It reads the
 * geometry `tools/export-viewer-data.mjs` writes and nothing else — no rates, no
 * prices, no supplier names.
 *
 * It deliberately reuses the app walkthrough's conventions so the two agree:
 * plan Y maps to scene -Z, everything is in metres, and a wall is drawn as the
 * solid pieces BETWEEN its openings rather than as a box with paint on it.
 */

import * as THREE from 'three';

const DATA = JSON.parse(document.getElementById('model-data').textContent);

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1116);
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 900);

scene.add(new THREE.HemisphereLight(0xbcd4f0, 0x2a3038, 0.55));
const sun = new THREE.DirectionalLight(0xffe9c9, 2.4);
sun.position.set(40, 70, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -40;
sun.shadow.camera.right = 40;
sun.shadow.camera.top = 60;
sun.shadow.camera.bottom = -20;
sun.shadow.camera.far = 250;
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

const building = new THREE.Group();
scene.add(building);

const groundPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(140, 140),
  new THREE.MeshStandardMaterial({ color: 0x1b2129, roughness: 1 }),
);
groundPlane.rotation.x = -Math.PI / 2;
groundPlane.position.y = -0.02;
groundPlane.receiveShadow = true;
scene.add(groundPlane);

const mat = (hex, opts = {}) =>
  new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: 0.85, ...opts });

const glassMat = new THREE.MeshStandardMaterial({
  color: 0x8fc0d6,
  roughness: 0.06,
  metalness: 0.1,
  transparent: true,
  opacity: 0.34,
});
const doorMat = mat('#8a6242', { roughness: 0.6 });

/** One storey's geometry, as a group that can be shown or hidden on its own. */
const groups = new Map();

function buildFloor(f) {
  const g = new THREE.Group();
  const y = f.elevation;

  for (const room of f.rooms) {
    const shape = new THREE.Shape();
    room.poly.forEach(([x, z], i) => (i === 0 ? shape.moveTo(x, z) : shape.lineTo(x, z)));
    shape.closePath();
    const slab = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat(room.colour));
    slab.rotation.x = -Math.PI / 2;
    slab.position.y = y + 0.01;
    slab.receiveShadow = true;
    slab.userData.label = `${room.name} — ${room.area} sq ft`;
    g.add(slab);
  }

  for (const w of f.walls) {
    const dx = w.b[0] - w.a[0];
    const dz = w.b[1] - w.a[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.02) continue;
    const angle = Math.atan2(dz, dx);
    const wallMat = mat(w.ext ? '#b9b3a8' : '#d8d4cc');

    // Solid pieces between the openings — the same approach the app uses, and
    // the reason the glazing reads as glazing instead of as a lighter wall.
    const sorted = [...w.o].sort((p, q) => p.d - q.d);
    const solids = [];
    let cursor = 0;
    for (const o of sorted) {
      const s = Math.max(0, o.d - o.w / 2);
      const e = Math.min(len, o.d + o.w / 2);
      if (s > cursor) solids.push([cursor, s]);
      cursor = Math.max(cursor, e);
    }
    if (cursor < len) solids.push([cursor, len]);

    const box = (from, to, base, h, m, depth = w.t) => {
      const l = to - from;
      if (l <= 0.02 || h <= 0.02) return;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(l, h, depth), m);
      const mid = (from + to) / 2;
      mesh.position.set(w.a[0] + Math.cos(angle) * mid, y + base + h / 2, w.a[1] + Math.sin(angle) * mid);
      mesh.rotation.y = -angle;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
    };

    for (const [s, e] of solids) box(s, e, 0, w.h, wallMat);
    for (const o of sorted) {
      const s = Math.max(0, o.d - o.w / 2);
      const e = Math.min(len, o.d + o.w / 2);
      const head = o.s + o.h;
      box(s, e, head, Math.max(0, w.h - head), wallMat);
      if (o.s > 0) box(s, e, 0, o.s, wallMat);
      box(s, e, o.s, o.h, o.g ? glassMat : doorMat, w.t * 0.4);
    }
  }

  for (const it of f.items) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(it.w, it.h, it.d), mat(it.c, { roughness: 0.7 }));
    mesh.position.set(it.p[0], y + it.h / 2, it.p[1]);
    mesh.rotation.y = -(it.r * Math.PI) / 180;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.label = it.l;
    g.add(mesh);
  }

  return g;
}

let concept = DATA.concepts[0].id;
let isolated = null;

function rebuild() {
  for (const g of groups.values()) building.remove(g);
  groups.clear();
  for (const f of DATA.byConcept[concept]) {
    const g = buildFloor(f);
    groups.set(f.name, g);
    building.add(g);
  }
  applyVisibility();
}

function applyVisibility() {
  for (const [name, g] of groups) g.visible = isolated === null || name === isolated;
}

// ---- Orbit, drag to rotate, wheel to zoom ---------------------------------
const target = new THREE.Vector3(6, 12, -6.5);
let angle = Math.PI * 0.28;
let elev = 0.42;
let dist = 62;

function place() {
  camera.position.set(
    target.x + Math.cos(angle) * Math.cos(elev) * dist,
    target.y + Math.sin(elev) * dist,
    target.z + Math.sin(angle) * Math.cos(elev) * dist,
  );
  camera.lookAt(target);
  sun.target.position.copy(target);
}

let dragging = false;
let lx = 0;
let ly = 0;
canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  lx = e.clientX;
  ly = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointerup', (e) => {
  dragging = false;
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  angle -= (e.clientX - lx) * 0.006;
  elev = Math.max(-0.2, Math.min(1.45, elev + (e.clientY - ly) * 0.005));
  lx = e.clientX;
  ly = e.clientY;
  place();
});
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    dist = Math.max(6, Math.min(220, dist * (1 + e.deltaY * 0.0012)));
    place();
  },
  { passive: false },
);

// Pinch to zoom, so it works on a phone.
let pinch = 0;
canvas.addEventListener('touchmove', (e) => {
  if (e.touches.length !== 2) return;
  e.preventDefault();
  const d = Math.hypot(
    e.touches[0].clientX - e.touches[1].clientX,
    e.touches[0].clientY - e.touches[1].clientY,
  );
  if (pinch) {
    dist = Math.max(6, Math.min(220, dist * (pinch / d)));
    place();
  }
  pinch = d;
}, { passive: false });
canvas.addEventListener('touchend', () => (pinch = 0));

// ---- Controls -------------------------------------------------------------
const floorBar = document.getElementById('floors');
const conceptSel = document.getElementById('concept');
const caption = document.getElementById('caption');

for (const c of DATA.concepts) {
  const o = document.createElement('option');
  o.value = c.id;
  o.textContent = c.label;
  conceptSel.append(o);
}
conceptSel.addEventListener('change', () => {
  concept = conceptSel.value;
  rebuild();
});

/** Feet and inches, the way the drawing writes a level tag. */
function levelTag(metres) {
  const ft = metres / 0.3048;
  const whole = Math.floor(ft + 1e-6);
  const inch = Math.round((ft - whole) * 12);
  return inch === 12 ? `+${whole + 1}'-0"` : `+${whole}'-${inch}"`;
}

/**
 * The storey list, read as a section.
 *
 * Top storey first and each row carrying its own level tag, because that is how
 * the level column on a section drawing reads and this building is described by
 * one. Ordering it the other way would put the mumty under the basement.
 */
function paintBar() {
  floorBar.innerHTML = '';
  const rows = [...DATA.byConcept[concept]].sort((a, b) => b.elevation - a.elevation);

  const add = (label, tag, key, note) => {
    const b = document.createElement('button');
    b.className = isolated === key ? 'lvl on' : 'lvl';
    b.innerHTML =
      `<span class="lvl-name">${label}</span>` +
      `<span class="lvl-tag">${tag}</span>` +
      (note ? `<span class="lvl-note">${note}</span>` : '');
    b.onclick = () => {
      isolated = key;
      applyVisibility();
      paintBar();
      say();
    };
    floorBar.append(b);
  };

  for (const f of rows) add(f.name, levelTag(f.elevation), f.name, f.purpose);
  add('Whole building', `77'-3\u2033 total`, null, 'every storey at once');
}

function say() {
  if (isolated === null) {
    const n = DATA.byConcept[concept].reduce((s, f) => s + f.rooms.length, 0);
    caption.textContent = `${DATA.byConcept[concept].length} storeys, ${n} rooms, ${DATA.totalHeightFt} ft to the top.`;
    return;
  }
  const f = DATA.byConcept[concept].find((x) => x.name === isolated);
  const area = f.rooms.reduce((s, r) => s + r.area, 0);
  caption.textContent =
    `${f.name}${f.purpose ? ' — ' + f.purpose : ''} · +${f.elevation.toFixed(2)} m · ` +
    `${f.rooms.length} rooms, ${area} sq ft, ${f.items.length} items.`;
}

function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

new ResizeObserver(resize).observe(canvas);
rebuild();
paintBar();
say();
resize();
place();

(function loop() {
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
})();
