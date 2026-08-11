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
    // Scaled, like every other position in this file. `slab` returns a mesh
    // already positioned in scene units, so re-setting it in raw millimetres
    // sent each base arm a thousand times too far — 124 m out and 30 m up for a
    // 620 mm chair, which is why a room with chairs in it had five stray slabs
    // over the horizon and nothing under the seat.
    arm.position.set(
      Math.sin(arm.rotation.y) * w * 0.2 * MM,
      30 * MM,
      Math.cos(arm.rotation.y) * w * 0.2 * MM,
    );
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
  // Overhanging worktop: the detail that says counter rather than block.
  //
  // The overhang is made by setting the BODY back, not by drawing the top
  // oversize. It was the other way round, and a top drawn 60 mm wider than the
  // catalogue width is the one thing this file promises never to do: a 3 m
  // servery set against a wall grew 30 mm into it at each end, and the design
  // layer had validated the footprint without that.
  const setback = 140;
  group.add(slab(w - 120, h - 40, d - setback, 0, (h - 40) / 2, -setback / 2, body));
  group.add(slab(w, 40, d, 0, h - 20, 0, top));
  return group;
};

/* ------------------------------------------------------------------------- *
 * The recreation-lounge contents.
 *
 * Same rules as everything above: a handful of boxes and cylinders, built
 * inside the catalogue's own bounding box, base at y = 0. These pieces earn
 * their own shapes rather than falling through to the generic box because each
 * of them IS the reason its room exists — a games room whose pool table is a
 * 2.9 m crate has not been designed, it has been measured.
 * ------------------------------------------------------------------------- */

const poolTable: Builder = (w, h, d, look) => {
  const group = new THREE.Group();
  const baize = makeMaterial(look.colour, 0.98);
  // Rails, legs and pockets are hard-coded dark timber and near-black rather
  // than shades of the cloth, in the same way the screen hard-codes its bezel.
  // `look.frame` is the cloth colour darkened, so a green table would get green
  // rails and the whole piece would read as one green box. It is the CONTRAST
  // between bright cloth and dark timber that names a pool table across a room.
  const timber = makeMaterial(new THREE.Color(0x3b2418), 0.55);
  const pocket = makeMaterial(new THREE.Color(0x0f0c0a), 0.9);

  // Rail width taken from the real cabinet the catalogue quotes: a
  // 2,900 x 1,626 cabinet plays 2,540 x 1,270, which is a rail a shade over a
  // ninth of the short side. Deriving it keeps the proportion if the catalogue
  // ever carries a 7 ft table as well.
  const rail = Math.min(w, d) * 0.11;
  const railHeight = h * 0.17;
  const apronHeight = h * 0.24;
  const legHeight = h - railHeight - apronHeight;

  // Cloth first, sitting 30 mm BELOW the rail top. A green rectangle flush with
  // its frame reads as a table-tennis table; the sunk bed is what says pool.
  group.add(
    slab(w - 2 * rail, railHeight + 60, d - 2 * rail, 0, h - 30 - (railHeight + 60) / 2, 0, baize),
  );

  // The rail frame as four separate pieces, so the cloth shows as an inset
  // panel rather than as a lid.
  group.add(slab(w, railHeight, rail, 0, h - railHeight / 2, d / 2 - rail / 2, timber));
  group.add(slab(w, railHeight, rail, 0, h - railHeight / 2, -(d / 2 - rail / 2), timber));
  group.add(slab(rail, railHeight, d - 2 * rail, w / 2 - rail / 2, h - railHeight / 2, 0, timber));
  group.add(
    slab(rail, railHeight, d - 2 * rail, -(w / 2 - rail / 2), h - railHeight / 2, 0, timber),
  );

  // Six pockets — four corners and two on the long rails. Nothing else on a
  // games floor has them, so they are the cheapest identification there is.
  for (const x of [-(w / 2 - rail * 0.6), 0, w / 2 - rail * 0.6]) {
    for (const z of [-(d / 2 - rail * 0.6), d / 2 - rail * 0.6]) {
      group.add(post(rail * 0.42, railHeight + 6, x, h - railHeight / 2, z, pocket));
    }
  }

  // Apron and six heavy legs. A pool table carries a slate bed and looks like
  // it does; four thin legs at the corners would read as a dining table.
  group.add(slab(w - 120, apronHeight, d - 120, 0, legHeight + apronHeight / 2, 0, timber));
  for (const x of [-(w / 2 - 220), 0, w / 2 - 220]) {
    for (const z of [-(d / 2 - 180), d / 2 - 180]) {
      group.add(slab(200, legHeight, 200, x, legHeight / 2, z, timber));
    }
  }
  return group;
};

