// Run the IFC importer over real reference models and report what it produced,
// so the numbers can be compared against the buildings they came from.
import * as WebIFC from 'web-ifc';
import { readFileSync } from 'node:fs';
import { importIfcModel, materialise, computeTakeoff, allFloors, polygonArea } from '../packages/core/dist/index.js';

const CONSTANTS = {
  IFCUNITASSIGNMENT: WebIFC.IFCUNITASSIGNMENT, IFCBUILDINGSTOREY: WebIFC.IFCBUILDINGSTOREY,
  IFCSPACE: WebIFC.IFCSPACE, IFCWALL: WebIFC.IFCWALL, IFCWALLSTANDARDCASE: WebIFC.IFCWALLSTANDARDCASE,
  IFCDOOR: WebIFC.IFCDOOR, IFCWINDOW: WebIFC.IFCWINDOW, IFCCOLUMN: WebIFC.IFCCOLUMN,
  IFCSTAIR: WebIFC.IFCSTAIR, IFCSLAB: WebIFC.IFCSLAB,
  IFCRELCONTAINEDINSPATIALSTRUCTURE: WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE,
  IFCRELAGGREGATES: WebIFC.IFCRELAGGREGATES, IFCRELASSOCIATESMATERIAL: WebIFC.IFCRELASSOCIATESMATERIAL,
};

const api = new WebIFC.IfcAPI();
api.SetWasmPath('./node_modules/web-ifc/', true);
await api.Init();

for (const file of process.argv.slice(2)) {
  const name = file.split('/').pop();
  try {
    const t0 = Date.now();
    const r = await importIfcModel(new Uint8Array(readFileSync(file)), { api, constants: CONSTANTS, wasmPath: './node_modules/web-ifc/' });
    const ms = Date.now() - t0;

    const blocking = r.issues.filter(i => i.severity === 'blocking');
    if (blocking.length) { console.log(`\n### ${name}\n  BLOCKED: ${blocking.map(b=>b.message).join('; ')}`); continue; }

    const areaSqft = r.floors.reduce((a,f)=>a+f.rooms.reduce((s,x)=>s+polygonArea(x.boundary),0),0)/92903.04;
    const wallRunM = r.floors.reduce((a,f)=>a+f.walls.reduce((s,w)=>s+Math.hypot(w.end.x-w.start.x,w.end.y-w.start.y),0),0)/1000;
    const th = r.floors.flatMap(f=>f.walls.map(w=>w.thickness)).sort((a,b)=>a-b);
    const med = th.length ? th[Math.floor(th.length/2)] : 0;

    console.log(`\n### ${name}  [${r.schema}] ${ms}ms`);
    console.log(`  units: ${r.units.unit} (${r.units.source}, confident=${r.units.confident})`);
    console.log(`  floors=${r.stats.floorCount} rooms=${r.stats.roomCount} walls=${r.stats.wallCount} openings=${r.stats.openingCount}`);
    console.log(`  gross area = ${areaSqft.toFixed(0)} sq ft (${(areaSqft*0.092903).toFixed(0)} m²)`);
    console.log(`  wall run = ${wallRunM.toFixed(1)} m, median thickness = ${med.toFixed(0)} mm`);
    for (const f of r.floors) {
      const fa = f.rooms.reduce((s,x)=>s+polygonArea(x.boundary),0)/92903.04;
      console.log(`    L${String(f.level).padStart(2)} "${f.name}" elev=${(f.elevation/1000).toFixed(2)}m f2f=${(f.floorToFloor/1000).toFixed(2)}m rooms=${String(f.rooms.length).padStart(3)} walls=${String(f.walls.length).padStart(3)} area=${fa.toFixed(0)}sqft`);
    }
    const rooms = r.floors.flatMap(f=>f.rooms).map(x=>({n:x.name,a:polygonArea(x.boundary)/92903.04})).sort((a,b)=>b.a-a.a);
    console.log(`  largest rooms: ${rooms.slice(0,5).map(x=>`${x.n} ${x.a.toFixed(0)}sf`).join(' | ')}`);
    const sk = Object.entries(r.stats.skipped).filter(([k])=>!k.includes('not yet'));
    if (sk.length) console.log(`  skipped: ${sk.map(([k,v])=>`${k}=${v}`).join(', ')}`);
    const rev = r.issues.filter(i=>i.severity==='review');
    if (rev.length) console.log(`  review: ${rev.map(i=>i.message.slice(0,90)).join(' | ')}`);

    // Materialise into a real twin and run the takeoff — the whole pipeline.
    const m = materialise({ name, buildingType: 'office', location: { city: 'Islamabad', country: 'Pakistan', authority: 'CDA' }, displayUnit: 'ft', floors: r.floors }, new Date().toISOString());
    const to = computeTakeoff(allFloors(m.project));
    console.log(`  -> twin: ${allFloors(m.project).length} floors, takeoff ${to.summary.grossFloorAreaSqft.toFixed(0)} sqft, ${to.lines.length} lines, ${m.issues.length} materialise issue(s)`);
    if (m.issues.length) {
      const byCode = {}; for (const i of m.issues) byCode[i.code] = (byCode[i.code]??0)+1;
      console.log(`     issues: ${Object.entries(byCode).map(([k,v])=>`${k}×${v}`).join(', ')}`);
    }
  } catch (e) {
    console.log(`\n### ${name}\n  CRASH: ${e.message}\n${e.stack?.split('\n').slice(1,4).join('\n')}`);
  }
}
