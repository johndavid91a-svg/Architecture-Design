/**
 * Drive the real main-process import entry point.
 *
 * The other harnesses call the core importers directly, which is why a broken
 * wasm path in the Electron main process survived every one of them: the bug was
 * in the wiring, not in the code being wired. This one imports the built main
 * bundle and calls `importDrawingFile` exactly as the IPC handler does, so the
 * path the user's first click takes is the path that gets tested.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
let failures = 0;

// The built main bundle is CommonJS and pulls in `electron`, which is not
// available outside an Electron process. Only the import module is wanted, so
// it is loaded from source through the same resolution the bundle uses.
const { importDrawingFile } = await import(
  pathToFileURL('/home/user/Architecture-Design/packages/desktop/dist-test/drawing-import.js').href
);

function report(label, ok, detail) {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}

const P = '/home/user/samples/wifc/tests/ifcfiles/public';
const D = '/home/user/samples/dxf-bjnortier/test/resources';

console.log('MAIN-PROCESS IMPORT PATH\n' + '='.repeat(70));

console.log('\n### IFC through the main process');
const ifc = await importDrawingFile(`${P}/AC20-FZK-Haus.ifc`);
report('does not throw resolving the web-ifc wasm', ifc.ok, ifc.issues?.[0]?.message ?? '');
report('reads both storeys', ifc.floors.length === 2, `${ifc.floors.length} floors`);
report(
  'reads the seven rooms',
  ifc.floors.reduce((n, f) => n + f.rooms.length, 0) === 7,
);
report('reports the schema', ifc.schema === 'IFC4', String(ifc.schema));

console.log('\n### DXF through the main process');
const dxf = await importDrawingFile(`${D}/entities.dxf`);
report('parses without throwing', Array.isArray(dxf.floors), '');
report('produces a floor', dxf.floors.length === 1, `${dxf.floors.length} floors`);

console.log('\n### A drawing at the wrong scale');
const bad = await importDrawingFile(`${D}/floorplan.dxf`);
report(
  'refuses rather than measuring it',
  !bad.ok && bad.issues.some((i) => i.severity === 'blocking'),
  bad.issues.find((i) => i.severity === 'blocking')?.code ?? 'no blocking issue',
);

console.log('\n### An unsupported file');
const wrong = await importDrawingFile('/etc/hostname');
report('rejects it with a comprehensible message', !wrong.ok && wrong.issues.length > 0,
  wrong.issues[0]?.message ?? '');

console.log('\n### A file that is not there');
const missing = await importDrawingFile('/home/user/does-not-exist.ifc');
report('reports it instead of throwing', !missing.ok && missing.issues.length > 0,
  missing.issues[0]?.message ?? '');

console.log('\n' + '='.repeat(70));
console.log(failures === 0 ? 'ALL MAIN-PROCESS CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
