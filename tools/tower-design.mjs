/**
 * The design layer for floors 1 to 4 and the roof garden.
 *
 * `tower-model.mjs` is the architecture — rooms, walls, dimensions, all of it
 * from the sheets — and nothing here may move any of it. This module says what
 * every surface is finished in, how each floor is lit, and what stands on it.
 *
 * It binds by room NAME for the same reason the basement's design does: `RoomId`s
 * are minted inside `materialise()` from `crypto.randomUUID()`, so they differ on
 * every run and a file on disk cannot contain one. Names are matched per storey,
 * because every floor has a KITCHEN and a STAIRS and only the level tells them
 * apart.
 *
 * WHAT EACH FLOOR IS, from the brief:
 *   1  GIS & Mapping        workstations, a map display wall, a terrain model
 *   2  Satellite Imagery    workstations, imagery displays, globe and satellite
 *   3  Data Centre          racks, a monitoring console, plant in the old kitchen
 *   4  Executive Offices    four offices, a boardroom, a lounge
 *   5  Sky Garden           canopy, tea counter, planting, PV over the deck
 *
 * The prayer rooms shown on the reference sheets are NOT here. There is one in
 * the basement and the brief is to use it.
 *
 * Nothing has been checked against CDA bye-laws or any other regulation. The
 * clearances are conventional working dimensions, not code compliance, and the
 * data centre's cooling and power are stated as an MEP question rather than
 * answered.
 */

import { ROOF_BUDGET } from './tower-model.mjs';

const FT = 304.8;
const DEPTH = 45;

/** Feet, south from the north-west corner, to model millimetres. */
const at = (xFt, yFtSouth) => ({
  x: Math.round(xFt * FT),
  y: Math.round((DEPTH - yFtSouth) * FT),
});

/**
 * Catalogue dimensions, mirrored from `packages/core/src/catalogue/furniture.ts`.
 *
 * A `FurniturePlacement` carries its own size and the validator measures the
 * PLACEMENT, so a copy that drifts would be validated against sizes the
 * catalogue no longer has. `tools/tower-layout-check.mjs` compares every field
 * against `findFurniture()` and fails on any difference.
 */
const CATALOGUE = {
  'desk.workstation.1600': { width: 1600, depth: 800, height: 750, clearanceFront: 900 },
  'desk.executive.1800': { width: 1800, depth: 900, height: 750, clearanceFront: 1000 },
  'reception.desk.2400': { width: 2400, depth: 900, height: 1100, clearanceFront: 1200 },
  'chair.task': { width: 620, depth: 620, height: 1150 },
  'chair.executive': { width: 700, depth: 720, height: 1250 },
  'table.conference.8': { width: 2400, depth: 1200, height: 750, clearanceFront: 1200 },
  'table.conference.14': { width: 4200, depth: 1400, height: 750, clearanceFront: 1200 },
  'table.coffee.1200': { width: 1200, depth: 600, height: 400 },
  'seating.sofa.3': { width: 2100, depth: 900, height: 800, clearanceFront: 600 },
  'seating.lounge.chair': { width: 800, depth: 800, height: 750, clearanceFront: 500 },
  'storage.cabinet.1000': { width: 1000, depth: 450, height: 1800, clearanceFront: 750 },
  'display.screen.75': { width: 1680, depth: 80, height: 960 },
  'display.videowall.3x2': { width: 3400, depth: 120, height: 1300 },
  'equipment.rack.42u': { width: 600, depth: 1000, height: 2000, clearanceFront: 1000 },
  'equipment.console.monitoring': { width: 3600, depth: 1400, height: 750, clearanceFront: 1200 },
  'equipment.ups.cabinet': { width: 1600, depth: 800, height: 2000, clearanceFront: 1000 },
  'equipment.crac.unit': { width: 1400, depth: 900, height: 2000, clearanceFront: 1000 },
  'equipment.condenser.roof': { width: 1300, depth: 900, height: 1500, clearanceFront: 1000 },
  'exhibit.plinth.1200': { width: 1200, depth: 1200, height: 900, clearanceFront: 900 },
  'exhibit.model.terrain': { width: 2400, depth: 2400, height: 450, clearanceFront: 900 },
  'decor.planter.large': { width: 600, depth: 600, height: 1400 },
  'counter.servery.3000': { width: 3000, depth: 700, height: 1050, clearanceFront: 900 },
  'seating.stool.bar': { width: 400, depth: 400, height: 750, clearanceFront: 450 },
  'outdoor.louvre.screen': { width: 2900, depth: 102, height: 3350 },
  'outdoor.pergola.4x4': { width: 4000, depth: 4000, height: 2600 },
  'outdoor.planter.trough': { width: 1800, depth: 600, height: 700 },
  'outdoor.solar.panel': { width: 1700, depth: 1130, height: 40 },
};

/** Pairs that are MEANT to share a clearance zone. Anything else is a fault. */
export const EXPECTED_CLEARANCE_SHARING = [
  ['desk.workstation.1600', 'chair.task', 'the chair belongs in the desk’s pull-out'],
  ['desk.executive.1800', 'chair.executive', 'the same, at an executive desk'],
  ['table.conference.8', 'chair.task', 'chairs stand at the table they serve'],
  ['table.conference.14', 'chair.executive', 'the same, in the boardroom'],
  ['seating.sofa.3', 'table.coffee.1200', 'a coffee table sits in the sofa’s leg room'],
  ['counter.servery.3000', 'seating.stool.bar', 'a stool stands at the counter it is served at'],
  ['equipment.console.monitoring', 'chair.task', 'the operators sit at the console'],
];

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------
//
// Every id exists in `BASE_MATERIALS`. Two substitutions, stated because the
// catalogue cannot say what the reference images show:
//
//  - The offices want a warm timber-look floor. There is no timber flooring
//    material, so `mat_tile_porcelain` carries the hard-wearing office floor and
//    `mat_marble` the executive one. Borrowing `mat_door_flush` for its timber
//    colour would put "Flush door with frame", measured in `each`, in a floor
//    line of the BOQ.
//  - The data centre wants a raised access floor. There is no such material.
//    `mat_granite` stands in as a dark hard floor and the raised floor is stated
//    in the rationale rather than costed, because a plenum is a system, not a
//    finish, and inventing a rate for it is exactly what must not happen here.

const FLOOR_OFFICE = 'mat_tile_porcelain';
const FLOOR_EXEC = 'mat_marble';
const FLOOR_TECH = 'mat_granite';
const FLOOR_SOFT = 'mat_carpet_tile';
const FLOOR_WET = 'mat_tile_ceramic';
const FLOOR_DECK = 'mat_stone_cladding';
const WALL_CALM = 'mat_paint_emulsion';
const WALL_WARM = 'mat_plaster';
const WALL_FEATURE = 'mat_stone_cladding';
const WALL_TECH = 'mat_acp_panel';
const CEILING_FLAT = 'mat_gypsum_ceiling';
const CEILING_GRID = 'mat_grid_ceiling';
const SKIRTING = 'mat_skirting';

export const THEME_ID = 'theme_gis_company';