const foosball: Builder = (w, h, d, look) => {
  const group = new THREE.Group();
  const field = makeMaterial(look.colour, 0.95);
  const cabinet = makeMaterial(look.frame, 0.6);
  const chrome = makeMaterial(new THREE.Color(0xc6cbd2), 0.25, 0.9);
  const figure = makeMaterial(new THREE.Color(0x14171b), 0.8);

  const wallThickness = 70;
  const legHeight = h * 0.52;
  const cabinetHeight = h - legHeight;
  const pitchTop = h - 90;
  legs(group, w, d, legHeight, cabinet, 90);

  // The cabinet is four walls rather than one box, because the pitch has to be
  // visible SUNK inside them — a solid box with a green lid is a table with a
  // cloth on it. The 90 mm of wall standing above the pitch is the lip that
  // keeps the ball in, and it is what the eye reads as "this is a game".
  for (const z of [d / 2 - wallThickness / 2, -(d / 2 - wallThickness / 2)]) {
    group.add(slab(w, cabinetHeight, wallThickness, 0, legHeight + cabinetHeight / 2, z, cabinet));
  }
  for (const x of [w / 2 - wallThickness / 2, -(w / 2 - wallThickness / 2)]) {
    group.add(
      slab(
        wallThickness,
        cabinetHeight,
        d - 2 * wallThickness,
        x,
        legHeight + cabinetHeight / 2,
        0,
        cabinet,
      ),
    );
    // A goal mouth at each end of the pitch. Two dark slots facing each other
    // are what state the direction of play. Drawn against the INNER face of the
    // wall rather than through it: a slab wide enough to stand proud of the
    // outer face would put the piece outside the footprint the design layer
    // validated, and coplanar with it would z-fight.
    group.add(
      slab(30, 90, d * 0.32, x - Math.sign(x) * (wallThickness / 2 + 15), pitchTop + 45, 0, figure),
    );
  }
  group.add(slab(w - 2 * wallThickness, 60, d - 2 * wallThickness, 0, pitchTop - 30, 0, field));

  // Eight rods across the short axis. Chrome against green is the single most
  // recognisable thing about a foosball table, more than the cabinet or the
  // figures. The real handles slide out past the cabinet, as the catalogue note
  // says; here they stop at the face, because the alternative is a piece 200 mm
  // deeper than the one the clearance check passed.
  const rods = 8;
  for (let i = 0; i < rods; i++) {
    const x = -w / 2 + ((i + 0.5) * w) / rods;
    const side = i % 2 === 0 ? 1 : -1;
    const bar = post(12, d, x, h - 30, 0, chrome);
    bar.rotation.x = Math.PI / 2;
    group.add(bar);
    // One thicker grip per rod, and the side it is on alternates — which is not
    // decoration: it is how a real table divides eight rods between two players
    // standing opposite each other.
    const grip = post(24, 90, x, h - 30, side * (d / 2 - 45), chrome);
    grip.rotation.x = Math.PI / 2;
    group.add(grip);
    // One figure per rod, on the far side from its own grip, so the row does not
    // read as a fence down the middle of the pitch.
    group.add(slab(50, 100, 40, x, pitchTop + 50, -side * d * 0.15, figure));
  }
  return group;
};

/**
 * Height of the bull above finished floor: the one dimension a dartboard has
 * that nothing in the model carries.
 */
const BULL_HEIGHT_MM = 1730;

