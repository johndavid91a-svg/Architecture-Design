import * as THREE from 'three';

/**
 * MATERIALS THAT LOOK LIKE MATERIALS.
 *
 * Every surface in the model was a flat colour, so marble, tile, carpet and
 * plaster all read as the same matte plane at different hues. A palette chosen
 * from a reference photograph is wasted on that: what makes a floor read as a
 * floor is the module — the 600 mm tile, the 500 mm carpet square, the grain of
 * a board — and none of it was there.
 *
 * The textures are drawn at runtime rather than loaded. A published page and a
 * packaged app both run under a strict CSP that blocks every external request,
 * so a texture file would be one more thing to bundle, resolve and get wrong in
 * production. A canvas costs nothing, ships nowhere, and can be sized in
 * millimetres — which is the part that matters: `repeat` is set from the real
 * module against the real surface, so a 600 mm tile is 600 mm on a 4 m wall and
 * still 600 mm on a 40 m one.
 */

/** How big one repeat of the pattern is, in millimetres. */
export interface TextureSpec {
  readonly moduleMm: number;
  readonly draw: (ctx: CanvasRenderingContext2D, size: number, base: string) => void;
}

const SIZE = 256;

/** Slightly lighter or darker than the base, for grout, veins and grain. */
function shade(base: string, amount: number): string {
  const colour = new THREE.Color(base);
  const hsl = { h: 0, s: 0, l: 0 };
  colour.getHSL(hsl);
  colour.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amount)));
  return `#${colour.getHexString()}`;
}

/** A deterministic pseudo-random, so a rebuild does not reshuffle every surface. */
function noise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const speckle = (density: number, spread: number): TextureSpec['draw'] =>
  (ctx, size, base) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    const random = noise(7);
    for (let i = 0; i < size * size * density; i++) {
      ctx.fillStyle = shade(base, (random() - 0.5) * spread);
      ctx.fillRect(random() * size, random() * size, 1.5, 1.5);
    }
  };

/** Square tiles with a grout line. The join is what says "tiled". */
const tiled = (perSide: number, groutDepth: number): TextureSpec['draw'] =>
  (ctx, size, base) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    const random = noise(31);
    const step = size / perSide;
    for (let i = 0; i < perSide; i++) {
      for (let j = 0; j < perSide; j++) {
        // Each tile very slightly off its neighbours, as a real batch is.
        ctx.fillStyle = shade(base, (random() - 0.5) * 0.03);
        ctx.fillRect(i * step, j * step, step, step);
      }
    }
    ctx.strokeStyle = shade(base, -groutDepth);
    ctx.lineWidth = Math.max(1, size / 160);
    for (let i = 0; i <= perSide; i++) {
      ctx.beginPath();
      ctx.moveTo(i * step, 0);
      ctx.lineTo(i * step, size);
      ctx.moveTo(0, i * step);
      ctx.lineTo(size, i * step);
      ctx.stroke();
    }
  };