const floor = (materialId, note) => ({ surface: 'floor', materialId, note });
const wall = (materialId, note) => ({ surface: 'wall_internal', materialId, note });
const dado = (materialId, heightLimit, note) => ({
  surface: 'wall_internal',
  materialId,
  heightLimit,
  note,
});
const featureWall = (materialId, side, note) => ({
  surface: 'wall_internal',
  materialId,
  onSide: side,
  note,
});
const skirting = () => ({ surface: 'skirting', materialId: SKIRTING });
const light = (kind, count, wattsEach, note) => ({
  kind,
  count,
  wattsEach,
  colourTemperatureK: 4000,
  note,
});
const warmLight = (kind, count, wattsEach, note) => ({
  kind,
  count,
  wattsEach,
  colourTemperatureK: 3000,
  note,
});

// ---------------------------------------------------------------------------
// Repeated pieces of the core, identical on floors 1 to 4
// ---------------------------------------------------------------------------

/**
 * The core rooms, which do not change with the floor's purpose.
 *
 * A stair is a stair on a GIS floor and on a data centre floor. Repeating the
 * finishes per storey would be four chances to make them disagree for no reason.
 */
function coreRooms({ kitchenIsPlant }) {
  return [
    {
      name: kitchenIsPlant ? 'PLANT / UPS' : 'KITCHEN',
      finishes: kitchenIsPlant
        ? [floor(FLOOR_TECH, 'Hard floor, no carpet: this room now holds batteries and switchgear.'),
           wall(WALL_TECH, 'Panelled, wipeable.'), skirting()]
        : [floor(FLOOR_WET, 'Tiled: it is a tea point with a sink.'),
           dado(FLOOR_WET, 1200, 'Tiled to 1,200 mm behind the counter run.'),
           wall(WALL_CALM), skirting()],
      ceiling: { kind: kitchenIsPlant ? 'exposed' : 'gypsum_flat', materialId: kitchenIsPlant ? undefined : CEILING_FLAT, dropHeight: kitchenIsPlant ? 0 : 150 },
      lighting: [light('recessed_downlight', 4, 12, kitchenIsPlant ? 'Plain, high output. Nobody lingers here.' : 'Task light over the counter.')],
      furniture: kitchenIsPlant
        ? [
            // The UPS and NOTHING ELSE. Both cabinets were drawn in here and
            // both fell outside a room that is 8'-10" x 7'-0": a 1,600 UPS and
            // a 1,400 CRAC, each wanting a metre of working space in front, do
            // not both stand in 62 sq ft. The cooling units are in the hall.
            { key: 'equipment.ups.cabinet', label: 'UPS and battery', position: at(3.4, 2.2), rotationDeg: 0 },
          ]
        : [{ key: 'storage.cabinet.1000', label: 'Tall cupboard', position: at(2.4, 6.2), rotationDeg: 0 }],
      rationale: kitchenIsPlant
        ? 'Drawn as a kitchen and used as the data centre’s plant room, which is a change of use and ' +
          'not of fabric — no wall moved for it. It holds the UPS alone — both cabinets were tried here and 62 sq ft ' +
          'will not take two, so the cooling units stand in the hall and their ' +
          'condensers on the roof, reached down the drawn DUCT. THE COOLING AND POWER LOAD IS NOT ' +
          'RESOLVED HERE. 62 sq ft is small for the plant a rack room of this size needs, and whether ' +
          'it is enough is an MEP question, not a layout one. Battery ventilation and the fire ' +
          'strategy are open in the same way.'
        : 'A tea point, not a kitchen to cook in. Tiled floor and a tiled dado behind the counter, ' +
          'because that is the wall that gets splashed.',
    },
    {
      name: 'MALE WASH',
      finishes: [
        floor(FLOOR_WET, 'Tiled.'),
        dado(FLOOR_WET, 1500, 'Tiled to 1,500 mm — a wet wall, so the tile goes above the splash line.'),
        wall(WALL_CALM, 'Emulsion above the tile.'),
        skirting(),
      ],
      ceiling: { kind: 'gypsum_flat', materialId: CEILING_FLAT, dropHeight: 150 },
      lighting: [light('recessed_downlight', 2, 9, 'Two, and no more: it is 27 sq ft.')],
      furniture: [],
      rationale: 'The drawing’s BATH, in use as the male washroom. Nothing about it moves.',
    },
    {
      name: 'FEMALE WASH',
      finishes: [
        floor(FLOOR_WET, 'Tiled, matching the male washroom.'),
        dado(FLOOR_WET, 1500, 'Tiled to 1,500 mm.'),
        wall(WALL_CALM),
        skirting(),
      ],
      ceiling: { kind: 'gypsum_flat', materialId: CEILING_FLAT, dropHeight: 150 },
      lighting: [light('recessed_downlight', 3, 9, 'Three across a 35 sq ft room.')],
      furniture: [],
      rationale:
        'PROPOSED, and not on the architect’s drawing. The sheet gives one bath per floor, which is ' +
        'not enough for a floor in office use, so the drawn bath becomes the male washroom and this ' +
        'is built beside it. Every wall of it is marked as new construction.',
    },
    {
      name: 'STAIRS',
      finishes: [floor(FLOOR_OFFICE, 'Porcelain, as the landings are.'), wall(WALL_CALM), skirting()],
      ceiling: { kind: 'none' },
      lighting: [light('wall_washer', 3, 10, 'Washed walls rather than a pendant in the void.')],
      furniture: [],
      rationale:
        'The main stair, 8\'-10" x 19\'-3" from the drawing. The floor finish is billed over the ' +
        'whole plan area of the room, which OVERSTATES it: the treads are a separate item and most ' +
        'of this rectangle is the flight, not landing.',
    },
    {
      name: 'EMG. STAIRS',
      finishes: [floor(FLOOR_OFFICE), wall(WALL_CALM), skirting()],
      ceiling: { kind: 'none' },
      lighting: [light('recessed_downlight', 2, 9, 'Escape lighting is a separate system and is not modelled.')],
      furniture: [],
      rationale: 'The spiral escape stair, 4\'-3" x 7\'-0". Plain, and deliberately so.',
    },
    {
      name: 'LIFT',
      finishes: [floor(FLOOR_EXEC, 'Marble in the car, which is where it is seen closest.'), wall(WALL_FEATURE), skirting()],
      ceiling: { kind: 'gypsum_flat', materialId: CEILING_FLAT, dropHeight: 100 },
      lighting: [light('recessed_downlight', 2, 9, 'Two in the car.')],
      furniture: [],
      rationale: 'The lift, 7\'-6" x 6\'-4". Finished as the car, not as a lobby.',
    },
    {
      name: 'BALCONY',
      finishes: [floor(FLOOR_DECK, 'External-grade paving. Not the internal floor finish.'), wall(WALL_FEATURE), skirting()],
      ceiling: { kind: 'none' },
      lighting: [warmLight('linear_led', 1, 14, 'A single run at the threshold.')],
      furniture: [
        // The M.S fin screen, just inboard of the balcony's front wall face.
        // On the real building it is fixed TO that face; the model has no way to
        // place an item outside a room, so it stands 3" clear of the 9" wall
        // rather than passing through it — which the validator caught.
        // 3" x 4" members per
        // the FRONT ELEVATION — the floor plans say 2" x 4" and the two sheets
        // disagree; the elevation is the one being followed.
        { key: 'outdoor.louvre.screen', label: 'M.S louvre screen', position: at(15.4, 44.35), rotationDeg: 0 },
      ],
      rationale:
        'Labelled on the sheet and dimensioned on none of them — 10\'-6" x 4\'-6" is measured off ' +
        'the line work and must be confirmed. Left empty: on floor 3 it carries the cooling ' +
        'condensers, and until the balcony’s real size is known, furnishing it would be guessing on ' +
        'top of a guess.',
    },
  ];
}

