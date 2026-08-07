import * as WebIFC from 'web-ifc';
import { readFileSync } from 'node:fs';
const api = new WebIFC.IfcAPI(); api.SetWasmPath('./node_modules/web-ifc/', true); await api.Init();
const id = api.OpenModel(new Uint8Array(readFileSync(process.argv[2])));
const ids=(t)=>{const v=api.GetLineIDsWithType(id,t);return Array.from({length:v.size()},(_,i)=>v.get(i));};
const str=(v)=>(v&&typeof v==='object'&&typeof v.value==='string')?v.value:null;
const num=(v)=>{if(v==null)return null;if(typeof v==='number')return v;if(typeof v==='object'){
  if(typeof v._representationValue==='number')return v._representationValue;
  if(typeof v._internalValue==='string'){const n=Number(v._internalValue.replace(/\.$/,''));return Number.isFinite(n)?n:null;}}return null;};

// declared unit
for (const u of ids(WebIFC.IFCUNITASSIGNMENT)) {
  const a = api.GetLine(id, u, true);
  for (const e of (a.Units||[])) if (str(e.UnitType)==='LENGTHUNIT') console.log(`declared unit: prefix=${str(e.Prefix)} name=${str(e.Name)}`);
}
// storey elevations (raw file values)
const st = ids(WebIFC.IFCBUILDINGSTOREY).slice(0,4).map(s=>num(api.GetLine(id,s).Elevation));
console.log('storey elevations (raw):', st.map(v=>v===null?'null':v.toFixed(1)).join(', '));

// whole-model mesh bbox
let mn=[1/0,1/0,1/0], mx=[-1/0,-1/0,-1/0], n=0;
const walls=[...ids(WebIFC.IFCWALLSTANDARDCASE),...ids(WebIFC.IFCWALL)];
for (const w of walls.slice(0,80)) {
  const fm=api.GetFlatMesh(id,w);
  for(let g=0;g<fm.geometries.size();g++){const pg=fm.geometries.get(g);const m=pg.flatTransformation;
    const geo=api.GetGeometry(id,pg.geometryExpressID);
    const V=api.GetVertexArray(geo.GetVertexData(),geo.GetVertexDataSize());
    for(let i=0;i<V.length;i+=6){const x=V[i],y=V[i+1],z=V[i+2];
      const p=[m[0]*x+m[4]*y+m[8]*z+m[12], m[1]*x+m[5]*y+m[9]*z+m[13], m[2]*x+m[6]*y+m[10]*z+m[14]];
      for(let k=0;k<3;k++){mn[k]=Math.min(mn[k],p[k]);mx[k]=Math.max(mx[k],p[k]);} n++;}
    geo.delete?.(); }
}
console.log(`mesh bbox over ${walls.slice(0,80).length} walls (${n} verts):`);
console.log(`  X[${mn[0].toFixed(2)},${mx[0].toFixed(2)}] span=${(mx[0]-mn[0]).toFixed(2)}`);
console.log(`  Y[${mn[1].toFixed(2)},${mx[1].toFixed(2)}] span=${(mx[1]-mn[1]).toFixed(2)}   <- Y is UP in web-ifc`);
console.log(`  Z[${mn[2].toFixed(2)},${mx[2].toFixed(2)}] span=${(mx[2]-mn[2]).toFixed(2)}`);
api.CloseModel(id);
