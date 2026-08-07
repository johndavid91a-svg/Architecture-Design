// Compare derived wall thickness against the thickness the IFC file itself
// declares, via the material layer set. That is ground truth inside the file.
import * as WebIFC from 'web-ifc';
import { readFileSync } from 'node:fs';
const api = new WebIFC.IfcAPI();
api.SetWasmPath('./node_modules/web-ifc/', true);
await api.Init();
const id = api.OpenModel(new Uint8Array(readFileSync(process.argv[2])));
const ids = (t) => { const v = api.GetLineIDsWithType(id, t); return Array.from({length: v.size()}, (_, i) => v.get(i)); };
const num = (v) => { if (v==null) return null; if (typeof v==='number') return v;
  if (typeof v==='object'){ if(typeof v._representationValue==='number') return v._representationValue;
  if(typeof v._internalValue==='string'){const n=Number(v._internalValue.replace(/\.$/,''));return Number.isFinite(n)?n:null;}
  if(typeof v.value==='number') return v.value; } return null; };
const str = (v) => (v && typeof v==='object' && typeof v.value==='string') ? v.value : null;

// Map wall -> declared layer thickness via IfcRelAssociatesMaterial
const declared = new Map();
for (const r of ids(WebIFC.IFCRELASSOCIATESMATERIAL)) {
  try {
    const rel = api.GetLine(id, r);
    const matId = rel.RelatingMaterial?.value;
    if (!matId) continue;
    const mat = api.GetLine(id, matId, true);
    let total = null;
    const collect = (m) => {
      if (!m) return;
      if (Array.isArray(m.MaterialLayers)) total = m.MaterialLayers.reduce((s,l)=>s+(num(l.LayerThickness)||0),0);
      if (m.ForLayerSet) collect(m.ForLayerSet);
      if (m.MaterialLayerSet) collect(m.MaterialLayerSet);
    };
    collect(mat);
    if (total) for (const o of (rel.RelatedObjects||[])) if (o?.value) declared.set(o.value, total);
  } catch {}
}

// Derived thickness via the same min-area-rectangle the importer uses
const hull = (pts) => { if (pts.length<3) return pts;
  const s=[...pts].sort((p,q)=>p.x===q.x?p.y-q.y:p.x-q.x); const cr=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
  const lo=[]; for(const p of s){while(lo.length>=2&&cr(lo[lo.length-2],lo[lo.length-1],p)<=0)lo.pop();lo.push(p);}
  const up=[]; for(let i=s.length-1;i>=0;i--){const p=s[i];while(up.length>=2&&cr(up[up.length-2],up[up.length-1],p)<=0)up.pop();up.push(p);}
  lo.pop();up.pop();return [...lo,...up]; };
const minRect = (pts) => { const h=hull(pts); if(h.length<2) return null; let best=null,ba=Infinity;
  for(let i=0;i<h.length;i++){const a=h[i],b=h[(i+1)%h.length];const dx=b.x-a.x,dy=b.y-a.y,L=Math.hypot(dx,dy);if(L<1e-9)continue;
    const ux=dx/L,uy=dy/L;let mu=1/0,Mu=-1/0,mv=1/0,Mv=-1/0;
    for(const p of h){const u=p.x*ux+p.y*uy,v=-p.x*uy+p.y*ux;mu=Math.min(mu,u);Mu=Math.max(Mu,u);mv=Math.min(mv,v);Mv=Math.max(Mv,v);}
    const w=Mu-mu,ht=Mv-mv,ar=w*ht; if(ar<ba){ba=ar;best={length:Math.max(w,ht),width:Math.min(w,ht)};}}
  return best; };

const tris = (eid) => { const out=[]; let mesh; try{mesh=api.GetFlatMesh(id,eid);}catch{return out;}
  for(let g=0;g<mesh.geometries.size();g++){const pg=mesh.geometries.get(g);const m=pg.flatTransformation;
    let geo;try{geo=api.GetGeometry(id,pg.geometryExpressID);}catch{continue;}
    const V=api.GetVertexArray(geo.GetVertexData(),geo.GetVertexDataSize());
    const I=api.GetIndexArray(geo.GetIndexData(),geo.GetIndexDataSize());
    const at=(i)=>{const o=i*6,x=V[o],y=V[o+1],z=V[o+2];
      return [m[0]*x+m[4]*y+m[8]*z+m[12], m[1]*x+m[5]*y+m[9]*z+m[13], m[2]*x+m[6]*y+m[10]*z+m[14]];};
    for(let i=0;i+2<I.length;i+=3) out.push([at(I[i]),at(I[i+1]),at(I[i+2])]);
    geo.delete?.(); }
  return out; };

const walls = [...ids(WebIFC.IFCWALLSTANDARDCASE), ...ids(WebIFC.IFCWALL)];
console.log('geoms\tdeclared\tderived_all\tderived_bottom\tname');
let n=0;
for (const w of walls) {
  if (n++ >= 14) break;
  const t = tris(w);
  if (!t.length) { console.log(`0\t-\t-\t-\t(no geometry)`); continue; }
  let minZ=Infinity; for(const tr of t) for(const p of tr) minZ=Math.min(minZ,p[2]);
  const all=[], bottom=[];
  for(const tr of t) for(const p of tr){ all.push({x:p[0],y:p[1]}); if(p[2]<=minZ+0.05) bottom.push({x:p[0],y:p[1]}); }
  const ra=minRect(all), rb=minRect(bottom.length>2?bottom:all);
  const line = api.GetLine(id, w);
  const mesh = api.GetFlatMesh(id, w);
  console.log(`${mesh.geometries.size()}\t${declared.has(w)?(declared.get(w)*1000).toFixed(0):'-'}\t${ra?(ra.width*1000).toFixed(0):'-'}\t${rb?(rb.width*1000).toFixed(0):'-'}\t${(str(line.Name)||'').slice(0,52)}`);
}
api.CloseModel(id);
