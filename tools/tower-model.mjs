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


/**
 * The front elevation, composed from the plan itself.
 *
 * The plan divides the 40 ft frontage into three and they add to it exactly:
 *
 *   x  0'-0" .. 9'-10"   solid    the core strip — stair, lift, bath
 *   x  9'-10" .. 20'-4"  louvred  the balcony bay, behind the M.S fin screen
 *   x 20'-4" .. 40'-0"   glazed   the hall's front
 *
 * That is the left pier, the fin screen and the glass in the site photograph, in
 * that order, and it is why the composition needed no guessing: it was already
 * in the floor plan.
 *
 * The south wall is drawn from (40,45) to (0,45), so distance along it runs FROM
 * the east corner — the glazed run starts at 0 and is 19'-8" long.
 */
const GLAZED_W = 40 - (20 + 4 / 12);

/** A glazed opening across the hall's front, for one storey. */
const frontGlazing = (heightFt, sillFt) => ({
  kind: 'window',
  distanceAlongWall: Math.round((GLAZED_W / 2) * FT),
  width: Math.round(GLAZED_W * FT),
  height: Math.round(heightFt * FT),
  sillHeight: Math.round(sillFt * FT),
  confidence: 'extracted',
  note: 'Glazing to the hall front. The FRONT ELEVATION sheet labels eleven GLASS panels; this is the run they divide.',
});

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

const EXTERIOR_MM = Math.round(0.75 * FT); // 9"
const PARTITION_MM = Math.round(0.375 * FT); // 4½"

/**
 * Heights, from the FRONT ELEVATION (page 48) rather than assumed.
 *
 * The elevation writes the stack out floor by floor: 11'-0" clear plus a 9"
 * slab on floors 1 to 4, and 8'-6" clear plus a 6" slab at the mumty. Both were
 * wrong here before — a flat 10'-6" clear, and the mumty given the same 11'-9"
 * as a full storey.
 *
 * The check that says these are right: the mumty's level tag is +68'-3", and
 * 68'-3" + 9'-0" = 77'-3", which is the total height the elevation states. The
 * old figures put the top at 80'-0", two feet nine too tall.
 */
const CLEAR = Math.round(11 * FT); // 11'-0" clear, floors 1-4
const FLOOR_TO_FLOOR = Math.round(11.75 * FT); // 11'-0" + 9" slab
const MUMTY_CLEAR = Math.round(8.5 * FT); // 8'-6"
const MUMTY_FLOOR_TO_FLOOR = Math.round(9 * FT); // 8'-6" + 6" slab
/** Top of the building above road level, stated on the elevation. */
export const TOTAL_HEIGHT_FT = 77.25;

const DRAWN = 'From the architect’s drawing. Unchanged.';
const PROPOSED = 'Proposed partition. New construction, not on the architect’s drawing.';
const PROPOSED_ROOM = 'Proposed. Formed by new partitions inside the drawn hall.';

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

/**
 * Four partitions round a proposed zone, with its door on the named side.
 *
 * `where` is the fraction along that wall the door sits at, 0.5 by default. It
 * exists because a door in the middle of the long wall of a 7 ft office swings
 * straight into the desk — the app's own validator refused all four offices for
 * exactly that, and the fix is to hang the door in the corner, which is where a
 * small office's door goes anyway.
 */