const dartboard: Builder = (w, h, d, look) => {
  const group = new THREE.Group();
  // The board hangs inside a child group, and the child is what gets lifted —
  // see the comment on `board.position.y` below for why the lift cannot live on
  // the group this builder returns.
  const board = new THREE.Group();
  group.add(board);
  const surround = makeMaterial(look.colour, 0.8);
  // The board's own colours are hard-coded, as the screen's bezel is: a board is
  // cream and black with red and green rings whatever the surround around it is,
  // and the concentric rings are the ONLY thing that identifies it. A plain disc
  // on a dark panel is a clock.
  const cream = makeMaterial(new THREE.Color(0xe6dcc8), 0.85);
  const black = makeMaterial(new THREE.Color(0x1a1d21), 0.9);
  const red = makeMaterial(new THREE.Color(0x9b2b26), 0.8);
  const green = makeMaterial(new THREE.Color(0x1e6440), 0.8);

  const backboardDepth = Math.max(40, d * 0.45);
  board.add(slab(w, h, backboardDepth, 0, h / 2, -d / 2 + backboardDepth / 2, surround));

  // Rings as flat discs stacked a few millimetres apart so they cannot z-fight,
  // each one smaller and further forward. The face is +Z, which is where every
  // other builder here puts the side you use.
  const face = -d / 2 + backboardDepth;
  const rings: ReadonlyArray<readonly [number, THREE.Material]> = [
    [0.44, black],
    [0.4, red],
    [0.37, cream],
    [0.24, green],
    [0.21, cream],
    [0.05, red],
  ];
  rings.forEach(([fraction, material], i) => {
    const disc = post(Math.min(w, h) * fraction, 12, 0, h / 2, face + 6 + i * 3, material);
    disc.rotation.x = Math.PI / 2;
    board.add(disc);
  });

  // Wall mounted, and this is the one builder that deliberately draws outside
  // its nominal box.
  //
  // The caller places the returned group with
  // `piece.position.set(x, elevation, -y)` — base on the floor slab — and a
  // `FurniturePlacement` carries no mounting height, so a board built
  // base-at-zero sits at shin height and reads as a bin lid. Worse, it would
  // contradict its own clearance: the 2,370 mm the catalogue reserves is the
  // throw line, measured to a board at bull height.
  //
  // The lift therefore goes on the CHILD, not on the group this returns.
  // `Vector3.set` assigns all three components, so a y written on the returned
  // group is overwritten by the caller's own `set` a moment later and the board
  // drops back to the floor — silently, because nothing downstream reads a
  // furniture height. A child transform composes with the caller's instead of
  // racing it.
  //
  // Only the height moves. The footprint, which is what the clearance check
  // actually validated, is untouched.
  board.position.y = (BULL_HEIGHT_MM - h / 2) * MM;
  return group;
};

const stool: Builder = (w, h, d, look) => {
  const group = new THREE.Group();
  const seat = makeMaterial(look.colour, 0.8);
  const frame = makeMaterial(look.frame, 0.3, 0.7);
  const radius = Math.min(w, d) / 2;
  const seatThickness = 90;
  const legHeight = h - seatThickness;
  group.add(post(radius, seatThickness, 0, h - seatThickness / 2, 0, seat));
  // A stool is mostly air: slim legs, well inside the seat, so the seat reads as
  // floating rather than as the top of a bin.
  for (const [x, z] of [
    [-radius * 0.62, -radius * 0.62],
    [radius * 0.62, -radius * 0.62],
    [-radius * 0.62, radius * 0.62],
    [radius * 0.62, radius * 0.62],
  ] as ReadonlyArray<readonly [number, number]>) {
    group.add(post(20, legHeight, x, legHeight / 2, z, frame));
  }
  // The footring. At bar height it is the detail that separates a stool from a
  // small round table, because the seat alone is the same shape as both.
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 0.66 * MM, 14 * MM, 6, 18),
    frame,
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = h * 0.28 * MM;
  ring.castShadow = true;
  group.add(ring);
  return group;
};

const coffeeTable: Builder = (w, h, d, look) => {
  const group = new THREE.Group();
  const top = makeMaterial(look.colour, 0.45);
  const frame = makeMaterial(look.frame, 0.5);
  const topThickness = 40;
  group.add(slab(w, topThickness, d, 0, h - topThickness / 2, 0, top));
  legs(group, w, d, h - topThickness, frame, 90);
  // A lower shelf. At 400 mm high the boardroom table's two pedestals read as a
  // boardroom table someone has sawn the legs off; the shelf says low table.
  group.add(slab(w - 200, 22, d - 160, 0, Math.max(90, h * 0.28), 0, top));
  return group;
};

