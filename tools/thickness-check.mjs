// Compare every imported wall thickness against the thickness the file declares
// in its material layer set. The file is the ground truth.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import * as WebIFC from 'web-ifc';
import { importIfcModel } from '../packages/core/dist/index.js';

const require = createRequire(import.meta.url);
const wasm = join(dirname(require.resolve('web-ifc/package.json')), '/');

for (const file of process.argv.slice(2)) {
  const api = new WebIFC.IfcAPI();
  api.SetWasmPath(wasm, true);
  await api.Init();

  const result = await importIfcModel(new Uint8Array(readFileSync(file)), {
    wasmPath: wasm,
    api,
    constants: {
      IFCUNITASSIGNMENT: WebIFC.IFCUNITASSIGNMENT,
      IFCBUILDINGSTOREY: WebIFC.IFCBUILDINGSTOREY,
      IFCSPACE: WebIFC.IFCSPACE,
      IFCWALL: WebIFC.IFCWALL,
      IFCWALLSTANDARDCASE: WebIFC.IFCWALLSTANDARDCASE,
      IFCDOOR: WebIFC.IFCDOOR,
      IFCWINDOW: WebIFC.IFCWINDOW,
      IFCCOLUMN: WebIFC.IFCCOLUMN,
      IFCSTAIR: WebIFC.IFCSTAIR,
      IFCSLAB: WebIFC.IFCSLAB,
      IFCRELCONTAINEDINSPATIALSTRUCTURE: WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE,
      IFCRELAGGREGATES: WebIFC.IFCRELAGGREGATES,
      IFCRELASSOCIATESMATERIAL: WebIFC.IFCRELASSOCIATESMATERIAL,
    },
  });

  // Read the declared layer-set thickness straight out of the STEP text, so the
  // comparison does not go through any of our own code twice.
  const text = readFileSync(file, 'latin1');
  const layers = new Map();
  for (const m of text.matchAll(/#(\d+)\s*=\s*IFCMATERIALLAYER\s*\(([^)]*)\)/gi)) {
    const parts = m[2].split(',');
    const thickness = Number(parts[1]);
    if (Number.isFinite(thickness)) layers.set(Number(m[1]), thickness);
  }
  const sets = new Map();
  for (const m of text.matchAll(/#(\d+)\s*=\s*IFCMATERIALLAYERSET\s*\(\s*\(([^)]*)\)/gi)) {
    const total = m[2]
      .split(',')
      .map((r) => layers.get(Number(r.trim().replace('#', ''))) ?? 0)
      .reduce((a, b) => a + b, 0);
    if (total > 0) sets.set(Number(m[1]), total);
  }
  const declared = [...sets.values()];

  const walls = result.floors.flatMap((f) => f.walls);
  const thicknesses = [...new Set(walls.map((w) => Math.round(w.thickness)))].sort((a, b) => a - b);
  const declaredSet = [...new Set(declared.map((d) => Math.round(d * 1000)))].sort((a, b) => a - b);

  const unmatched = thicknesses.filter((t) => !declaredSet.some((d) => Math.abs(d - t) <= 1));

  console.log(`\n### ${file.split('/').pop()}`);
  console.log(`  walls imported            : ${walls.length}`);
  console.log(`  distinct thicknesses used : ${thicknesses.join(', ')} mm`);
  console.log(`  declared in layer sets    : ${declaredSet.join(', ')} mm`);
  console.log(
    `  ${unmatched.length === 0 ? 'PASS' : 'CHECK'} — ${unmatched.length} imported thickness(es) not declared anywhere` +
      (unmatched.length ? `: ${unmatched.join(', ')}` : ''),
  );
}
