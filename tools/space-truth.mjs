// Compare imported room areas against the area the IFC file itself declares in
// Qto_SpaceBaseQuantities. That is ground truth written by the authoring tool.
import * as WebIFC from 'web-ifc';
import { readFileSync } from 'node:fs';
import { importIfcModel, polygonArea } from '../packages/core/dist/index.js';
const C = { IFCUNITASSIGNMENT:WebIFC.IFCUNITASSIGNMENT, IFCBUILDINGSTOREY:WebIFC.IFCBUILDINGSTOREY,
  IFCSPACE:WebIFC.IFCSPACE, IFCWALL:WebIFC.IFCWALL, IFCWALLSTANDARDCASE:WebIFC.IFCWALLSTANDARDCASE,
  IFCDOOR:WebIFC.IFCDOOR, IFCWINDOW:WebIFC.IFCWINDOW, IFCCOLUMN:WebIFC.IFCCOLUMN, IFCSTAIR:WebIFC.IFCSTAIR,
  IFCSLAB:WebIFC.IFCSLAB, IFCRELCONTAINEDINSPATIALSTRUCTURE:WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE,
  IFCRELAGGREGATES:WebIFC.IFCRELAGGREGATES, IFCRELASSOCIATESMATERIAL:WebIFC.IFCRELASSOCIATESMATERIAL };

const api = new WebIFC.IfcAPI(); api.SetWasmPath('./node_modules/web-ifc/', true); await api.Init();
const file = process.argv[2];
const data = new Uint8Array(readFileSync(file));

// --- declared areas from the quantity sets ---
const id = api.OpenModel(data);
const ids=(t)=>{const v=api.GetLineIDsWithType(id,t);return Array.from({length:v.size()},(_,i)=>v.get(i));};
const num=(v)=>{if(v==null)return null;if(typeof v==='number')return v;if(typeof v==='object'){
  if(typeof v._representationValue==='number')return v._representationValue;
  if(typeof v._internalValue==='string'){const n=Number(v._internalValue.replace(/\.$/,''));return Number.isFinite(n)?n:null;}
  if(typeof v.value==='number')return v.value;}return null;};
const str=(v)=>(v&&typeof v==='object'&&typeof v.value==='string')?v.value:null;

const declared = new Map(); // globalId -> m2
for (const r of ids(WebIFC.IFCRELDEFINESBYPROPERTIES)) {
  try {
    const rel = api.GetLine(id, r);
    const defId = rel.RelatingPropertyDefinition?.value; if (!defId) continue;
    const def = api.GetLine(id, defId, true);
    if (!Array.isArray(def.Quantities)) continue;
    let area = null;
    for (const q of def.Quantities) {
      const n = str(q.Name) || '';
      if (/GrossFloorArea|NetFloorArea/i.test(n)) { const a = num(q.AreaValue); if (a) { if (/Gross/i.test(n) || area===null) area = a; } }
    }
    if (area === null) continue;
    for (const o of (rel.RelatedObjects||[])) {
      if (!o?.value) continue;
      try { const gid = str(api.GetLine(id, o.value).GlobalId); if (gid) declared.set(gid, area); } catch {}
    }
  } catch {}
}
api.CloseModel(id);

const r = await importIfcModel(data, { api, constants: C, wasmPath: './node_modules/web-ifc/' });
console.log(`${file.split('/').pop()}  declaredQuantities=${declared.size}`);
if (declared.size === 0) { console.log('  (file carries no space quantity sets — no in-file ground truth)'); process.exit(0); }

let n=0, sumErr=0, worst=null, matched=0;
console.log('  imported_m2  declared_m2   err%   room');
for (const f of r.floors) for (const room of f.rooms) {
  const gid = room.sourceRef;
  const d = declared.get(gid); if (d === undefined) continue;
  const imported = polygonArea(room.boundary)/1e6;
  const err = d > 0 ? (imported - d)/d*100 : 0;
  matched++; sumErr += Math.abs(err);
  if (!worst || Math.abs(err) > Math.abs(worst.err)) worst = { err, name: room.name, imported, d };
  if (n++ < 12) console.log(`  ${imported.toFixed(1).padStart(10)}  ${d.toFixed(1).padStart(10)}  ${err.toFixed(1).padStart(6)}   ${room.name}`);
}
console.log(`  matched ${matched} rooms, mean |error| = ${(sumErr/Math.max(matched,1)).toFixed(1)}%`);
if (worst) console.log(`  worst: ${worst.name} imported ${worst.imported.toFixed(1)} vs declared ${worst.d.toFixed(1)} m² (${worst.err.toFixed(1)}%)`);