const shoeRack: Builder = (w, h, d, look) => {
  const group = new THREE.Group();
  const shelf = makeMaterial(look.colour, 0.7);
  const frame = makeMaterial(look.frame, 0.6);
  const sideThickness = 30;
  for (const x of [-(w / 2 - sideThickness / 2), w / 2 - sideThickness / 2]) {
    group.add(slab(sideThickness, h, d, x, h / 2, 0, frame));
  }
  // Open shelves, not the cabinet's doors. Outside a prayer room the rack has to
  // read as somewhere shoes go at a glance; a closed carcass is a cupboard, and
  // a cupboard by a door is something you walk past.
  const shelves = Math.max(3, Math.round(h / 300));
  for (let i = 0; i < shelves; i++) {
    const y = 60 + (i * (h - 120)) / (shelves - 1);
    group.add(slab(w - 2 * sideThickness, 25, d, 0, y, 0, shelf));
  }
  // A low back rail, so the bottom shelf does not read as a plank floating
  // between two boards.
  group.add(slab(w - 2 * sideThickness, 120, 20, 0, 130, -d / 2 + 10, frame));
  return group;
};

const rug: Builder = (w, h, d, look) => {
  const group = new THREE.Group();
  const field = makeMaterial(look.colour, 0.98);
  const border = makeMaterial(look.frame, 0.98);
  // 20 mm of thickness is all the silhouette a rug has, so the whole read has to
  // come from the plan: a bordered field, not a coloured patch of floor.
  const thickness = Math.max(12, h);
  group.add(slab(w, thickness * 0.6, d, 0, thickness * 0.3, 0, border));
  group.add(slab(w - 140, thickness * 0.5, d - 140, 0, thickness * 0.75, 0, field));

  // The niche at the head end: what makes a prayer rug a prayer rug rather than
  // a doormat, and the only thing in the model that shows which way it faces.
  // Every builder here puts the back of a piece at local -Z, so the niche goes
  // there — a row of rugs turned by the design layer then points one way, and
  // whether that way is right is a question for the design, not for the mesh.
  const nicheRadius = Math.min(w, d) * 0.17;
  const nicheZ = -d / 2 + 90 + nicheRadius;
  const nicheHeight = thickness * 0.3;
  group.add(post(nicheRadius, nicheHeight, 0, thickness, nicheZ, border));
  const shaftZ = nicheZ + nicheRadius * 0.75;
  group.add(slab(nicheRadius * 2, nicheHeight, nicheRadius * 1.5, 0, thickness, shaftZ, border));
  return group;
};


/**
 * A plinth with something on it.
 *
 * The plinth is the easy half. What makes it read as an exhibit rather than as a
 * packing case is the object ON it and the gap of air under that object's widest
 * point — so the sphere sits proud of the top, not sunk into it.
 */
const plinth: Builder = (w, h, d, look) => {
  const group = new THREE.Group();
  const body = makeMaterial(look.frame, 0.5);
  const top = makeMaterial(look.colour, 0.3, 0.2);
  const plinthHeight = h * 0.78;
  // Tapered: a plinth with parallel sides is a box, and reads as one.
  group.add(slab(w * 0.86, plinthHeight - 40, d * 0.86, 0, (plinthHeight - 40) / 2, 0, body));
  group.add(slab(w, 40, d, 0, plinthHeight - 20, 0, top));
  group.add(slab(w * 0.94, 30, d * 0.94, 0, 15, 0, top));
  // The exhibit itself, as a sphere: a globe on floor 2, near enough to a
  // massing model anywhere else, and unmistakably not more plinth.
  const exhibit = new THREE.Mesh(
    new THREE.SphereGeometry((Math.min(w, d) * 0.3) * MM, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0x2f6ea8, roughness: 0.35, metalness: 0.15 }),
  );
  exhibit.position.set(0, (plinthHeight + Math.min(w, d) * 0.3) * MM, 0);
  exhibit.castShadow = true;
  group.add(exhibit);
  return group;
};

/** A terrain model set into the floor: a lipped tray with land in it. */
const terrainModel: Builder = (w, h, d, look) => {
  const group = new THREE.Group();
  const lip = makeMaterial(look.frame, 0.6);
  const land = makeMaterial(new THREE.Color(0x4a6b3f), 0.95);
  const water = new THREE.MeshStandardMaterial({ color: 0x2d5a7a, roughness: 0.15, metalness: 0.2 });
  group.add(slab(w, h * 0.5, d, 0, h * 0.25, 0, lip));
  group.add(slab(w - 160, 40, d - 160, 0, h * 0.5, 0, water));
  // Contours, stepped: a model of ground reads as ground because it is not flat.
  for (let i = 0; i < 4; i++) {
    const k = 1 - i * 0.19;
    group.add(slab((w - 260) * k, 55, (d - 260) * k, w * 0.04 * i, h * 0.5 + 30 + i * 45, -d * 0.03 * i, land));
  }
  return group;
};

