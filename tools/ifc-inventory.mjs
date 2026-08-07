// Inventory IFC files: what entities each contains, so real buildings can be
// told apart from unit-test fragments.
import * as WebIFC from 'web-ifc';
import { readFileSync, statSync } from 'node:fs';

const files = process.argv.slice(2);
const api = new WebIFC.IfcAPI();
api.SetWasmPath('./node_modules/web-ifc/', true);
await api.Init();

const TYPES = {
  storey: WebIFC.IFCBUILDINGSTOREY, space: WebIFC.IFCSPACE,
  wall: WebIFC.IFCWALL, wallStd: WebIFC.IFCWALLSTANDARDCASE,
  door: WebIFC.IFCDOOR, window: WebIFC.IFCWINDOW,
  slab: WebIFC.IFCSLAB, column: WebIFC.IFCCOLUMN, stair: WebIFC.IFCSTAIR,
  railing: WebIFC.IFCRAILING, furnishing: WebIFC.IFCFURNISHINGELEMENT,
};

console.log(['file','MB','schema','storey','space','wall','door','window','slab','column','stair'].join('\t'));
for (const f of files) {
  let id = -1;
  try {
    const data = new Uint8Array(readFileSync(f));
    id = api.OpenModel(data, { COORDINATE_TO_ORIGIN: false });
    const schema = api.GetModelSchema(id);
    const c = {};
    for (const [k, t] of Object.entries(TYPES)) {
      try { c[k] = api.GetLineIDsWithType(id, t).size(); } catch { c[k] = 0; }
    }
    const walls = (c.wall || 0) + (c.wallStd || 0);
    console.log([
      f.split('/').pop(), (statSync(f).size/1048576).toFixed(1), schema,
      c.storey, c.space, walls, c.door, c.window, c.slab, c.column, c.stair,
    ].join('\t'));
  } catch (e) {
    console.log([f.split('/').pop(), '?', 'ERROR', e.message.slice(0,40)].join('\t'));
  } finally { if (id >= 0) try { api.CloseModel(id); } catch {} }
}
