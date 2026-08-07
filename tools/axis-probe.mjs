import * as WebIFC from 'web-ifc';
import { readFileSync } from 'node:fs';
const api = new WebIFC.IfcAPI();
api.SetWasmPath('./node_modules/web-ifc/', true);
await api.Init();
const id = api.OpenModel(new Uint8Array(readFileSync(process.argv[2])));
const ids = (t) => { const v = api.GetLineIDsWithType(id, t); return Array.from({length:v.size()},(_,i)=>v.get(i)); };
const str = (v)=> (v&&typeof v==='object'&&typeof v.value==='string')?v.value:null;

const walls = [...ids(WebIFC.IFCWALLSTANDARDCASE), ...ids(WebIFC.IFCWALL)];
let withAxis=0, withoutAxis=0; const samples=[];
for (const w of walls) {
  try {
    const line = api.GetLine(id, w);
    const repId = line.Representation?.value; if (!repId) { withoutAxis++; continue; }
    const prod = api.GetLine(id, repId);
    let found=null;
    for (const r of (prod.Representations||[])) {
      const sr = api.GetLine(id, r.value);
      if (str(sr.RepresentationIdentifier) === 'Axis') { found = sr; break; }
    }
    if (!found) { withoutAxis++; continue; }
    withAxis++;
    if (samples.length < 3) {
      const item = api.GetLine(id, found.Items[0].value, true);
      samples.push({ name: (str(line.Name)||'').slice(0,40), repType: str(found.RepresentationType),
        itemType: item.type, item: JSON.stringify(item).slice(0, 420) });
    }
  } catch(e) { withoutAxis++; }
}
console.log(`walls=${walls.length} withAxis=${withAxis} withoutAxis=${withoutAxis}`);
for (const s of samples) console.log(`\n  ${s.name} | ${s.repType}\n  ${s.item}`);
api.CloseModel(id);
