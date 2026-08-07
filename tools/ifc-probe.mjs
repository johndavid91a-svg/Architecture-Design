import * as WebIFC from 'web-ifc';
import { readFileSync } from 'node:fs';
const api = new WebIFC.IfcAPI();
api.SetWasmPath('./node_modules/web-ifc/', true);
await api.Init();
const id = api.OpenModel(new Uint8Array(readFileSync(process.argv[2])));

const ids = (t) => { const v = api.GetLineIDsWithType(id, t); return Array.from({length: v.size()}, (_, i) => v.get(i)); };
const show = (label, obj, depth = 0) => console.log(label, JSON.stringify(obj, (k, v) => typeof v === 'bigint' ? String(v) : v, depth ? 2 : 0).slice(0, 1400));

console.log('=== UNITS ===');
for (const u of ids(WebIFC.IFCUNITASSIGNMENT)) show('unitAssignment', api.GetLine(id, u, true));
console.log('\n=== STOREY (first) ===');
const st = ids(WebIFC.IFCBUILDINGSTOREY);
console.log('count', st.length);
if (st[0]) show('storey', api.GetLine(id, st[0]));
console.log('\n=== WALL (first) ===');
const walls = [...ids(WebIFC.IFCWALLSTANDARDCASE), ...ids(WebIFC.IFCWALL)];
console.log('count', walls.length);
if (walls[0]) show('wall', api.GetLine(id, walls[0]));
console.log('\n=== SPACE (first) ===');
const sp = ids(WebIFC.IFCSPACE);
console.log('count', sp.length);
if (sp[0]) show('space', api.GetLine(id, sp[0]));
console.log('\n=== REL CONTAINED ===');
const rc = ids(WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE);
console.log('count', rc.length);
if (rc[0]) show('relContained', api.GetLine(id, rc[0]));
console.log('\n=== FLAT MESH of first wall ===');
if (walls[0]) {
  const fm = api.GetFlatMesh(id, walls[0]);
  console.log('expressID', fm.expressID, 'geometries', fm.geometries.size());
  if (fm.geometries.size() > 0) {
    const g = fm.geometries.get(0);
    console.log('placedGeom keys:', Object.keys(g));
    console.log('flatTransformation len:', g.flatTransformation?.length);
    const geo = api.GetGeometry(id, g.geometryExpressID);
    const verts = api.GetVertexArray(geo.GetVertexData(), geo.GetVertexDataSize());
    console.log('vertex floats:', verts.length, 'sample:', Array.from(verts.slice(0, 12)).map(n=>n.toFixed(3)).join(','));
  }
}
api.CloseModel(id);