/** A curved bank of operator positions, as a control room has. */
const console3: Builder = (w, h, d, look) => {
  const group = new THREE.Group();
  const top = makeMaterial(look.colour, 0.4);
  const frame = makeMaterial(look.frame, 0.4, 0.4);
  const screenMat = new THREE.MeshStandardMaterial({
    color: 0x8fd0ff,
    emissive: 0x2c7fbf,
    emissiveIntensity: 0.8,
    roughness: 0.2,
  });
  // Three desk segments swung round a shallow arc.
  const segments = 3;
  for (let i = 0; i < segments; i++) {
    const t = (i - (segments - 1) / 2) / segments;
    const angle = t * 0.7;
    const seg = slab(w / segments - 40, 40, d * 0.55, 0, h - 20, 0, top);
    seg.rotation.y = -angle;
    seg.position.set(Math.sin(angle) * w * 0.34 * MM, (h - 20) * MM, (Math.cos(angle) - 1) * d * 0.5 * MM);
    group.add(seg);
    const leg = slab(w / segments - 200, h - 60, 60, 0, 0, 0, frame);
    leg.rotation.y = -angle;
    leg.position.set(Math.sin(angle) * w * 0.34 * MM, ((h - 60) / 2) * MM, (Math.cos(angle) - 1) * d * 0.5 * MM);
    group.add(leg);
    // Monitors, which is what a monitoring console is for.
    const mon = slab(w / segments - 260, 420, 40, 0, 0, 0, screenMat);
    mon.rotation.y = -angle;
    mon.position.set(
      Math.sin(angle) * w * 0.34 * MM,
      (h + 220) * MM,
      ((Math.cos(angle) - 1) * d * 0.5 - d * 0.24) * MM,
    );
    group.add(mon);
  }
  return group;
};

/** A tall plant cabinet: UPS or CRAC. Louvred, because both are. */
const plantCabinet: Builder = (w, h, d, look) => {
  const group = new THREE.Group();
  const body = makeMaterial(look.colour, 0.45, 0.35);
  const louvre = makeMaterial(new THREE.Color(0x14181c), 0.9);
  group.add(slab(w, h, d, 0, h / 2, 0, body));
  const bands = Math.max(3, Math.floor(h / 500));
  for (let i = 0; i < bands; i++) {
    group.add(slab(w - 140, 180, 14, 0, 260 + (i * (h - 500)) / Math.max(1, bands - 1), d / 2 + 8, louvre));
  }
  // A plinth, so it does not appear to float on the finished floor.
  group.add(slab(w + 60, 80, d + 60, 0, 40, 0, makeMaterial(look.frame, 0.7)));
  return group;
};

/**
 * One bay of tensile shade.
 *
 * Four legs and a sagging fabric top. The sag is the whole point: a flat plane
 * on posts reads as a carport, and the reference photographs are all of fabric.
 */
const pergola: Builder = (w, h, d, look) => {
  const group = new THREE.Group();
  const post = makeMaterial(look.frame, 0.5, 0.4);
  const fabric = new THREE.MeshStandardMaterial({
    color: look.colour,
    roughness: 0.85,
    side: THREE.DoubleSide,
  });
  const feet: ReadonlyArray<readonly [number, number]> = [
    [-w / 2 + 90, -d / 2 + 90],
    [w / 2 - 90, -d / 2 + 90],
    [-w / 2 + 90, d / 2 - 90],
    [w / 2 - 90, d / 2 - 90],
  ];
  for (const [x, z] of feet) group.add(slab(90, h, 90, x, h / 2, z, post));
  // A shallow dish, built from a grid so the sag is real geometry.
  const n = 6;
  const canopy = new THREE.Mesh(new THREE.PlaneGeometry(w * MM, d * MM, n, n), fabric);
  const pos = canopy.geometry.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / (w * MM);
    const v = pos.getY(i) / (d * MM);
    // Lowest in the middle, tight at the corners, like a real tensile panel.
    pos.setZ(i, -(0.25 - u * u) * (0.25 - v * v) * 3.2);
  }
  pos.needsUpdate = true;
  canopy.geometry.computeVertexNormals();
  canopy.rotation.x = -Math.PI / 2;
  canopy.position.y = h * MM;
  canopy.castShadow = true;
  group.add(canopy);
  return group;
};

