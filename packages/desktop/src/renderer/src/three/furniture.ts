import * as THREE from 'three';

/**
 * FURNITURE THAT READS AS FURNITURE.
 *
 * Every item was a single box at the right size, in the right place, at the
 * right rotation — and completely unreadable. A 1,600 x 800 x 750 box is a desk
 * and a bed and a counter, and a room full of them looks like a warehouse of
 * crates rather than a place anyone would sit.
 *
 * These are still simple: a handful of boxes and cylinders each, no imported
 * models, no textures. That is deliberate. What makes a chair read as a chair at
 * walking distance is its SILHOUETTE — legs with a gap under the seat, a back
 * that rises, arms at the right height — not its detail. Every piece is built
 * inside the catalogue's own bounding box, so nothing here changes a dimension
 * or overflows the space the design layer allotted it.
 *
 * All dimensions are millimetres, and the group is returned centred on the
 * origin with its base at y = 0, which is how the caller places it.
 */

export interface FurnitureLook {
  /** Main colour, from the catalogue's placeholder. */
  readonly colour: THREE.Color;
  /** A second colour for legs, frames and bases. */
  readonly frame: THREE.Color;
}

const MM = 0.001;

function makeMaterial(colour: THREE.Color, roughness: number, metalness = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: colour, roughness, metalness });
}

/** A box in millimetres, positioned by its centre. */
function slab(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  material: THREE.Material,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w * MM, h * MM, d * MM), material);
  mesh.position.set(x * MM, y * MM, z * MM);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function post(
  radius: number,
  height: number,
  x: number,
  y: number,
  z: number,
  material: THREE.Material,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * MM, radius * MM, height * MM, 10),
    material,
  );
  mesh.position.set(x * MM, y * MM, z * MM);
  mesh.castShadow = true;
  return mesh;
}

/** Four legs at the corners of a top, inset so they read as legs and not walls. */
function legs(
  group: THREE.Group,
  w: number,
  d: number,
  height: number,
  material: THREE.Material,
  inset = 60,
): void {
  const hx = w / 2 - inset;
  const hz = d / 2 - inset;
  const corners: ReadonlyArray<readonly [number, number]> = [
    [-hx, -hz],
    [hx, -hz],
    [-hx, hz],
    [hx, hz],
  ];
  for (const [x, z] of corners) {
    group.add(slab(50, height, 50, x, height / 2, z, material));
  }
}

type Builder = (w: number, h: number, d: number, look: FurnitureLook) => THREE.Group;

const desk: Builder = (w, h, d, look) => {
  const group = new THREE.Group();
  const top = makeMaterial(look.colour, 0.55);
  const frame = makeMaterial(look.frame, 0.4, 0.5);
  const topThickness = 30;
  group.add(slab(w, topThickness, d, 0, h - topThickness / 2, 0, top));
  legs(group, w, d, h - topThickness, frame);
  // Modesty panel: the thing that stops a desk reading as a table.
  group.add(slab(w - 160, h * 0.42, 20, 0, h * 0.34, -d / 2 + 80, frame));
  return group;
};

const chair: Builder = (w, h, d, look) => {
  const group = new THREE.Group();
  const soft = makeMaterial(look.colour, 0.85);
  const frame = makeMaterial(look.frame, 0.35, 0.6);
  const seatHeight = Math.min(460, h * 0.55);
  group.add(slab(w * 0.92, 70, d * 0.92, 0, seatHeight, 0, soft));
  // Back, raked slightly so it does not read as a partition.
  const back = slab(w * 0.88, h - seatHeight - 40, 60, 0, seatHeight + (h - seatHeight) / 2, -d / 2 + 60, soft);
  back.rotation.x = -0.12;
  group.add(back);
  group.add(post(35, seatHeight - 60, 0, (seatHeight - 60) / 2, 0, frame));
  // Five-star base, as an office chair has.
  for (let i = 0; i < 5; i++) {
    const arm = slab(w * 0.42, 25, 40, 0, 30, 0, frame);
    arm.rotation.y = (i / 5) * Math.PI * 2;
    arm.position.set(Math.sin(arm.rotation.y) * w * 0.2, 30, Math.cos(arm.rotation.y) * w * 0.2);
    group.add(arm);
  }
  return group;
};