// ---------------------------------------------------------------------------
// The four halls
// ---------------------------------------------------------------------------
//
// The hall is 30'-2" x 42'-10" less the balcony recess: x from 9.833 to 40 ft,
// y from 2.167 to 45 ft south, with the corner x 9.833..20.333 / y 40.5..45
// taken out. Everything below is placed inside that L.

/**
 * A bank of workstations, back to back in pairs, as an open office is laid out.
 *
 * EVERY PITCH HERE IS IN FEET, and that is the whole comment. The first version
 * of this function carried 1.9 and 5.2 — the millimetre figures for a 1,600 desk
 * and a back-to-back pair, divided by nothing. A 1,600 mm desk is 5.25 FEET, so
 * columns 1.9 ft apart put every desk a third of the way through its neighbour,
 * and the app's own validator refused the floor with 107 overlaps. The numbers
 * below are derived once, in feet, from the catalogue:
 *
 *   desk   1,600 x 800 mm  = 5.25 x 2.62 ft
 *   chair    620 x 620 mm  = 2.03 x 2.03 ft
 *
 * so a column pitch is 5.25 + 0.40 clear, a back-to-back pair is 2.30 apart
 * (backs touching), a chair sits 2.20 off its desk's centre, and a row pitch is
 * the pair plus both chairs plus a walking route.
 */
const DESK_W = 1600 / 304.8;
const DESK_D = 800 / 304.8;
const COL_PITCH = DESK_W + 0.4;
/**
 * How far a chair's centre sits from the centre of what it serves.
 *
 * Half the item's depth plus half the chair's plus a little daylight. A chair
 * "tucked in" still must not be INSIDE the table — the validator counts that as
 * an overlap and rejects the room, which is right: a chair drawn through a
 * table top is not a tucked chair, it is a modelling error.
 */
const tuck = (itemDepthMm, chairDepthMm) => (itemDepthMm / 2 + chairDepthMm / 2) / 304.8 + 0.15;
const AT_MEETING = tuck(1200, 620);   // conference.8 + task chair
const AT_EXEC = tuck(900, 720);       // executive desk + executive chair
const AT_BOARD = tuck(1400, 720);     // conference.14 + executive chair
const AT_CONSOLE = tuck(1400, 620);   // monitoring console + task chair
/** Derived, so it follows the catalogue if the desk's depth ever changes. */
const CHAIR_OFF = tuck(800, 620);
const ROW_PITCH = 12.7;

function workstationBank(xStart, yStart, cols, rows) {
  const items = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = xStart + c * COL_PITCH;
      const yA = yStart + r * ROW_PITCH;
      // 0.15 ft of daylight between the backs. Touching exactly is an overlap.
      const yB = yA + DESK_D + 0.15;
      const n = r * cols * 2 + c * 2;
      items.push({ key: 'desk.workstation.1600', label: `Workstation ${n + 1}`, position: at(x, yA), rotationDeg: 0 });
      items.push({ key: 'chair.task', label: `Chair ${n + 1}`, position: at(x, yA - CHAIR_OFF), rotationDeg: 0 });
      items.push({ key: 'desk.workstation.1600', label: `Workstation ${n + 2}`, position: at(x, yB), rotationDeg: 180 });
      items.push({ key: 'chair.task', label: `Chair ${n + 2}`, position: at(x, yB + CHAIR_OFF), rotationDeg: 180 });
    }
  }
  return items;
}

const HALL_COMMON = {
  ceiling: { kind: 'grid_tile', materialId: CEILING_GRID, dropHeight: 300 },
};

function gisHall() {
  return {
    name: 'HALL',
    finishes: [
      floor(FLOOR_OFFICE, 'Porcelain through the open floor; hard-wearing and light.'),
      floor(FLOOR_SOFT, 'Carpet tile under the workstation banks, for acoustics.'),
      wall(WALL_CALM, 'Calm walls: the maps are the colour in this room.'),
      featureWall(WALL_FEATURE, 'east', 'The display wall, clad, so the screens sit on a surface and not on plaster.'),
      skirting(),
    ],
    ...HALL_COMMON,
    lighting: [
      light('recessed_downlight', 24, 14, 'General, ~400 lux over the workstations.'),
      light('linear_led', 4, 20, 'A run over each desk bank.'),
      warmLight('wall_washer', 6, 12, 'Washing the display wall, warmer than the general light.'),
    ],
    furniture: [
      ...workstationBank(13.2, 6.5, 4, 2),
      { key: 'display.videowall.3x2', label: 'GIS map display wall', position: at(38.6, 16), rotationDeg: 90 },
      // West of the manager's office, which now occupies x 28'-8" to 35'-8".
      { key: 'exhibit.model.terrain', label: 'Terrain / GIS physical model', position: at(23.5, 33), rotationDeg: 0 },
      { key: 'table.conference.8', label: 'Meeting table', position: at(14.5, 30.5), rotationDeg: 0 },
      { key: 'chair.task', label: 'Meeting chair 1', position: at(13.2, 30.5 - AT_MEETING), rotationDeg: 0 },
      { key: 'chair.task', label: 'Meeting chair 2', position: at(15.8, 30.5 - AT_MEETING), rotationDeg: 0 },
      { key: 'chair.task', label: 'Meeting chair 3', position: at(13.2, 30.5 + AT_MEETING), rotationDeg: 180 },
      { key: 'chair.task', label: 'Meeting chair 4', position: at(15.8, 30.5 + AT_MEETING), rotationDeg: 180 },
      { key: 'decor.planter.large', label: 'Planter', position: at(38.5, 30), rotationDeg: 0 },
      { key: 'decor.planter.large', label: 'Planter', position: at(38.5, 33), rotationDeg: 0 },
    ],
    rationale:
      'Sixteen workstations in two back-to-back banks along the north, the map wall on the long east ' +
      'elevation where it can be read from anywhere on the floor, and the physical terrain model in ' +
      'the middle so it is walked round rather than looked at from one side. The model is a BUILT-IN, ' +
      'set into the floor build-up: it is placed clear of the route from the stair because moving it ' +
      'later is a builder’s job, not a facilities one. The manager takes the south-east corner, ' +
      'furthest from the stair, which is the quietest corner of any floor with a single core.',
  };
}

