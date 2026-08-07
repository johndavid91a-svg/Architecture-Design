// Do the recognised wall runs sit collinear with door-sized gaps between them?
// If a plan draws its walls interrupted at every opening, the centrelines come
// out in pieces and no room ever closes.
import { readFileSync } from 'node:fs';
import { extractDxfLineWork, recogniseFloor } from '../packages/core/dist/index.js';

for (const file of process.argv.slice(2)) {
  const { work } = extractDxfLineWork(readFileSync(file, 'latin1'));
  if (!work) continue;
  const { floor } = recogniseFloor(work);
  if (!floor) continue;

  const walls = floor.walls.map((w) => {
    const dx = w.end.x - w.start.x;
    const dy = w.end.y - w.start.y;
    const len = Math.hypot(dx, dy) || 1;
    let ux = dx / len;
    let uy = dy / len;
    if (ux < 0 || (Math.abs(ux) < 1e-9 && uy < 0)) {
      ux = -ux;
      uy = -uy;
    }
    return { w, ux, uy, len, offset: -w.start.x * uy + w.start.y * ux };
  });

  const gaps = [];
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const a = walls[i];
      const b = walls[j];
      if (Math.abs(a.ux * b.uy - a.uy * b.ux) > 0.035) continue; // ~2 deg
      if (Math.abs(a.offset - b.offset) > 60) continue;
      // Both project onto the same line; measure the gap between the intervals.
      const t = (p) => p.x * a.ux + p.y * a.uy;
      const ai = [t(a.w.start), t(a.w.end)].sort((x, y) => x - y);
      const bi = [t(b.w.start), t(b.w.end)].sort((x, y) => x - y);
      const gap = bi[0] > ai[1] ? bi[0] - ai[1] : ai[0] > bi[1] ? ai[0] - bi[1] : 0;
      if (gap > 1 && gap < 4000) gaps.push(Math.round(gap));
    }
  }

  gaps.sort((x, y) => x - y);
  const buckets = new Map();
  for (const g of gaps) {
    const b = Math.floor(g / 250) * 250;
    buckets.set(b, (buckets.get(b) ?? 0) + 1);
  }
  console.log(`\n### ${file.split('/').pop()}`);
  console.log(`  walls=${floor.walls.length} rooms=${floor.rooms.length}`);
  console.log(`  collinear pairs with a gap under 4 m: ${gaps.length}`);
  for (const [b, n] of [...buckets].sort((p, q) => p[0] - q[0])) {
    console.log(`    ${b}-${b + 249} mm : ${'#'.repeat(Math.min(n, 60))} ${n}`);
  }
}
