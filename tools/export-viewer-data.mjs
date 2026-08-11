/**
 * Export the built tower as compact JSON for the standalone 3D viewer.
 *
 * The walkthrough in the app is the real renderer; this is a way to LOOK at the
 * same model without installing anything. It carries geometry only — room
 * polygons, wall boxes, furniture boxes, colours — and no rates, no prices and
 * no supplier names, because the file gets published as a web page.
 *
 *   node tools/export-viewer-data.mjs > docs/viewer-data.json
 */

import * as core from '../packages/core/dist/index.js';
import { towerFloors } from './tower-model.mjs';
import { towerDesign, GROUND_CONCEPTS } from './tower-design.mjs';

const MM = 0.001;
const r2 = (n) => Math.round(n * 100) / 100;

function build(concept) {
  const built = core.materialise(
    {
      name: 'Atlas Geospatial',
      buildingType: 'commercial_plaza',
      location: { city: 'Islamabad', country: 'Pakistan', authority: 'CDA' },
      displayUnit: 'ft',
      floors: towerFloors(),
    },
    '2026-01-01T00:00:00.000Z',
  );
  const floors = built.project.architecture.site.buildings.flatMap((b) => b.floors);
  const design = towerDesign(floors, { projectId: built.project.id, concept });
  const byRoom = new Map(design.rooms.map((rd) => [rd.roomId, rd]));

  return floors.map((floor) => ({
    name: floor.name,
    level: floor.level,
    purpose: floor.purpose ?? '',
    elevation: r2(floor.elevation * MM),
    height: r2(floor.floorToFloor * MM),
    rooms: floor.rooms.map((room) => {
      const rd = byRoom.get(room.id);
      const finish = rd?.finishes.find((f) => f.surface === 'floor');
      const spec = finish ? core.findMaterial(finish.materialId) : undefined;
      return {
        name: room.name,
        use: room.use,
        // Plan Y maps to scene -Z, exactly as the app's walkthrough does it.
        poly: room.boundary.map((p) => [r2(p.x * MM), r2(-p.y * MM)]),
        h: r2(room.clearHeight * MM),
        colour: spec?.appearance?.baseColorHex ?? '#9aa3ad',
        area: Math.round(core.polygonArea(room.boundary) / 92903.04),
      };
    }),
    walls: floor.walls.map((w) => ({
      a: [r2(w.start.x * MM), r2(-w.start.y * MM)],
      b: [r2(w.end.x * MM), r2(-w.end.y * MM)],
      t: r2(w.thickness * MM),
      h: r2(w.height * MM),
      ext: w.function === 'exterior',
      // Openings, so the glazing and the doors are holes and not paint.
      o: w.openings.map((op) => ({
        d: r2(op.distanceAlongWall * MM),
        w: r2(op.width * MM),
        h: r2(op.height * MM),
        s: r2(op.sillHeight * MM),
        g: op.kind === 'window',
      })),
    })),
    items: floor.rooms.flatMap((room) =>
      (byRoom.get(room.id)?.furniture ?? []).map((f) => {
        const spec = core.findFurniture(f.catalogueKey);
        return {
          k: f.catalogueKey,
          l: f.label,
          p: [r2(f.position.x * MM), r2(-f.position.y * MM)],
          w: r2(f.width * MM),
          d: r2(f.depth * MM),
          h: r2(f.height * MM),
          r: f.rotationDeg,
          c: spec?.placeholderColorHex ?? '#8892a0',
        };
      }),
    ),
  }));
}

const concepts = Object.entries(GROUND_CONCEPTS).map(([id, c]) => ({ id, label: c.label }));
const out = {
  project: 'Atlas Geospatial — Islamabad',
  note: 'Geometry only. No rates, no prices, no supplier names.',
  totalHeightFt: 77.25,
  concepts,
  byConcept: Object.fromEntries(concepts.map((c) => [c.id, build(c.id)])),
};
process.stdout.write(JSON.stringify(out));