function satelliteHall() {
  return {
    name: 'HALL',
    finishes: [
      floor(FLOOR_OFFICE, 'The same porcelain as floor 1: one building, one floor finish.'),
      floor(FLOOR_SOFT, 'Carpet tile under the analysis desks.'),
      wall(WALL_CALM),
      featureWall(WALL_FEATURE, 'east', 'The imagery wall.'),
      skirting(),
    ],
    ...HALL_COMMON,
    lighting: [
      light('recessed_downlight', 20, 14, 'Kept lower than floor 1: this floor reads screens all day.'),
      light('linear_led', 4, 20, 'Over the desk banks.'),
      warmLight('track', 6, 10, 'Aimed at the two models, so they are lit objects and not silhouettes.'),
    ],
    furniture: [
      ...workstationBank(13.2, 6.5, 4, 2),
      { key: 'display.videowall.3x2', label: 'Earth / satellite imagery wall', position: at(38.6, 16), rotationDeg: 90 },
      { key: 'exhibit.plinth.1200', label: 'Globe on plinth', position: at(20, 31), rotationDeg: 0 },
      { key: 'exhibit.plinth.1200', label: 'Satellite model on plinth', position: at(25, 31), rotationDeg: 0 },
      { key: 'display.screen.75', label: 'Secondary display', position: at(38.6, 30), rotationDeg: 90 },
      { key: 'decor.planter.large', label: 'Planter', position: at(38.5, 6), rotationDeg: 0 },
    ],
    rationale:
      'The same bones as floor 1, which is deliberate — two analysis floors in one building should ' +
      'not be laid out differently for the sake of it. What changes is the middle: two plinths, 6 ft ' +
      'apart, carrying the globe and the satellite model. They are FIXED, as the brief says, so they ' +
      'get a 900 mm clear ring and sit off the stair route. The general lighting is lower than floor ' +
      '1 because this floor reads imagery on screens, and the track light is there to stop the models ' +
      'reading as silhouettes against the display wall.',
  };
}

function dataCentreHall() {
  return {
    name: 'HALL',
    finishes: [
      floor(FLOOR_TECH, 'Dark hard floor. A RAISED ACCESS FLOOR IS ASSUMED AND NOT COSTED — a plenum is a system, not a finish, and there is no material for it.'),
      wall(WALL_TECH, 'Panelled: wipeable, and it does not shed.'),
      featureWall(WALL_FEATURE, 'east', 'The wall the control room faces.'),
      skirting(),
    ],
    ceiling: { kind: 'exposed', dropHeight: 0 },
    lighting: [
      light('linear_led', 12, 22, 'Runs down the cold aisles, not a grid: you light the aisle you work in.'),
      light('recessed_downlight', 6, 14, 'Over the console only.'),
    ],
    furniture: [
      // Two rows of seven, hot aisle between them. Racks are 600 wide and stand
      // shoulder to shoulder within a row, as they do in a real hall.
      ...Array.from({ length: 7 }, (_, i) => ({
        key: 'equipment.rack.42u',
        label: `Rack A${i + 1}`,
        position: at(14 + i * 2.05, 8.5),
        rotationDeg: 0,
      })),
      ...Array.from({ length: 7 }, (_, i) => ({
        key: 'equipment.rack.42u',
        label: `Rack B${i + 1}`,
        position: at(14 + i * 2.05, 14.5),
        rotationDeg: 180,
      })),
      { key: 'equipment.console.monitoring', label: 'Monitoring console', position: at(24, 27), rotationDeg: 0 },
      { key: 'chair.task', label: 'Operator 1', position: at(21.5, 27 + AT_CONSOLE), rotationDeg: 0 },
      { key: 'chair.task', label: 'Operator 2', position: at(24, 27 + AT_CONSOLE + 0.2), rotationDeg: 0 },
      { key: 'chair.task', label: 'Operator 3', position: at(26.5, 27 + AT_CONSOLE), rotationDeg: 0 },
      { key: 'display.videowall.3x2', label: 'Status wall', position: at(38.6, 27), rotationDeg: 90 },
      { key: 'equipment.crac.unit', label: 'Cooling unit 1', position: at(37, 8), rotationDeg: 90 },
      { key: 'equipment.crac.unit', label: 'Cooling unit 2', position: at(37, 15), rotationDeg: 90 },
    ],
    rationale:
      'FOURTEEN RACKS, IN TWO ROWS OF SEVEN WITH A HOT AISLE BETWEEN THEM — the count on the ' +
      'reference sheet, laid out the way a rack hall actually is rather than scattered. Racks are ' +
      '600 mm wide and stand shoulder to shoulder within a row; the 1,000 mm clearance is the cold ' +
      'aisle in front of each row. The console faces the status wall from the middle of the floor.\n' +
      'WHAT THIS LAYOUT DOES NOT SETTLE: the cooling and the power. One indoor unit stands in the ' +
      'hall and one in the plant room, and their condensers have to go on the balcony — which is ' +
      '47 sq ft and not dimensioned on the drawing. Fourteen populated racks is a serious load for a ' +
      'floor with 62 sq ft of plant space and no riser shown. Treat the rack count as the brief’s, ' +
      'not as a number this model has verified the floor can carry.',
  };
}

function executiveHall() {
  return {
    name: 'HALL',
    finishes: [
      floor(FLOOR_EXEC, 'Marble through the circulation: this is the floor visitors are brought to.'),
      wall(WALL_WARM, 'Warm plaster, not the office emulsion below.'),
      skirting(),
    ],
    ceiling: { kind: 'gypsum_coffered', materialId: CEILING_FLAT, dropHeight: 450 },
    lighting: [
      warmLight('cove', 10, 18, 'Perimeter cove, warm, and most of why this floor reads differently from the ones below.'),
      warmLight('recessed_downlight', 12, 12, 'Fill only, at 3000 K.'),
      warmLight('floor_lamp', 2, 15, 'In the lounge.'),
    ],
    furniture: [
      // The open lounge, between the boardroom and the south offices.
      { key: 'seating.sofa.3', label: 'Lounge sofa', position: at(25, 33.4), rotationDeg: 0 },
      { key: 'table.coffee.1200', label: 'Lounge table', position: at(25, 29.8), rotationDeg: 0 },
      { key: 'seating.lounge.chair', label: 'Lounge chair 1', position: at(21.5, 29.8), rotationDeg: 90 },
      { key: 'seating.lounge.chair', label: 'Lounge chair 2', position: at(28.5, 29.8), rotationDeg: 270 },
      { key: 'exhibit.plinth.1200', label: 'Corporate model', position: at(25, 8), rotationDeg: 0 },
      { key: 'decor.planter.large', label: 'Planter', position: at(23.5, 14.5), rotationDeg: 0 },
      { key: 'decor.planter.large', label: 'Planter', position: at(26.5, 14.5), rotationDeg: 0 },
    ],
    rationale:
      'What is left of the hall once the four suites and the boardroom are built inside it: the ' +
      'circulation, and the open lounge between the boardroom and the southern offices. Marble on ' +
      'the routes, warm plaster, and the whole floor lit at 3000 K against 4000 K below — the ' +
      'colour temperature is most of what makes an executive floor feel like one, more than the ' +
      'finishes are. The corporate model stands where you arrive from the lift, not tucked in a ' +
      'corner.',
  };
}

