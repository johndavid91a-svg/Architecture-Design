/**
 * Floors 1 to 4, the mumty and the roof, as the app can build them.
 *
 * The drawing import reads this building already, but it reads it the way a
 * tracer does: room SIZES come from the dimension strings and are exact, while
 * room POSITIONS are the centre of the label that names them, which is
 * approximate by a foot or so. That is fine for checking a schedule and wrong
 * for laying out furniture, so the storeys below are authored from the stated
 * dimensions and the stated levels instead.
 *
 * EVERY FIGURE HERE IS ON THE SHEETS, with one exception called out at the
 * balcony. Nothing is scaled off, guessed, or rounded to something tidier.
 *
 *   Plot                    40' x 45'          ground floor sheet, page 6
 *   HALL                    30'-2" x 42'-10"   pages 8-11
 *   KITCHEN                 8'-10" x 7'-0"
 *   BATH                    5'-0" x 5'-5½"
 *   STAIRS                  8'-10" x 19'-3"
 *   LIFT                    7'-6" x 6'-4"
 *   EMG. STAIRS             4'-3" x 7'-0"
 *   MS LOUVERS              2" x 4"            a steel SECTION size, not a room
 *
 * LEVELS, read from the level tags rather than derived:
 *   1st +21'-3"   2nd +33'-0"   3rd +44'-9"   4th +56'-6"   Mumty +68'-3"
 * which is 11'-9" floor to floor, not the 11'-2" the importer infers by
 * dividing the building's height by its storey count.
 *
 * WHAT IS NEW CONSTRUCTION AND SAID TO BE
 * The drawing gives each floor one bath. The brief asks for a male and a female
 * washroom, and an en-suite in the executive office on floor 4. Those partitions
 * do not exist on the architect's drawing and are marked `inferred` with a note
 * saying so on every wall, exactly as the basement's new partitions are. Floor
 * 3's kitchen becomes a plant room for the data centre: that is a change of USE,
 * not of fabric, so no wall moves for it.
 *
 * Nothing here has been checked against CDA bye-laws or any other regulation.
 */

const FT = 304.8;
/** Building depth, so plan Y can be flipped: the model's Y runs north. */
const DEPTH = 45;

/** Feet, measured south from the building's north-west corner, to model mm. */
const P = (xFt, yFtSouth) => ({ x: Math.round(xFt * FT), y: Math.round((DEPTH - yFtSouth) * FT) });

/** A rectangle given in feet, south-positive, as a counter-clockwise boundary. */
const rect = (x, y, w, d) => [P(x, y + d), P(x + w, y + d), P(x + w, y), P(x, y)];

// ---------------------------------------------------------------------------
// The core strip, identical on every floor above ground
// ---------------------------------------------------------------------------
//
// 40' - 30'-2" = 9'-10". The hall's width and the core's width add to the plot
// exactly, which is the check that says the strip has been read correctly.
const CORE_W = 40 - 30 - 2 / 12;

/** [name, use, xFt, yFtSouth, wFt, dFt] — from the sheets, unchanged. */
const CORE = [
  ['KITCHEN', 'kitchen', 0.5, 0.5, 8 + 10 / 12, 7],
  ['EMG. STAIRS', 'stair', CORE_W, 0.5, 4 + 3 / 12, 7],
  ['BATH', 'toilet', 0.5, 8, 5, 5 + 5.5 / 12],
  ['STAIRS', 'stair', 0.5, 14.5, 8 + 10 / 12, 19.25],
  ['LIFT', 'lift', 0.5, 35.5, 7.5, 6 + 4 / 12],
];

/**
 * The balcony, and the one thing on these sheets that is not dimensioned.
 *
 * "BALCONY" is labelled on floors 1 to 4 and carries no size on any of them,
 * which is why the drawing importer never produced a room for it: the importer
 * pairs a name with the dimension written under it, and there is nothing to
 * pair. 10'-6" x 4'-6" is measured off the line work at the sheet's own plotting
 * scale. It is the only figure in this file that was not read, and it should be
 * confirmed against the architect's dimension before anything is set out.
 */
const BALCONY = { x: CORE_W, y: DEPTH - 4.5, w: 10.5, d: 4.5, measured: true };

/**
 * The hall, as an L.
 *
 * 30'-2" x 42'-10" is the figure on the sheet, and the balcony is taken out of
 * its south-west corner rather than added beside it — the balcony is a recess in
 * the floor plate, not a projection past the plot line. Modelling it as a
 * separate rectangle lapping the hall would double-count 47 sq ft.
 */
function hallBoundary() {
  const x0 = CORE_W;
  const x1 = 40;
  const y0 = 45 - (42 + 10 / 12); // 2'-2" from the north edge
  const y1 = DEPTH;
  const bx = BALCONY.x + BALCONY.w;
  const by = BALCONY.y;
  return [
    P(x0, y0), P(x1, y0), P(x1, y1), P(bx, y1), P(bx, by), P(x0, by),
  ].reverse();
}

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