function enclose(x, y, w, d, side, where = 0.5) {
  const sides = {
    north: [x, y, x + w, y],
    south: [x, y + d, x + w, y + d],
    west: [x, y, x, y + d],
    east: [x + w, y, x + w, y + d],
  };
  const doorAt = { north: w * where, south: w * where, west: d * where, east: d * where };
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


/**
 * Floor 4's executive suites, which ARE on the reference design.
 *
 * The 2D and 3D sheets both draw them: four enclosed offices at the corners of
 * the hall, each with its own washroom, a boardroom across the middle and an
 * open lounge south of it. They are not on the ARCHITECT's drawing — that sheet
 * shows one open hall — so every wall below is `inferred` and carries a note
 * saying it is new construction, exactly as the basement's partitions do.
 *
 * The zones are 11'-0" x 10'-6" at each corner. Each is split: a 7'-0" wide
 * office and a 4'-0" x 5'-0" en-suite against the outer wall, which is the only
 * arrangement that fits a washroom in without making the office too narrow to
 * put a desk across.
 *
 * All of it sits inside the hall's own outline and clear of the balcony recess
 * at x 9'-10"..20'-4", y 40'-6"..45'-0".
 */
const EXEC_SUITES = [
  // [office name, ox, oy, ow, od, en-suite name, sx, sy, sw, sd, office door side]
  ['EXECUTIVE OFFICE 1', 14.3, 2.7, 7, 10.5, 'EXEC WASH 1', 10.3, 2.7, 4, 5, 'east'],
  ['EXECUTIVE OFFICE 2', 28.7, 2.7, 7, 10.5, 'EXEC WASH 2', 35.7, 2.7, 4, 5, 'west'],
  ['EXECUTIVE OFFICE 3', 14.3, 29, 7, 10.5, 'EXEC WASH 3', 10.3, 34.5, 4, 5, 'east'],
  ['EXECUTIVE OFFICE 4', 28.7, 29, 7, 10.5, 'EXEC WASH 4', 35.7, 34.5, 4, 5, 'west'],
];

/** The boardroom, across the middle of the floor on the long axis. */
const BOARDROOM = { x: 16, y: 16, w: 18, d: 10 };

/** The rooms floor 4 adds inside its hall, and the partitions that make them. */
function executiveSuites() {
  const rooms = [];
  const walls = [];
  for (const [name, ox, oy, ow, od, wname, sx, sy, sw, sd, side] of EXEC_SUITES) {
    rooms.push({
      name,
      use: 'executive_office',
      boundary: rect(ox, oy, ow, od),
      clearHeight: CLEAR,
      confidence: 'inferred',
      note: PROPOSED_ROOM,
    });
    rooms.push({
      name: wname,
      use: 'toilet',
      boundary: rect(sx, sy, sw, sd),
      clearHeight: CLEAR,
      confidence: 'inferred',
      note: PROPOSED_ROOM,
    });
    // Door in the far corner, clear of the desk: north-end offices hang theirs
    // at the south end of the wall and vice versa.
    walls.push(...enclose(ox, oy, ow, od, side, oy < 20 ? 0.88 : 0.12));
    // The en-suite opens off its own office, so its door faces the office.
    walls.push(...enclose(sx, sy, sw, sd, side === 'east' ? 'east' : 'west'));
  }
  rooms.push({
    name: 'BOARDROOM',
    use: 'conference',
    boundary: rect(BOARDROOM.x, BOARDROOM.y, BOARDROOM.w, BOARDROOM.d),
    clearHeight: CLEAR,
    confidence: 'inferred',
    note: PROPOSED_ROOM,
  });
  walls.push(...enclose(BOARDROOM.x, BOARDROOM.y, BOARDROOM.w, BOARDROOM.d, 'west', 0.2));
  return { rooms, walls };
}

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
  // Floor 4 alone is subdivided. Its hall keeps its full outline — the suites
  // sit inside it — so the schedule area does not change and the partitions are
  // additions to the model rather than edits to it.
  const suites = n === 4 ? executiveSuites() : { rooms: [], walls: [] };

  const walls = [
    // Shell, 40' x 45'.
    wall(0, 0, 40, 0, EXTERIOR_MM, 'exterior'),
    wall(40, 0, 40, 45, EXTERIOR_MM, 'exterior'),
    wall(40, 45, 0, 45, EXTERIOR_MM, 'exterior', [frontGlazing(9, 1)]),
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
    rooms: [...deduped, ...suites.rooms],
    walls: [...walls, ...suites.walls],
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
    // The enclosed set, north-west to south, exactly as the mumty sheet lays it
    // out. The tank has to start at the north edge: at y 35.5 its 12'-3" would
    // finish at 47'-9", two feet outside a 45' building.
    ['O/H WATER TANK', 'plant', 0.5, 0.5, 8, 12.25],
    ['EMG. STAIRS', 'stair', CORE_W, 0.5, 4 + 3 / 12, 7],
    ['BATH', 'toilet', 15, 0.5, 7, 4],
    ['ROOM', 'other', 10.5, 8, 11 + 8 / 12, 8.75],
    ['STAIRS', 'stair', 0.5, 14.5, 8 + 10 / 12, 19.25],
    ['MACHINE', 'plant', 0.5, 35.5, 7.5, 6 + 4 / 12],
    // The open terrace, in two parts. One polygon round the enclosed boxes
    // would be deeply concave and buy nothing; two rectangles tile the same
    // roof, stay convex, and let the design label each for what it holds — the
    // east is the garden and the west is where the PV goes.
    ['ROOF', 'terrace', 22.5, 0.5, 17.5, 44],
    ['ROOF (WEST)', 'terrace', CORE_W, 20, 12.67, 24.5],
  ];

  return {
    name: 'Mumty',
    level: 5,
    elevation: Math.round(LEVELS.mumty * FT),
    floorToFloor: MUMTY_FLOOR_TO_FLOOR,
    clearHeight: MUMTY_CLEAR,
    confidence: 'extracted',
    purpose: 'Executive Sky Garden & Tea Lounge',
    rooms: ROOMS.map(([name, use, x, y, w, d]) => ({
      name,
      use,
      boundary: rect(x, y, w, d),
      clearHeight: MUMTY_CLEAR,
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

/**
 * The ground floor, at +2'-6" above road level.
 *
 * The hall is the same 30'-2" x 42'-10" as every floor above, but a large part
 * of it is DOUBLE HEIGHT — the mezzanine sheet marks "LOOK BELOW" over it, and
 * the level tags make the void 18'-9" tall, from +2'-6" up to the first floor at
 * +21'-3". That double height is the lobby in all three ground-floor concepts.
 */
export function groundFloor() {
  const rooms = [
    ...CORE.map(([name, use, x, y, w, d]) => ({
      name,
      use,
      boundary: rect(x, y, w, d),
      clearHeight: CLEAR,
      confidence: 'extracted',
      note: DRAWN,
    })),
    {
      name: 'LOBBY',
      use: 'lobby',
      // "LOBBY 10'-0" WIDE" is the only figure the sheet gives it — a width and
      // no depth — so it is taken as the strip inside the entrance, its length
      // set by the hall it opens off.
      boundary: rect(CORE_W, 30, 10, 14.5),
      clearHeight: Math.round(18.75 * FT),
      confidence: 'inferred',
      note: 'The sheet states its WIDTH only (10\'-0"). The depth is taken from the hall it opens off.',
    },
    {
      name: 'HALL',
      use: 'lobby',
      boundary: hallBoundary(),
      clearHeight: Math.round(18.75 * FT),
      confidence: 'extracted',
      note: '30\'-2" x 42\'-10", double height under the mezzanine void: +2\'-6" to +21\'-3".',
    },
    {
      name: 'BALCONY',
      use: 'balcony',
      boundary: rect(BALCONY.x, BALCONY.y, BALCONY.w, BALCONY.d),
      clearHeight: CLEAR,
      confidence: 'inferred',
      note: 'Labelled, not dimensioned. Measured off the line work.',
    },
  ];
  return {
    name: 'Ground',
    level: 0,
    elevation: Math.round(2.5 * FT),
    floorToFloor: Math.round(9.75 * FT), // +2'-6" to +12'-3"
    clearHeight: Math.round(18.75 * FT),
    confidence: 'extracted',
    purpose: 'Reception, Lounge, Conference, Tuck Shop',
    rooms: rooms.filter((r) => r.name !== 'BATH').concat([{
      name: 'BATH',
      use: 'toilet',
      boundary: rect(0.5, 8, 5, 5 + 5.5 / 12),
      clearHeight: CLEAR,
      confidence: 'extracted',
      note: DRAWN,
    }]),
    walls: [
      wall(0, 0, 40, 0, EXTERIOR_MM, 'exterior'),
      wall(40, 0, 40, 45, EXTERIOR_MM, 'exterior'),
      // The entrance, in the GLAZED run — not in the balcony bay, which is where
      // it was and where there is a fin screen in front of it.
      wall(40, 45, 0, 45, EXTERIOR_MM, 'exterior', [
        door(GLAZED_W / 2, 8),
        frontGlazing(16, 2.5),
      ]),
      wall(0, 45, 0, 0, EXTERIOR_MM, 'exterior'),
      wall(CORE_W, 0, CORE_W, 14.5, EXTERIOR_MM, 'interior'),
      wall(CORE_W, 18.5, CORE_W, 45, EXTERIOR_MM, 'interior', [door(21.5, 3.5)]),
    ],
  };
}

/**
 * The mezzanine, at +12'-3", and it is NOT L-shaped.
 *
 * The concept boards draw it wrapping two sides of the lobby. The sheet writes
 * "MEZZANINE 29'-1" x 13'-8"" — one rectangle, 397 sq ft, spanning nearly the
 * hall's full 30'-2" width and only 13'-8" of its 42'-10" depth. The rest of the
 * hall below is marked LOOK BELOW twice: it is the void, not more floor.
 *
 * This is why the schedule and the drawing disagree by so much on this storey.
 * The SCHEDULE OF COV. AREA counts 1,717.34 for the mezzanine like every other
 * floor, because covered area counts the void; the drawing's own rooms come to
 * 592. Both are right about different things, and the 592 is the one you can
 * stand on.
 */
export function mezzanineFloor() {
  const MEZZ = { x: CORE_W, y: 2 + 2 / 12, w: 29 + 1 / 12, d: 13 + 8 / 12 };
  const rooms = [
    ['PA ROOM', 'office', 0.5, 0.5, 8 + 10 / 12, 7],
    ['EMG. STAIRS', 'stair', CORE_W, 0.5, 4 + 3 / 12, 7],
    ['BATH', 'toilet', 0.5, 8, 5, 5 + 5.5 / 12],
    ['LANDING', 'circulation', 0.5, 14.5, 8 + 10 / 12, 8],
    ['LIFT', 'lift', 0.5, 35.5, 7.5, 6 + 4 / 12],
  ].map(([name, use, x, y, w, d]) => ({
    name,
    use,
    boundary: rect(x, y, w, d),
    clearHeight: Math.round(9 * FT),
    confidence: 'extracted',
    note: DRAWN,
  }));
  rooms.push({
    name: 'MEZZANINE',
    use: 'open_office',
    boundary: rect(MEZZ.x, MEZZ.y, MEZZ.w, MEZZ.d),
    clearHeight: Math.round(9 * FT),
    confidence: 'extracted',
    note: '29\'-1" x 13\'-8" from the sheet. ONE RECTANGLE — the concept boards show an L, the drawing does not.',
  });
  return {
    name: 'Mezzanine',
    level: 0.5,
    elevation: Math.round(12.25 * FT),
    floorToFloor: Math.round(9 * FT), // +12'-3" to +21'-3"
    clearHeight: Math.round(9 * FT),
    confidence: 'extracted',
    purpose: 'PA Room, Meeting Lounge, Open Work / Display',
    rooms,
    walls: [
      wall(0, 0, 40, 0, EXTERIOR_MM, 'exterior'),
      wall(40, 0, 40, 45, EXTERIOR_MM, 'exterior'),
      wall(40, 45, 0, 45, EXTERIOR_MM, 'exterior', [frontGlazing(7, 1)]),
      wall(0, 45, 0, 0, EXTERIOR_MM, 'exterior'),
      wall(CORE_W, 0, CORE_W, 14.5, EXTERIOR_MM, 'interior'),
      // The mezzanine's open edge onto the void. A guard, not a wall.
      wall(CORE_W, MEZZ.y + MEZZ.d, CORE_W + MEZZ.w, MEZZ.y + MEZZ.d, PARTITION_MM, 'partition', [], false),
    ],
  };
}

export function towerFloors() {
  return [groundFloor(), mezzanineFloor(), storey(1), storey(2), storey(3), storey(4), mumtyFloor()];
}

/**
 * The general scheme entry point the harness looks for.
 *
 * `towerFloors` is the name that reads well from another module; `floors` is the
 * name `ui-journey.mjs` calls on any scheme, one storey or a whole stack.
 */
export const floors = towerFloors;
