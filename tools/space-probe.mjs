import * as WebIFC from 'web-ifc';
import { readFileSync } from 'node:fs';
const api = new WebIFC.IfcAPI(); api.SetWasmPath('./node_modules/web-ifc/', true); await api.Init();
const id = api.OpenModel(new Uint8Array(readFileSync(process.argv[2])));
const ids=(t)=>{const v=api.GetLineIDsWithType(id,t);return Array.from({length:v.size()},(_,i)=>v.get(i));};
const str=(v)=>(v&&typeof v==='object'&&typeof v.value==='string')?v.value:null;
const num=(v)=>{if(v==null)return null;if(typeof v==='number')return v;if(typeof v==='object'){
  if(typeof v._representationValue==='number')return v._representationValue;
  if(typeof v._internalValue==='string'){const n=Number(v._internalValue.replace(/\.$/,''));return Number.isFinite(n)?n:null;}}return null;};

for (const sp of ids(WebIFC.IFCSPACE).slice(0, 3)) {
  const line = api.GetLine(id, sp);
  console.log(`\n=== SPACE "${str(line.LongName)||str(line.Name)}" (${sp}) ===`);
  const repId = line.Representation?.value;
  if (repId) {
    const prod = api.GetLine(id, repId);
    for (const r of (prod.Representations||[])) {
      const sr = api.GetLine(id, r.value);
      const items = (sr.Items||[]).map(i=>i.value);
      console.log(`  rep "${str(sr.RepresentationIdentifier)}" type="${str(sr.RepresentationType)}" items=${items.length}`);
      for (const it of items.slice(0,1)) {
        const item = api.GetLine(id, it);
        console.log(`     item keys: ${Object.keys(item).join(',')}`);
        if (item.SweptArea?.value) {
          const prof = api.GetLine(id, item.SweptArea.value);
          console.log(`     profile type=${prof.type} keys=${Object.keys(prof).join(',')} XDim=${num(prof.XDim)} YDim=${num(prof.YDim)}`);
          const cid = prof.OuterCurve?.value ?? prof.Curve?.value;
          if (cid) { const c = api.GetLine(id, cid); console.log(`     curve keys=${Object.keys(c).join(',')} points=${(c.Points||[]).length}`); }
        }
        if (item.Depth !== undefined) console.log(`     extrude depth=${num(item.Depth)}`);
      }
    }
  } else console.log('  (no representation)');

  // What web-ifc's mesher produces
  const fm = api.GetFlatMesh(id, sp);
  let nTri = 0, minZ=Infinity, maxZ=-Infinity, minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for (let g=0; g<fm.geometries.size(); g++) {
    const pg = fm.geometries.get(g); const m = pg.flatTransformation;
    const geo = api.GetGeometry(id, pg.geometryExpressID);
    const V = api.GetVertexArray(geo.GetVertexData(), geo.GetVertexDataSize());
    const I = api.GetIndexArray(geo.GetIndexData(), geo.GetIndexDataSize());
    nTri += I.length/3;
    for (let i=0;i<V.length;i+=6){const x=V[i],y=V[i+1],z=V[i+2];
      const wx=m[0]*x+m[4]*y+m[8]*z+m[12], wy=m[1]*x+m[5]*y+m[9]*z+m[13], wz=m[2]*x+m[6]*y+m[10]*z+m[14];
      minX=Math.min(minX,wx);maxX=Math.max(maxX,wx);minY=Math.min(minY,wy);maxY=Math.max(maxY,wy);minZ=Math.min(minZ,wz);maxZ=Math.max(maxZ,wz);}
    geo.delete?.();
  }
  console.log(`  mesh: geoms=${fm.geometries.size()} tris=${nTri} bbox X[${minX.toFixed(2)},${maxX.toFixed(2)}] Y[${minY.toFixed(2)},${maxY.toFixed(2)}] Z[${minZ.toFixed(2)},${maxZ.toFixed(2)}]`);
  console.log(`  bbox area = ${((maxX-minX)*(maxY-minY)).toFixed(1)} m²`);
}
api.CloseModel(id);
