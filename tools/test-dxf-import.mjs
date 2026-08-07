// DXF -> LineWork -> recogniseFloor -> materialise -> takeoff, end to end.
import { readFileSync } from 'node:fs';
import { extractDxfLineWork, recogniseFloor, materialise, computeTakeoff, allFloors, polygonArea } from '../packages/core/dist/index.js';

for (const file of process.argv.slice(2)) {
  const name = file.split('/').pop();
  try {
    const text = readFileSync(file, 'latin1');
    const { work, issues } = extractDxfLineWork(text);
    if (!work) { console.log(`\n### ${name}\n  NO LINEWORK: ${issues.map(i=>i.message).join('; ').slice(0,140)}`); continue; }

    console.log(`\n### ${name}`);
    console.log(`  linework: segments=${work.segments.length} arcs=${work.arcs.length} texts=${work.texts.length}`);
    console.log(`  units: ${work.units.unit} (${work.units.source}, confident=${work.units.confident}) scale=${work.toMmScale}`);
    console.log(`  extent: ${(work.extent.maxX-work.extent.minX).toFixed(0)} x ${(work.extent.maxY-work.extent.minY).toFixed(0)} source units`);
    for (const i of issues.filter(x=>x.severity!=='info').slice(0,2)) console.log(`  issue[${i.severity}]: ${i.message.slice(0,110)}`);

    const r = recogniseFloor(work, { floorName: name });
    if (!r.floor) { console.log(`  RECOGNISE FAILED: ${r.issues.filter(i=>i.severity==='blocking').map(i=>i.message).join('; ').slice(0,140)}`); continue; }

    const area = r.floor.rooms.reduce((s,x)=>s+polygonArea(x.boundary),0)/92903.04;
    console.log(`  recognised: rooms=${r.stats.roomCount} walls=${r.stats.wallCount} openings=${r.stats.openingCount} in ${r.stats.parseMs}ms`);
    console.log(`  area = ${area.toFixed(0)} sq ft (${(area*0.092903).toFixed(0)} m²)`);
    const sk = Object.entries(r.stats.skipped).filter(([,v])=>v>0);
    if (sk.length) console.log(`  detail: ${sk.map(([k,v])=>`${k}=${v}`).join(', ')}`);
    const named = r.floor.rooms.filter(x=>x.name!=='Room').slice(0,6);
    if (named.length) console.log(`  named rooms: ${named.map(x=>`${x.name} ${(polygonArea(x.boundary)/92903.04).toFixed(0)}sf`).join(' | ')}`);
    for (const i of r.issues.filter(x=>x.severity==='review').slice(0,3)) console.log(`  review: ${i.message.slice(0,110)}`);

    const m = materialise({ name, buildingType:'office', location:{city:'Islamabad',country:'Pakistan',authority:'CDA'}, displayUnit:'ft', floors:[r.floor] }, new Date().toISOString());
    const to = computeTakeoff(allFloors(m.project));
    console.log(`  -> twin: ${allFloors(m.project).length} floor(s), takeoff ${to.summary.grossFloorAreaSqft.toFixed(0)} sqft, ${to.lines.length} lines, ${m.issues.length} issue(s)`);
  } catch (e) {
    console.log(`\n### ${name}\n  CRASH: ${e.message}\n    ${e.stack?.split('\n')[1]?.trim()}`);
  }
}