const TEXTURES: Record<string, TextureSpec> = {
  // Floors
  mat_tile_ceramic: { moduleMm: 1200, draw: tiled(2, 0.14) },
  mat_tile_porcelain: { moduleMm: 1200, draw: tiled(2, 0.1) },
  mat_carpet_tile: { moduleMm: 500, draw: speckle(0.5, 0.09) },
  mat_marble: {
    moduleMm: 2400,
    draw: (ctx, size, base) => {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, size, size);
      const random = noise(11);
      for (let v = 0; v < 14; v++) {
        ctx.strokeStyle = shade(base, random() > 0.5 ? -0.13 : 0.1);
        ctx.lineWidth = 0.6 + random() * 2.2;
        ctx.beginPath();
        let x = random() * size;
        let y = -10;
        ctx.moveTo(x, y);
        while (y < size + 10) {
          x += (random() - 0.5) * 34;
          y += 10 + random() * 14;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    },
  },
  mat_granite: { moduleMm: 900, draw: speckle(1.6, 0.3) },
  mat_stone_cladding: {
    moduleMm: 1800,
    draw: (ctx, size, base) => {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, size, size);
      const random = noise(5);
      const courses = 5;
      const h = size / courses;
      ctx.strokeStyle = shade(base, -0.18);
      ctx.lineWidth = Math.max(1, size / 150);
      for (let c = 0; c < courses; c++) {
        ctx.beginPath();
        ctx.moveTo(0, c * h);
        ctx.lineTo(size, c * h);
        ctx.stroke();
        // Perpends staggered course to course, as coursed stone is laid.
        let x = (c % 2) * (size / 6);
        while (x < size) {
          ctx.beginPath();
          ctx.moveTo(x, c * h);
          ctx.lineTo(x, (c + 1) * h);
          ctx.stroke();
          x += size / 4 + random() * (size / 10);
        }
      }
    },
  },
  // Timber: doors, worktops, the café counter.
  mat_door_flush: {
    moduleMm: 1400,
    draw: (ctx, size, base) => {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, size, size);
      const random = noise(23);
      for (let i = 0; i < 90; i++) {
        ctx.strokeStyle = shade(base, (random() - 0.45) * 0.16);
        ctx.lineWidth = 0.5 + random() * 1.6;
        const y = random() * size;
        ctx.beginPath();
        ctx.moveTo(0, y);
        // Grain wanders a little down the length of the board.
        for (let x = 0; x <= size; x += 16) ctx.lineTo(x, y + Math.sin(x / 26 + i) * 1.7);
        ctx.stroke();
      }
    },
  },
  // Walls and ceilings: barely there, but enough to stop them reading as card.
  mat_plaster: { moduleMm: 2000, draw: speckle(0.35, 0.045) },
  mat_paint_emulsion: { moduleMm: 2000, draw: speckle(0.3, 0.035) },
  mat_gypsum_ceiling: { moduleMm: 2000, draw: speckle(0.25, 0.03) },
  mat_grid_ceiling: { moduleMm: 1200, draw: tiled(2, 0.12) },
  mat_acp_panel: { moduleMm: 1200, draw: tiled(1, 0.08) },
  mat_brick_common: {
    moduleMm: 1800,
    draw: (ctx, size, base) => {
      ctx.fillStyle = shade(base, -0.1);
      ctx.fillRect(0, 0, size, size);
      const courses = 8;
      const h = size / courses;
      const random = noise(17);
      for (let c = 0; c < courses; c++) {
        const offset = (c % 2) * (size / 8);
        for (let b = -1; b < 4; b++) {
          ctx.fillStyle = shade(base, (random() - 0.5) * 0.12);
          ctx.fillRect(offset + b * (size / 4) + 1.5, c * h + 1.5, size / 4 - 3, h - 3);
        }
      }
    },
  },
  mat_block_concrete: { moduleMm: 1600, draw: speckle(0.6, 0.07) },
  // Glass and metal: the last two catalogue materials carrying an appearance
  // but no pattern, so both fell to the default speckle and a glazed screen and
  // an aluminium mullion came out as the same lightly dusty plane at different
  // hues. Neither is a texture in the ordinary sense — what separates them is
  // that glass has almost no grain and metal has nothing BUT grain, all of it
  // running one way.
  mat_glass_glazing: {
    // A pane, not a pattern. The joint is the only thing on a glazed screen that
    // gives it a size at all, so the module is the pane width.
    moduleMm: 1500,
    draw: (ctx, size, base) => {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, size, size);
      // A soft diagonal band: what a sheet of glass shows of the room behind the
      // camera. Without it the pane is a flat blue wall, which is worse than the
      // speckle it replaces.
      const sheen = ctx.createLinearGradient(0, size, size, 0);
      sheen.addColorStop(0, shade(base, -0.04));
      sheen.addColorStop(0.45, shade(base, 0.09));
      sheen.addColorStop(0.6, shade(base, -0.02));
      sheen.addColorStop(1, shade(base, 0.05));
      ctx.fillStyle = sheen;
      ctx.fillRect(0, 0, size, size);
      // The edge of the pane, dark against it: a mullion every module.
      ctx.strokeStyle = shade(base, -0.22);
      ctx.lineWidth = Math.max(1.5, size / 90);
      ctx.strokeRect(0, 0, size, size);
    },
  },
  mat_aluminium_section: {
    // Brushing is far finer than any tile, so the module is small. The lines run
    // one way only: metal that sparkles in both directions reads as granite.
    moduleMm: 400,
    draw: (ctx, size, base) => {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, size, size);
      const random = noise(43);
      for (let i = 0; i < 260; i++) {
        ctx.strokeStyle = shade(base, (random() - 0.5) * 0.14);
        ctx.lineWidth = 0.5 + random() * 1.1;
        const y = random() * size;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size, y);
        ctx.stroke();
      }
    },
  },
};