/** The four executive offices. Identical, because there is no reason to rank them. */
function executiveOffice(n) {
  const x = n === 1 || n === 3 ? 17.8 : 32.2;
  // Measured from the wall the desk backs onto, not from the room's centre.
  // Centring the desk left no run behind the chair for the cupboard: the chair
  // finished 11.94 and the cupboard needed its centre at 12.68 in a room that
  // ends at 13.2. Working from the back wall gives desk, chair and cupboard a
  // place each, in that order.
  const facingSouth = n <= 2;
  const back = facingSouth ? 2.7 : 39.5;
  const sign = facingSouth ? 1 : -1;
  const y = back + sign * 3.1;
  return {
    name: `EXECUTIVE OFFICE ${n}`,
    finishes: [
      floor(FLOOR_SOFT, 'Carpet tile: quieter than the marble outside the door, which is the point of a private office.'),
      wall(WALL_WARM),
      featureWall(WALL_FEATURE, facingSouth ? 'north' : 'south', 'The wall behind the desk, clad.'),
      skirting(),
    ],
    ceiling: { kind: 'gypsum_flat', materialId: CEILING_FLAT, dropHeight: 300 },
    lighting: [
      warmLight('recessed_downlight', 6, 12, 'Even, 3000 K, ~350 lux.'),
      warmLight('cove', 2, 14, 'Cove over the desk wall.'),
    ],
    furniture: [
      { key: 'desk.executive.1800', label: `Desk ${n}`, position: at(x, y), rotationDeg: facingSouth ? 0 : 180 },
      { key: 'chair.executive', label: `Chair ${n}`, position: at(x, y + sign * AT_EXEC), rotationDeg: facingSouth ? 0 : 180 },
    ],
    rationale:
      '73.5 sq ft, PROPOSED — the architect’s sheet shows one open hall here and these partitions ' +
      'are new construction. Desk across the room with the clad wall behind it, its own washroom ' +
      'against the outer wall and the door hung in the far corner so it does not swing into the ' +
      'desk. No cupboard: at 7 ft wide, once the desk and its chair are in there is nowhere for one ' +
      'that does not stand in the door. Carpet inside the door and marble outside it, which is the ' +
      'difference you feel rather than see.',
  };
}

/** The en-suite washrooms, one per office. */
function execWash(n) {
  return {
    name: `EXEC WASH ${n}`,
    finishes: [
      floor(FLOOR_WET, 'Tiled.'),
      dado(FLOOR_WET, 1500, 'Tiled to 1,500 mm.'),
      wall(WALL_CALM),
      skirting(),
    ],
    ceiling: { kind: 'gypsum_flat', materialId: CEILING_FLAT, dropHeight: 300 },
    lighting: [warmLight('recessed_downlight', 2, 9, 'Two, in 20 sq ft.')],
    furniture: [],
    rationale: '20 sq ft en-suite, PROPOSED, opening off its own office. Not on the architect’s drawing.',
  };
}

function boardroom() {
  return {
    name: 'BOARDROOM',
    finishes: [
      floor(FLOOR_SOFT, 'Carpet, for the acoustics a room of this size needs.'),
      wall(WALL_WARM),
      featureWall(WALL_FEATURE, 'east', 'The end wall the table addresses.'),
      skirting(),
    ],
    ceiling: { kind: 'gypsum_coffered', materialId: CEILING_FLAT, dropHeight: 450 },
    lighting: [
      warmLight('pendant', 3, 40, 'Three over the table, which is what lights a boardroom.'),
      warmLight('cove', 4, 18, 'Cove round the coffer.'),
      warmLight('wall_washer', 3, 12, 'On the clad end wall.'),
    ],
    furniture: [
      { key: 'table.conference.14', label: 'Boardroom table', position: at(26, 21), rotationDeg: 0 },
      ...Array.from({ length: 4 }, (_, i) => ({
        key: 'chair.executive',
        label: `Boardroom chair N${i + 1}`,
        position: at(21.5 + i * 3, 21 - AT_BOARD),
        rotationDeg: 0,
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        key: 'chair.executive',
        label: `Boardroom chair S${i + 1}`,
        position: at(21.5 + i * 3, 21 + AT_BOARD),
        rotationDeg: 180,
      })),
      { key: 'display.screen.75', label: 'Boardroom screen', position: at(33.6, 21), rotationDeg: 90 },
    ],
    rationale:
      '180 sq ft, PROPOSED, across the middle of the floor on the long axis so both halves of the ' +
      'floor reach it equally. Fourteen-foot table, eight seats, screen on the clad end wall. ' +
      'Carpet and a coffered ceiling because a hard room this size is unusable for a meeting.',
  };
}


// ---------------------------------------------------------------------------
// The three ground-floor concepts
// ---------------------------------------------------------------------------
//
// Same architecture, same furniture positions, three material and lighting
// schemes. That is deliberate and it is the whole point of comparing them: if
// the layout moved as well, you would be judging two things at once and could
// not say which one you were reacting to.
//
// Every material id is real. Where a board's palette names something the
// catalogue has no line for — brushed metal, gold, leather, walnut — the nearest
// honest material is used and the substitution is named in the rationale, never
// silently swapped for something that would price as a different trade.

export const GROUND_CONCEPTS = {
  lounge: {
    label: 'Concept 1 — Modern Geo-Spatial Lounge',
    tagline: 'Earth. Data. Insight.',
    floor: FLOOR_EXEC,
    floorNote: 'Dark marble. The board calls it dark stone; marble is the catalogue’s stone line.',
    wall: WALL_WARM,
    feature: 'mat_timber_walnut',
    featureNote: 'Walnut, which the board names and the catalogue now carries. It is UNPRICED — no published Islamabad rate was found for it; see the procurement note.',
    ceiling: { kind: 'gypsum_coffered', materialId: CEILING_FLAT, dropHeight: 450 },
    kelvin: 3000,
    lighting: [
      ['cove', 12, 18, 'Warm cove round the void, which is what the board is mostly showing.'],
      ['linear_led', 8, 20, 'Vertical slats washed from below.'],
      ['pendant', 2, 40, 'Over the reception desk.'],
    ],
    missing: 'Walnut and the slat screen are now real catalogue lines and are MEASURED. Neither is PRICED: no published Islamabad rate was found for either.',
  },
  hub: {
    label: 'Concept 2 — Futuristic GIS Hub',
    tagline: 'Mapping Tomorrow',
    floor: FLOOR_EXEC,
    floorNote: 'White marble, polished — the palette is light and this is the lightest floor the catalogue has.',
    wall: WALL_CALM,
    feature: 'mat_metal_brushed',
    featureNote: 'Brushed stainless, as the board names. UNPRICED: stainless in Pakistan is sold by the KILOGRAM and tracks nickel weekly, so a square-foot rate has to come from a supplier against a stated gauge.',
    ceiling: { kind: 'gypsum_flat', materialId: CEILING_FLAT, dropHeight: 300 },
    kelvin: 4000,
    lighting: [
      ['linear_led', 16, 20, 'Recessed lines, cool, and a lot of them: this scheme is lit like a product.'],
      ['cove', 6, 16, 'Slot round the reception and the void edge.'],
      ['wall_washer', 4, 12, 'On the data wall.'],
    ],
    missing: 'Brushed stainless is measured but not priced. Concrete and glass-light remain described only.',
  },
  observatory: {
    label: 'Concept 3 — Luxury Earth Observation Centre',
    tagline: 'Observe. Analyze. Empower.',
    floor: FLOOR_EXEC,
    floorNote: 'Black marble.',
    wall: WALL_WARM,
    feature: 'mat_leather_upholstery',
    featureNote: 'Leather upholstery to the globe wall, lit from behind. UNPRICED — no published rate found.',
    ceiling: { kind: 'gypsum_coffered', materialId: CEILING_FLAT, dropHeight: 450 },
    kelvin: 2700,
    lighting: [
      ['cove', 14, 18, 'The warmest of the three at 2700 K, and the darkest: this scheme is lit by pools, not evenly.'],
      ['track', 8, 10, 'Aimed at the globe and the imagery wall.'],
      ['wall_washer', 4, 12, 'Grazing the dark timber.'],
      ['pendant', 2, 30, 'Over the seating.'],
    ],
    missing: 'Gold trim and leather are now real lines and are MEASURED — the leather by area on the feature wall, the gold by the running foot as trim. NEITHER IS PRICED, and they are most of what makes this scheme what it is, so its total is the least complete of the three.',
  },
};