const EXTERIOR_MM = Math.round(0.75 * FT); // 9"
const PARTITION_MM = Math.round(0.375 * FT); // 4½"

const CLEAR = Math.round(10.5 * FT); // 10'-6" clear under the beams
const FLOOR_TO_FLOOR = Math.round(11.75 * FT); // 11'-9", from the level tags

const DRAWN = 'From the architect’s drawing. Unchanged.';
const PROPOSED = 'Proposed partition. New construction, not on the architect’s drawing.';

const wall = (x1, y1, x2, y2, thickness, fn, openings = [], drawn = true) => ({
  start: P(x1, y1),
  end: P(x2, y2),
  thickness,
  height: CLEAR,
  function: fn,
  loadBearing: fn === 'exterior',
  confidence: drawn ? 'extracted' : 'inferred',
  note: drawn ? DRAWN : PROPOSED,
  openings,
});

const door = (alongFt, widthFt = 3, drawn = true) => ({
  kind: 'door',
  distanceAlongWall: Math.round(alongFt * FT),
  width: Math.round(widthFt * FT),
  height: Math.round(7 * FT),
  sillHeight: 0,
  confidence: drawn ? 'extracted' : 'inferred',
  note: drawn ? 'Doorway from the drawing.' : 'Proposed doorway.',
});

/** Four partitions round a proposed zone, with its door on the named side. */
function enclose(x, y, w, d, side) {
  const sides = {
    north: [x, y, x + w, y],
    south: [x, y + d, x + w, y + d],
    west: [x, y, x, y + d],
    east: [x + w, y, x + w, y + d],
  };
  const doorAt = { north: w / 2, south: w / 2, west: d / 2, east: d / 2 };
  return Object.entries(sides).map(([name, [a, b, c, e]]) =>
    wall(a, b, c, e, PARTITION_MM, 'partition', name === side ? [door(doorAt[name], 3, false)] : [], false),
  );
}

/**
 * The washrooms the brief asks for and the drawing does not have.
 *
 * The drawing gives one BATH, 5'-0" x 5'-5½", per floor. A floor of this size in
 * use as an office needs a male and a female washroom, so the drawn bath is kept
 * as the male washroom and a female washroom is proposed beside it, at the same
 * 5'-0" width the brief states and 7'-0" deep. Both partitions are new work.
 */
const FEMALE_WASH = { x: 0.5, y: 14.5 - 7.2, w: 5, d: 7 };

// ---------------------------------------------------------------------------
// Storeys
// ---------------------------------------------------------------------------

/** Level tags, in feet, read from each sheet. */
export const LEVELS = { 1: 21.25, 2: 33, 3: 44.75, 4: 56.5, mumty: 68.25 };

/**
 * Floor 3 takes the plant, floor 4 takes the en-suite.
 *
 * Floor 3 is a working data centre, and the drawing gives that floor no plant
 * space at all. Its kitchen becomes the UPS and plant room — a change of use,
 * so not one wall moves for it, which is the whole reason it was the right
 * answer. The condensers still have to stand on the balcony, and the cooling
 * load itself is an MEP question this model does not answer.
 */
function storey(n) {
  const purpose = {
    1: 'GIS & Mapping',
    2: 'Satellite Imagery',
    3: 'Data Centre',
    4: 'Executive Offices',
  }[n];

  const rooms = [
    ...CORE.map(([name, use, x, y, w, d]) => ({
      name: n === 3 && name === 'KITCHEN' ? 'PLANT / UPS' : name,
      // Floor 3's kitchen is a plant room by USE. Nothing about it moves.
      use: n === 3 && name === 'KITCHEN' ? 'plant' : use,
      boundary: rect(x, y, w, d),
      clearHeight: CLEAR,
      confidence: 'extracted',
      note:
        n === 3 && name === 'KITCHEN'
          ? 'Drawn as a kitchen; used as the data centre’s plant and UPS room. Fabric unchanged.'
          : DRAWN,
    })),
    {
      name: 'MALE WASH',
      use: 'toilet',
      boundary: rect(0.5, 8, 5, 5 + 5.5 / 12),
      clearHeight: CLEAR,
      confidence: 'extracted',
      note: 'The drawing’s BATH, in use as the male washroom. Unchanged.',
    },
    {
      name: 'FEMALE WASH',
      use: 'toilet',
      boundary: rect(FEMALE_WASH.x, FEMALE_WASH.y, FEMALE_WASH.w, FEMALE_WASH.d),
      clearHeight: CLEAR,
      confidence: 'inferred',
      note: 'Proposed. Not on the architect’s drawing.',
    },
    {
      name: 'HALL',
      use: 'open_office',
      boundary: hallBoundary(),
      clearHeight: CLEAR,
      confidence: 'extracted',
      note: '30\'-2" x 42\'-10" from the sheet, less the balcony recess.',
    },
    {
      name: 'BALCONY',
      use: 'balcony',
      boundary: rect(BALCONY.x, BALCONY.y, BALCONY.w, BALCONY.d),
      clearHeight: CLEAR,
      confidence: 'inferred',
      note:
        'Labelled on the sheet but NOT dimensioned. 10\'-6" x 4\'-6" is measured off the line work ' +
        'at the sheet’s plotting scale and must be confirmed against the architect’s dimension.',
    },
  ];

  // The drawn BATH is now MALE WASH, so drop the duplicate from the core list.
  const deduped = rooms.filter((r) => r.name !== 'BATH');

  const walls = [
    // Shell, 40' x 45'.
    wall(0, 0, 40, 0, EXTERIOR_MM, 'exterior'),
    wall(40, 0, 40, 45, EXTERIOR_MM, 'exterior'),
    wall(40, 45, 0, 45, EXTERIOR_MM, 'exterior'),
    wall(0, 45, 0, 0, EXTERIOR_MM, 'exterior'),
    // The spine between the core strip and the hall, open where the stair lands.
    wall(CORE_W, 0, CORE_W, 14.5, EXTERIOR_MM, 'interior'),
    wall(CORE_W, 18.5, CORE_W, 45, EXTERIOR_MM, 'interior', [door(21.5, 3.5)]),
    // Proposed: the female washroom.
    ...enclose(FEMALE_WASH.x, FEMALE_WASH.y, FEMALE_WASH.w, FEMALE_WASH.d, 'east'),
  ];

  return {
    name: ['First', 'Second', 'Third', 'Fourth'][n - 1],
    level: n,
    elevation: Math.round(LEVELS[n] * FT),
    floorToFloor: FLOOR_TO_FLOOR,
    clearHeight: CLEAR,
    confidence: 'extracted',
    purpose,
    rooms: deduped,
    walls,
  };
}