const table: Builder = (w, h, d, look) => {
  const group = new THREE.Group();
  const top = makeMaterial(look.colour, 0.4);
  const frame = makeMaterial(look.frame, 0.35, 0.5);
  group.add(slab(w, 40, d, 0, h - 20, 0, top));
  // Two pedestals rather than four legs: that is what a boardroom table has,
  // and it is the difference between reading as a table and as a crate.
  for (const x of [-w * 0.28, w * 0.28]) {
    group.add(slab(120, h - 60, d * 0.5, x, (h - 60) / 2, 0, frame));
    group.add(slab(w * 0.16, 40, d * 0.7, x, 20, 0, frame));
  }
  return group;
};

const sofa: Builder = (w, h, d, look) => {
  const group = new THREE.Group();
  const soft = makeMaterial(look.colour, 0.9);
  const frame = makeMaterial(look.frame, 0.6);
  const seatHeight = 420;
  group.add(slab(w, seatHeight - 120, d, 0, (seatHeight - 120) / 2 + 60, 0, soft));
  group.add(slab(w, h - seatHeight, 180, 0, seatHeight + (h - seatHeight) / 2, -d / 2 + 90, soft));
  for (const x of [-w / 2 + 90, w / 2 - 90]) {
    group.add(slab(180, h * 0.62, d, x, (h * 0.62) / 2 + 60, 0, soft));
  }
  // Cushions, which is what stops the seat reading as a shelf.
  const cushions = Math.max(2, Math.round(w / 700));
  for (let i = 0; i < cushions; i++) {
    const cw = (w - 220) / cushions;
    group.add(slab(cw - 30, 110, d - 140, -((w - 220) / 2) + cw * (i + 0.5), seatHeight - 10, 20, soft));
  }
  legs(group, w, d, 60, frame, 120);
  return group;
};

const cabinet: Builder = (w, h, d, look) => {
  const group = new THREE.Group();
  const body = makeMaterial(look.colour, 0.6);
  const frame = makeMaterial(look.frame, 0.35, 0.6);
  group.add(slab(w, h - 60, d, 0, (h - 60) / 2 + 60, 0, body));
  group.add(slab(w, 60, d - 40, 0, 30, 0, frame));
  // Doors and handles, so the front face is not a blank panel.
  for (const x of [-w / 4, w / 4]) {
    group.add(slab(w / 2 - 20, h - 140, 15, x, h / 2 + 20, d / 2 + 5, frame));
    group.add(post(12, 160, x + w / 8, h / 2 + 20, d / 2 + 20, frame));
  }
  return group;
};

const screen: Builder = (w, h, d, look) => {
  const group = new THREE.Group();
  const bezel = makeMaterial(new THREE.Color(0x14181c), 0.4, 0.4);
  const panel = new THREE.MeshStandardMaterial({
    color: look.colour,
    // A screen is a light source in a dark room, and treating it as one is most
    // of why an LED wall reads at all.
    emissive: look.colour,
    emissiveIntensity: 0.85,
    roughness: 0.2,
  });
  group.add(slab(w, h, Math.max(40, d), 0, h / 2, 0, bezel));
  group.add(slab(w - 60, h - 60, 10, 0, h / 2, Math.max(40, d) / 2 + 6, panel));
  return group;
};