/** The ground floor, in one of the three concepts. */
function groundLobby(concept) {
  const c = GROUND_CONCEPTS[concept];
  const lamp = (kind, count, watts, note) => ({
    kind,
    count,
    wattsEach: watts,
    colourTemperatureK: c.kelvin,
    note,
  });
  return {
    name: 'HALL',
    finishes: [
      floor(c.floor, c.floorNote),
      wall(c.wall),
      // 'east', not 'north'. The hall's north edge sits 2'-2" inside the shell
      // — that is what 30'-2" x 42'-10" leaves in a 45' building — so the north
      // shell wall does not bound this room and asking for north silently
      // resolved to a 42'-10" side wall instead. The reception faces east
      // anyway, which is where the data wall goes.
      featureWall(c.feature, 'east', c.featureNote),
      skirting(),
    ],
    ceiling: c.ceiling,
    lighting: c.lighting.map(([k, n, w, note]) => lamp(k, n, w, note)),
    furniture: [
      { key: 'reception.desk.2400', label: 'Reception desk', position: at(25, 12), rotationDeg: 0 },
      { key: 'chair.task', label: 'Receptionist', position: at(25, 12 - tuck(900, 620)), rotationDeg: 180 },
      { key: 'display.videowall.3x2', label: 'Earth / data wall', position: at(25, 2.9), rotationDeg: 0 },
      // Sofas facing each other across the table, which is how the boards draw
      // it: 2,100 wide turned end-on, table between them.
      { key: 'seating.sofa.3', label: 'Waiting sofa 1', position: at(25, 23.4), rotationDeg: 180 },
      { key: 'seating.sofa.3', label: 'Waiting sofa 2', position: at(25, 28.6), rotationDeg: 0 },
      { key: 'table.coffee.1200', label: 'Waiting table', position: at(25, 26), rotationDeg: 0 },
      { key: 'exhibit.plinth.1200', label: 'Satellite model', position: at(35, 20), rotationDeg: 0 },
      { key: 'decor.planter.large', label: 'Planter', position: at(11.5, 8), rotationDeg: 0 },
      { key: 'decor.planter.large', label: 'Planter', position: at(11.5, 12), rotationDeg: 0 },
      { key: 'decor.planter.large', label: 'Planter', position: at(38.5, 8), rotationDeg: 0 },
    ],
    rationale:
      `${c.label} — "${c.tagline}". THE DOUBLE HEIGHT IS THE SCHEME. This hall runs from +2'-6" to ` +
      `+21'-3", 18'-9" clear under the mezzanine void, and every one of the three boards is really a ` +
      `picture of that volume. The reception faces the door with the data wall behind it; the ` +
      `waiting group sits under the void where the height is; the satellite model stands at the east ` +
      `wall where the mezzanine looks down on it.\n` +
      `The layout is IDENTICAL in all three concepts, on purpose. Only the materials and the light ` +
      `change, so that switching between them in the 3D view compares one thing and not two.\n` +
      `WHAT THE CATALOGUE CANNOT SAY: ${c.missing}`,
  };
}

// ---------------------------------------------------------------------------
// The roof
// ---------------------------------------------------------------------------

/**
 * The sky garden, at the corrected size.
 *
 * The proposal was drawn on 1,485 sq ft of usable roof. There is 1,325. The
 * canopy and the open deck were both scaled by the same factor — 858 and 483 —
 * which is what keeps the balance between shaded and open as it was drawn, and
 * that is the budget the layout below spends.
 */