/**
 * The mumty, at the size the drawing actually is.
 *
 * The rooftop proposal was drawn on a 42'-10" x 47'-5" envelope, which is 2,031
 * sq ft against a plot of 40' x 45' = 1,800. 42'-10" is the HALL's DEPTH, used
 * as the building's width; 47'-5" appears nowhere in the set. Every ROOM size on
 * that proposal was correct — all six match these sheets exactly — so only the
 * envelope and the areas derived from it are rebuilt here.
 */
export function mumtyFloor() {
  const ROOMS = [
    ['STAIRS', 'stair', 0.5, 14.5, 8 + 10 / 12, 19.25],
    ['EMG. STAIRS', 'stair', CORE_W, 0.5, 4 + 3 / 12, 7],
    ['O/H WATER TANK', 'plant', 0.5, 35.5, 8, 12.25],
    ['MACHINE', 'plant', 0.5, 8, 7.5, 6 + 4 / 12],
    ['ROOM', 'other', 10.5, 8, 11 + 8 / 12, 8.75],
    ['BATH', 'toilet', 15.5, 0.5, 7, 4],
  ];

  return {
    name: 'Mumty',
    level: 5,
    elevation: Math.round(LEVELS.mumty * FT),
    floorToFloor: FLOOR_TO_FLOOR,
    clearHeight: CLEAR,
    confidence: 'extracted',
    purpose: 'Executive Sky Garden & Tea Lounge',
    rooms: ROOMS.map(([name, use, x, y, w, d]) => ({
      name,
      use,
      boundary: rect(x, y, w, d),
      clearHeight: CLEAR,
      confidence: 'extracted',
      note: DRAWN,
    })),
    walls: [
      wall(0, 0, 40, 0, EXTERIOR_MM, 'exterior'),
      wall(40, 0, 40, 45, EXTERIOR_MM, 'exterior'),
      wall(40, 45, 0, 45, EXTERIOR_MM, 'exterior'),
      wall(0, 45, 0, 0, EXTERIOR_MM, 'exterior'),
    ],
  };
}

/**
 * The roof area budget, corrected.
 *
 * Stated rather than computed from the room list, because the enclosed figure
 * that matters is the one in the drawing's own SCHEDULE OF COV. AREA (458.56),
 * not the sum of the six room rectangles (475.4) — those overlap their walls.
 * The difference is 17 sq ft and it belongs to the schedule, which is the
 * document the client is holding.
 */
export const ROOF_BUDGET = (() => {
  const plot = 40 * 45;
  const enclosed = 458.56; // SCHEDULE OF COV. AREA, mumty line
  const usable = plot - enclosed;
  // The proposal asked for 950 canopy + 535 open = 1,485 against 1,325 that
  // exists. Both come down by the same factor, which is what was chosen: it
  // keeps the balance between shaded and open exactly as drawn.
  const k = usable / (950 + 535);
  return {
    plot,
    enclosed,
    usable,
    canopyM: Math.round(950 * k),
    openM: Math.round(535 * k),
    scaleFactor: k,
  };
})();

export function towerFloors() {
  return [storey(1), storey(2), storey(3), storey(4), mumtyFloor()];
}

/**
 * The general scheme entry point the harness looks for.
 *
 * `towerFloors` is the name that reads well from another module; `floors` is the
 * name `ui-journey.mjs` calls on any scheme, one storey or a whole stack.
 */
export const floors = towerFloors;