const rack: Builder = (w, h, d, look) => {
  const group = new THREE.Group();
  const body = makeMaterial(look.colour, 0.45, 0.6);
  const vent = makeMaterial(new THREE.Color(0x0e1216), 0.8);
  group.add(slab(w, h, d, 0, h / 2, 0, body));
  const units = Math.max(4, Math.floor(h / 180));
  for (let i = 0; i < units; i++) {
    group.add(slab(w - 60, 90, 12, 0, 80 + i * (h - 140) / units, d / 2 + 7, vent));
  }
  return group;
};

const planter: Builder = (w, h, d, look) => {
  const group = new THREE.Group();
  const pot = makeMaterial(look.frame, 0.85);
  const leaf = makeMaterial(new THREE.Color(0x3f7a44), 0.9);
  const potHeight = h * 0.38;
  group.add(post(Math.min(w, d) / 2, potHeight, 0, potHeight / 2, 0, pot));
  const foliage = new THREE.Mesh(
    new THREE.SphereGeometry((Math.min(w, d) / 2) * 0.95 * MM, 10, 8),
    leaf,
  );
  foliage.position.set(0, (potHeight + (h - potHeight) * 0.55) * MM, 0);
  foliage.scale.set(1, (h - potHeight) / Math.min(w, d), 1);
  foliage.castShadow = true;
  group.add(foliage);
  return group;
};

const bed: Builder = (w, h, d, look) => {
  const group = new THREE.Group();
  const frame = makeMaterial(look.frame, 0.6);
  const linen = makeMaterial(look.colour, 0.92);
  group.add(slab(w, 260, d, 0, 130, 0, frame));
  group.add(slab(w - 60, 220, d - 60, 0, 370, 0, linen));
  group.add(slab(w, h - 260, 60, 0, 260 + (h - 260) / 2, -d / 2 + 30, frame));
  for (const x of [-w / 4, w / 4]) group.add(slab(w / 2 - 100, 110, 380, x, 530, -d / 2 + 300, linen));
  return group;
};

const counter: Builder = (w, h, d, look) => {
  const group = new THREE.Group();
  const body = makeMaterial(look.frame, 0.7);
  const top = makeMaterial(look.colour, 0.35, 0.1);
  group.add(slab(w, h - 40, d - 120, 0, (h - 40) / 2, -60, body));
  // Overhanging worktop: the detail that says counter rather than block.
  group.add(slab(w + 60, 40, d, 0, h - 20, 0, top));
  return group;
};

/**
 * Which builder suits a catalogue key.
 *
 * Matched on the key's prefix rather than an exhaustive table, so a catalogue
 * that grows a `desk.standing.1600` gets a desk without anyone remembering to
 * come back here.
 */
const BUILDERS: ReadonlyArray<readonly [RegExp, Builder]> = [
  [/^desk\./, desk],
  [/^chair\./, chair],
  [/^table\./, table],
  [/^seating\.sofa/, sofa],
  [/^seating\./, sofa],
  [/^storage\./, cabinet],
  [/^display\./, screen],
  [/^equipment\./, rack],
  [/^decor\.planter/, planter],
  [/^bed\./, bed],
  [/^reception\./, counter],
  [/^counter|^servery/, counter],
];

/**
 * Build one piece of furniture, or fall back to a box.
 *
 * The fallback matters: a catalogue key nobody has written a shape for should
 * still appear at the right size, because a missing chair is a worse answer than
 * a crude one.
 */
export function buildFurniture(
  catalogueKey: string,
  widthMm: number,
  heightMm: number,
  depthMm: number,
  colourHex: string,
): THREE.Group {
  const colour = new THREE.Color(colourHex);
  const frame = colour.clone().multiplyScalar(0.55);
  const look: FurnitureLook = { colour, frame };

  const builder = BUILDERS.find(([pattern]) => pattern.test(catalogueKey))?.[1];
  if (builder) return builder(widthMm, heightMm, depthMm, look);

  const group = new THREE.Group();
  group.add(slab(widthMm, heightMm, depthMm, 0, heightMm / 2, 0, makeMaterial(colour, 0.7)));
  return group;
}