/** A long planter trough with planting standing out of it. */
const trough: Builder = (w, h, d, look) => {
  const group = new THREE.Group();
  const box = makeMaterial(look.colour, 0.8);
  const leaf = makeMaterial(new THREE.Color(0x3f7a44), 0.95);
  group.add(slab(w, h, d, 0, h / 2, 0, box));
  const clumps = Math.max(2, Math.round(w / 700));
  for (let i = 0; i < clumps; i++) {
    const cx = -w / 2 + ((i + 0.5) * w) / clumps;
    const bush = new THREE.Mesh(new THREE.SphereGeometry(d * 0.34 * MM, 8, 6), leaf);
    bush.position.set(cx * MM, (h + d * 0.24) * MM, 0);
    bush.scale.set(1, 0.8, 1);
    bush.castShadow = true;
    group.add(bush);
  }
  return group;
};

/**
 * A PV module on its tilt frame.
 *
 * Drawn tilted because a flat blue rectangle on a roof reads as a puddle. The
 * tilt is what makes it obviously a panel from any angle.
 */
const solarPanel: Builder = (w, h, d, look) => {
  const group = new THREE.Group();
  const frame = makeMaterial(new THREE.Color(0x9aa3ad), 0.35, 0.7);
  const cells = new THREE.MeshStandardMaterial({
    color: look.colour,
    roughness: 0.18,
    metalness: 0.45,
  });
  const tilt = 0.35;
  const legBack = 700;
  group.add(slab(90, 200, 90, -w / 2 + 80, 100, d / 2 - 60, frame));
  group.add(slab(90, 200, 90, w / 2 - 80, 100, d / 2 - 60, frame));
  group.add(slab(90, legBack, 90, -w / 2 + 80, legBack / 2, -d / 2 + 60, frame));
  group.add(slab(90, legBack, 90, w / 2 - 80, legBack / 2, -d / 2 + 60, frame));
  const panel = slab(w, Math.max(40, h), d, 0, 0, 0, cells);
  panel.rotation.x = tilt;
  panel.position.set(0, (200 + legBack) / 2 * MM, 0);
  group.add(panel);
  return group;
};

/**
 * Which builder suits a catalogue key.
 *
 * Matched on the key's prefix rather than an exhaustive table, so a catalogue
 * that grows a `desk.standing.1600` gets a desk without anyone remembering to
 * come back here.
 *
 * FIRST MATCH WINS, so a narrower prefix must sit above the family it belongs
 * to. That is not a style point: `seating.stool.bar` under `/^seating\./` is
 * built as a three-seat sofa squeezed into a 400 mm footprint, and nothing
 * anywhere reports it — the piece is simply wrong on screen. The three pairs
 * below (`table.coffee`, `seating.stool`, `storage.shoe`) each exist only to be
 * read before their family.
 */
const BUILDERS: ReadonlyArray<readonly [RegExp, Builder]> = [
  [/^desk\./, desk],
  [/^chair\./, chair],
  [/^table\.coffee/, coffeeTable],
  [/^table\./, table],
  [/^games\.pool/, poolTable],
  [/^games\.foosball/, foosball],
  [/^games\.dartboard/, dartboard],
  [/^seating\.stool/, stool],
  [/^seating\.sofa/, sofa],
  [/^seating\./, sofa],
  [/^storage\.shoe/, shoeRack],
  [/^storage\./, cabinet],
  [/^display\./, screen],
  [/^exhibit\.model/, terrainModel],
  [/^exhibit\./, plinth],
  // Narrower than `^equipment\.`, so each must be read before it.
  [/^equipment\.console/, console3],
  [/^equipment\.ups|^equipment\.crac/, plantCabinet],
  [/^equipment\./, rack],
  [/^outdoor\.pergola/, pergola],
  [/^outdoor\.planter/, trough],
  [/^outdoor\.solar/, solarPanel],
  [/^decor\.planter/, planter],
  [/^decor\.prayer|^decor\.rug/, rug],
  [/^bed\./, bed],
  [/^reception\./, counter],
  // `counter.servery.3000` already lands here: `^counter` matches it and no
  // pattern above does. The entry predates the key by design — it was written
  // for exactly this, a servery that is a counter and not a desk.
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