function skyGarden() {
  return [
    {
      name: 'ROOF',
      finishes: [
        floor(FLOOR_DECK, 'External paving over the roof build-up. The waterproofing below it is not a finish and is not costed here.'),
        wall(WALL_FEATURE, 'The mumty walls, seen from the terrace.'),
        skirting(),
      ],
      // FIBRE TENSILE, per the brief: the canopy is umbrella or fibre, nothing
      // else. `stretch` is the ceiling kind that means a tensioned fabric
      // membrane, which is exactly what this is.
      //
      // It is the terrace's CEILING and not furniture on it, and that is not a
      // dodge — it is what a shade structure is. Drawn as furniture it was four
      // 4 m bays standing ON the terrace, and the app's clearance validator was
      // right to refuse it: an object with a 13'-1" square footprint sitting
      // where the seating goes is a solid pavilion, not a piece of fabric 2.6 m
      // over your head. Every item under it read as an overlap.
      //
      // NO MATERIAL ID. There is no fabric membrane in the material catalogue,
      // and the nearest by colour would put the wrong trade and the wrong unit
      // into the BOQ. The canopy is therefore described and NOT costed here —
      // it needs a real line added to the catalogue before it can be.
      ceiling: { kind: 'stretch', materialId: 'mat_fabric_tensile', dropHeight: 0 },
      lighting: [
        warmLight('bollard', 8, 8, 'Low level along the routes. Nothing above head height except the canopy uplights.'),
        warmLight('linear_led', 6, 12, 'Concealed in the planter troughs, washing the planting.'),
        warmLight('track', 4, 10, 'Under the canopy, over the seating.'),
      ],
      furniture: [
        { key: 'counter.servery.3000', label: 'Tea counter', position: at(31, 3), rotationDeg: 0 },
        ...Array.from({ length: 4 }, (_, i) => ({
          key: 'seating.stool.bar',
          label: `Counter stool ${i + 1}`,
          position: at(27.8 + i * 2.1, 5.6),
          rotationDeg: 180,
        })),
        { key: 'seating.sofa.3', label: 'Lounge sofa', position: at(31.2, 19), rotationDeg: 0 },
        { key: 'table.coffee.1200', label: 'Lounge table', position: at(31.2, 22.4), rotationDeg: 0 },
        { key: 'table.conference.8', label: 'Meeting table, outdoor', position: at(31.2, 34), rotationDeg: 0 },
        ...Array.from({ length: 4 }, (_, i) => ({
          key: 'chair.executive',
          label: `Meeting chair ${i + 1}`,
          position: at(29.6 + (i % 2) * 3.2, 34 + (i < 2 ? -AT_BOARD : AT_BOARD)),
          rotationDeg: i < 2 ? 0 : 180,
        })),
        // A green edge along the east parapet, clear of the canopy legs.
        ...Array.from({ length: 4 }, (_, i) => ({
          key: 'outdoor.planter.trough',
          label: `Planter run E${i + 1}`,
          position: at(38.6, 10 + i * 8.5),
          rotationDeg: 90,
        })),
      ],
      rationale:
        `THE AREAS ARE THE CORRECTED ONES. The proposal assumed 1,485 sq ft of usable roof; the plot ` +
        `is 40' x 45' and the mumty takes 458.56, so there is ${ROOF_BUDGET.usable.toFixed(0)}. The ` +
        `canopy and the open deck both come down by the same factor — ${ROOF_BUDGET.canopyM} sq ft ` +
        `covered and ${ROOF_BUDGET.openM} open — which keeps the balance between shaded and open ` +
        `exactly as drawn.\n` +
        `The canopy is modelled as this terrace's CEILING rather than as furniture standing on it, ` +
        `because that is what a shade structure is — see the note in the code. ${ROOF_BUDGET.canopyM} ` +
        `sq ft of it is covered. The tea ` +
        'counter is at the north end where the stair arrives and it can be served, the lounge under ' +
        'the middle bay, the outdoor meeting table under the south bay. Planting runs the east ' +
        'parapet. THE TROUGHS ARE 700 mm HIGH AND ARE NOT A BALUSTRADE — they screen, they do not ' +
        'restrain, and a real parapet or railing is a separate item this model does not carry.',
    },
    {
      name: 'ROOF (WEST)',
      finishes: [
        floor(FLOOR_DECK, 'The same paving. One terrace, not two, whatever the room list says.'),
        wall(WALL_FEATURE),
        skirting(),
      ],
      ceiling: { kind: 'none' },
      lighting: [warmLight('bollard', 4, 8, 'Route lighting only. Nobody sits here.')],
      furniture: [
        // The data centre's condensers, moved up from the balcony.
        //
        // The balcony is 47 sq ft on a shaded south-west face, and the outdoor
        // half of the cooling for a hall of racks needs several times that with
        // air on every side. This strip has 310 and is already the part of the
        // roof nothing else wants. They run down the existing DUCT the floor
        // plans show, so no new shaft is cut.
        ...Array.from({ length: 4 }, (_, i) => ({
          key: 'equipment.condenser.roof',
          label: `Condenser ${i + 1}`,
          position: at(12.8 + (i % 2) * 5.4, 25.5 + Math.floor(i / 2) * 4.4),
          rotationDeg: 0,
        })),
        ...Array.from({ length: 6 }, (_, i) => ({
          key: 'outdoor.solar.panel',
          label: `PV module ${i + 1}`,
          position: at(13 + (i % 2) * 6, 34 + Math.floor(i / 2) * 4.2),
          rotationDeg: 0,
        })),
      ],
      rationale:
        'The strip west of the garden: the part of the roof nothing else wants, behind the stair ' +
        'head and out of the view the terrace is there for. It now carries two things.\n' +
        'THE DATA CENTRE\'S CONDENSERS, moved up from the balcony. The balcony is 47 sq ft on a ' +
        'shaded south-west face and it is not enough for the outdoor half of the cooling a hall of ' +
        'racks needs; this strip is 310 and faces open sky. They drop to floor 3 down the DUCT the ' +
        'floor plans already show, so no new shaft is cut in the structure. FOUR UNITS IS A ' +
        'PLACEHOLDER COUNT — the real number follows the load, the load follows what goes in the ' +
        'racks, and neither is known here. An MEP engineer sizes this.\n' +
        'And six PV modules, tilted on frames, so the plan area they take is shaded floor rather ' +
        'than lost floor. OUTPUT IS NOT STATED — it depends on the array, the inverter and the ' +
        'site. Nor is the roof loading checked for either the panels or the condensers.',
    },
  ];
}

// ---------------------------------------------------------------------------
// Binding
// ---------------------------------------------------------------------------

const newId = (prefix) => `${prefix}_${globalThis.crypto.randomUUID()}`;

/** The wall on a named side of a room, so a feature finish lands where it is meant to. */
function boundingWallOnSide(room, floorData, side) {
  const walls = floorData.walls.filter((w) => room.boundingWallIds.includes(w.id));
  if (walls.length === 0) return undefined;
  const xs = room.boundary.map((p) => p.x);
  const ys = room.boundary.map((p) => p.y);
  const box = {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys),
  };
  const towards = (w) => {
    const mx = (w.start.x + w.end.x) / 2;
    const my = (w.start.y + w.end.y) / 2;
    if (side === 'north') return my;
    if (side === 'south') return -my;
    if (side === 'east') return mx;
    return -mx;
  };
  const shared = (w) => {
    const horizontal = Math.abs(w.end.y - w.start.y) < Math.abs(w.end.x - w.start.x);
    const [a, b, lo, hi] = horizontal
      ? [w.start.x, w.end.x, box.minX, box.maxX]
      : [w.start.y, w.end.y, box.minY, box.maxY];
    return Math.max(0, Math.min(Math.max(a, b), hi) - Math.max(Math.min(a, b), lo));
  };
  const facing = walls.filter((w) => shared(w) > 500);
  const pool = facing.length > 0 ? facing : walls;
  return pool.sort((a, b) => towards(b) - towards(a) || shared(b) - shared(a))[0];
}

/** What each storey holds, by level. */
function specsForLevel(level, concept = 'lounge') {
  if (level === 0) return [...coreRooms({ kitchenIsPlant: false }), groundLobby(concept)];
  if (level === 0.5) return [mezzanineSpec()];
  const hall = { 1: gisHall, 2: satelliteHall, 3: dataCentreHall, 4: executiveHall }[level];
  if (!hall) return skyGarden();
  const core = coreRooms({ kitchenIsPlant: level === 3 });
  if (level !== 4) return [...core, hall(), managerOffice(), managerWash()];
  // Floor 4 is subdivided, so its hall is only what is left over.
  return [
    ...core,
    hall(),
    boardroom(),
    ...[1, 2, 3, 4].flatMap((n) => [executiveOffice(n), execWash(n)]),
  ];
}

/**
 * Build the design for the materialised tower.
 *
 * `floors` must already carry room ids and recomputed `boundingWallIds`: a
 * feature wall is resolved to a real `WallId` here.
 */

/**
 * The manager's office on floors 1 to 3, and its en-suite.
 *
 * Same room as floor 4's suites, so the same layout: desk across the room with
 * the clad wall behind it, door hung in the far corner, no cupboard because at
 * 7 ft wide there is nowhere for one that is not in the doorway.
 */