/** The pattern used when a material names none: enough grain to catch the light. */
const DEFAULT: TextureSpec = { moduleMm: 1500, draw: speckle(0.3, 0.05) };

const cache = new Map<string, THREE.CanvasTexture>();

/** How big one repeat of this material's pattern is, in millimetres. */
export function moduleMmFor(materialId: string | undefined): number {
  return ((materialId && TEXTURES[materialId]) || DEFAULT).moduleMm;
}

/**
 * The repeating texture for a material, at one repeat per UV unit.
 *
 * Shared, not cloned — the size of the pattern on a given surface is set on that
 * surface's UVs by `tileUVs`, not here. Doing it the other way round (a clone
 * per surface with its own `repeat`) is the obvious design and it does not
 * survive a real building: three uploads each clone to the GPU separately, so a
 * nine-storey import with a few thousand differently sized wall segments turned
 * a handful of 256-pixel canvases into hundreds of megabytes of texture memory.
 */
export function textureFor(
  materialId: string | undefined,
  baseColourHex: string,
): THREE.CanvasTexture | null {
  const spec = (materialId && TEXTURES[materialId]) || DEFAULT;
  const key = `${materialId ?? 'default'}|${baseColourHex}`;

  const existing = cache.get(key);
  if (existing) return existing;

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  spec.draw(ctx, SIZE, baseColourHex);
  const texture = new THREE.CanvasTexture(canvas);
  // The canvas is painted with sRGB hex strings, so it must be DECLARED sRGB.
  //
  // Without this three treats the bytes as linear and the renderer encodes them
  // to sRGB on the way out, so every textured surface comes back at roughly the
  // square root of its real value — nearly twice as bright. #4a4a4e granite
  // (74) rendered at 147: a dark stone floor arriving as light grey. It looked
  // like a lighting problem and survived two rounds of tuning the lights, which
  // is exactly what a colour-space bug does. The control is flat-coloured
  // furniture: it uses THREE.Color, which is converted correctly, and it always
  // landed on its catalogue value.
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  cache.set(key, texture);
  return texture;
}

/**
 * Scale a geometry's UVs so its texture repeats at the material's real module.
 *
 * `spanUmm` and `spanVmm` are the real sizes that the geometry's OWN UV range
 * 0..1 covers — not necessarily the size of the face. The two geometries in use
 * disagree about this, and getting it wrong is what makes a tiled floor look
 * like wallpaper:
 *
 *   - `BoxGeometry` gives every face UV 0..1, so the span is the face's own size
 *     (a 6 m wall passes 6000).
 *   - `ShapeGeometry` writes the vertex position straight into the UV, and the
 *     shapes here are built in metres, so UV 0..1 covers exactly one metre
 *     whatever the room's size (every room passes 1000).
 *
 * U and V are scaled separately because a wall is not square: a 6 m x 2.7 m wall
 * given one figure gets 600 mm tiles across and 270 mm tiles up.
 */
export function tileUVs(
  geometry: THREE.BufferGeometry,
  spanUmm: number,
  spanVmm: number,
  moduleMm: number,
): void {
  const uv = geometry.getAttribute('uv');
  if (!uv || moduleMm <= 0) return;
  // Fractional scales are the normal case, not an edge case: a 1,200 mm module
  // on a one-metre UV span is 0.83 of a repeat.
  const su = Math.max(0.02, spanUmm / moduleMm);
  const sv = Math.max(0.02, spanVmm / moduleMm);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
}

/** Drop every cached canvas. Call when the scene is torn down. */
export function disposeTextures(): void {
  for (const texture of cache.values()) texture.dispose();
  cache.clear();
}