function managerOffice() {
  const back = 39.5;
  const y = back - 3.1;
  return {
    name: 'MANAGER OFFICE',
    finishes: [
      floor(FLOOR_SOFT, 'Carpet tile: quieter than the hall outside the door, which is the point of a private office.'),
      wall(WALL_WARM),
      featureWall(WALL_FEATURE, 'south', 'The wall behind the desk, clad.'),
      skirting(),
    ],
    ceiling: { kind: 'gypsum_flat', materialId: CEILING_FLAT, dropHeight: 300 },
    lighting: [
      warmLight('recessed_downlight', 6, 12, 'Even, ~350 lux.'),
      warmLight('cove', 2, 14, 'Cove over the desk wall.'),
    ],
    furniture: [
      { key: 'desk.executive.1800', label: 'Manager’s desk', position: at(32.2, y), rotationDeg: 180 },
      { key: 'chair.executive', label: 'Manager’s chair', position: at(32.2, y - AT_EXEC), rotationDeg: 180 },
    ],
    rationale:
      '73.5 sq ft, PROPOSED. Item 5 on this floor’s legend is an attached washroom beside the ' +
      'manager’s office and neither existed in the model — the manager was a desk standing in the ' +
      'open hall. The architect’s sheet shows one open hall on this storey, so these partitions are ' +
      'new construction and every wall says so.',
  };
}

function managerWash() {
  return {
    name: 'MANAGER WASH',
    finishes: [
      floor(FLOOR_WET, 'Tiled.'),
      dado(FLOOR_WET, 1500, 'Tiled to 1,500 mm.'),
      wall(WALL_CALM),
      skirting(),
    ],
    ceiling: { kind: 'gypsum_flat', materialId: CEILING_FLAT, dropHeight: 300 },
    lighting: [warmLight('recessed_downlight', 2, 9, 'Two, in 20 sq ft.')],
    furniture: [],
    rationale: '20 sq ft en-suite, PROPOSED, opening off the manager’s office. Not on the architect’s drawing.',
  };
}

/** The mezzanine, which is one rectangle and not the L the boards draw. */
function mezzanineSpec() {
  return {
    name: 'MEZZANINE',
    finishes: [
      floor(FLOOR_SOFT, 'Carpet: it overlooks a hard double-height hall and needs the acoustics.'),
      wall(WALL_WARM),
      featureWall(WALL_FEATURE, 'north', 'The wall behind the meeting lounge.'),
      skirting(),
    ],
    ceiling: { kind: 'gypsum_flat', materialId: CEILING_FLAT, dropHeight: 300 },
    lighting: [
      warmLight('recessed_downlight', 10, 12, 'Even, over the open work area.'),
      warmLight('cove', 4, 16, 'Along the guard, so the edge of the void reads at night.'),
    ],
    furniture: [
      { key: 'table.conference.8', label: 'Meeting table', position: at(16, 8), rotationDeg: 0 },
      ...Array.from({ length: 4 }, (_, i) => ({
        key: 'chair.executive',
        label: `Meeting chair ${i + 1}`,
        position: at(14.5 + (i % 2) * 3, 8 + (i < 2 ? -AT_BOARD : AT_BOARD)),
        rotationDeg: i < 2 ? 0 : 180,
      })),
      { key: 'desk.workstation.1600', label: 'Display desk', position: at(30, 6), rotationDeg: 0 },
      { key: 'chair.task', label: 'Display chair', position: at(30, 9), rotationDeg: 0 },
      { key: 'decor.planter.large', label: 'Planter', position: at(37, 5), rotationDeg: 0 },
    ],
    rationale:
      'ONE RECTANGLE, 29\'-1" x 13\'-8", because that is what the sheet says. The concept boards ' +
      'draw it wrapping two sides of the lobby in an L; the drawing has it as a single band across ' +
      'the north end with the rest of the hall below marked LOOK BELOW twice. It is 397 sq ft of ' +
      'floor, not 700-odd.\n' +
      'Meeting lounge at the west end where the stair arrives, open work and display at the east, ' +
      'and the guard edge lit so the void reads at night. Carpet, because it overlooks a hard hall.',
  };
}

export function towerDesign(floors, options = {}) {
  const rooms = [];
  const byFloor = [];
  const unmatched = [];

  for (const floorData of floors) {
    const floorRooms = [];
    const level = floorData.level;
    // The mumty carries the roof garden; every other storey is an office floor.
    const specs = specsForLevel(level <= 4 ? level : 5, options.concept ?? 'lounge');

    for (const spec of specs) {
      const room = floorData.rooms.find((r) => r.name === spec.name);
      if (!room) {
        unmatched.push(`${floorData.name}: ${spec.name}`);
        continue;
      }

      const finishes = spec.finishes
        .map((f) => {
          const { onSide, ...rest } = f;
          if (!onSide) return rest;
          const feature = boundingWallOnSide(room, floorData, onSide);
          if (!feature) {
            unmatched.push(`${floorData.name}/${spec.name}: no ${onSide} wall for the feature finish`);
            return null;
          }
          return { ...rest, wallId: feature.id };
        })
        .filter(Boolean);

      const roomDesign = {
        roomId: room.id,
        themeId: THEME_ID,
        finishes,
        ceiling: spec.ceiling,
        lighting: spec.lighting,
        furniture: spec.furniture.map((f) => {
          const c = CATALOGUE[f.key];
          if (!c) throw new Error(`tower-design: no catalogue mirror for "${f.key}"`);
          return {
            id: newId('furn'),
            roomId: room.id,
            catalogueKey: f.key,
            label: f.label,
            position: f.position,
            rotationDeg: f.rotationDeg,
            width: c.width,
            depth: c.depth,
            height: c.height,
            ...(c.clearanceFront === undefined ? {} : { clearanceFront: c.clearanceFront }),
          };
        }),
        rationale: spec.rationale,
      };
      rooms.push(roomDesign);
      floorRooms.push(roomDesign);
    }
    byFloor.push({ floorId: floorData.id, rooms: floorRooms });
  }

  // Names that matched no room are REPORTED, never assumed away — a design entry
  // with no room means either the model changed or a name was mistyped, and both
  // must be visible rather than silently skipped.
  if (unmatched.length > 0) options.onUnmatched?.(unmatched);

  return {
    id: options.designId ?? newId('design'),
    projectId: options.projectId ?? 'project_tower',
    versionId: options.versionId ?? newId('version'),
    name: 'Space & Geospatial Company — floors 1 to 4 and the sky garden',
    label: 'Tower fit-out',
    themeId: THEME_ID,
    origin: 'human',
    createdAt: options.createdAt ?? new Date().toISOString(),
    // Grouped per storey, which is the shape `Design` declares, and flat in
    // `rooms` for callers that only want to walk every room design.
    floors: byFloor.map((f) => ({ floorId: f.floorId, rooms: f.rooms })),
    rooms,
    rationale: DESIGN_RATIONALE,
  };
}

const DESIGN_RATIONALE =
  'Four working floors and a roof garden over an architecture that is not touched. Floors 1 and 2 ' +
  'are laid out the same way on purpose: two analysis floors in one building should differ in what ' +
  'they hold, not in how they work. Floor 3 is a rack hall with its plant in the old kitchen — a ' +
  'change of use, not of fabric. Floor 4 is warmer, lit at 3000 K against 4000 K below, and its ' +
  'four executive offices are set out as furniture because enclosing them means adding walls, which ' +
  'is architecture and belongs in the model rather than here. The roof is at the corrected area: ' +
  '1,325 sq ft usable, not the 1,485 the proposal assumed. Prayer rooms are not on these floors; ' +
  'there is one in the basement. Nothing has been checked against local bye-laws.';

/** The general entry point `ui-journey.mjs` looks for on a design module. */
export const basementDesign = towerDesign;
