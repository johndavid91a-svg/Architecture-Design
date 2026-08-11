/**
 * The agreed basement scheme, as a floor the app can build.
 *
 * The zoning drawing is a picture; this is the model. It emits the same
 * `CandidateFloor` shape the drawing importers produce, so the scheme goes
 * through the app's own pipeline — validation, materialise, plan, 3D — rather
 * than through a special path that would let it be wrong in ways a real import
 * could not be.
 *
 * What becomes a room and what does not is a modelling decision worth stating.
 * Enclosed spaces get walls and become rooms: the prayer room, its ablution, the
 * tuck shop, and everything the architect drew. The games are NOT rooms — a pool
 * table's clearance is open floor, not a space — so they sit inside the games
 * floor, which is one room. Modelling them as rooms would double-count the area
 * and put walls where the whole point is that there are none.
 */

const FT = 304.8;
/** Building depth, so plan Y can be flipped: the model's Y runs north. */
const DEPTH = 43.5;

/** Feet, measured south from the building's north-west corner, to model mm. */
const P = (xFt, yFtSouth) => ({ x: Math.round(xFt * FT), y: Math.round((DEPTH - yFtSouth) * FT) });

/** A rectangle given in feet, south-positive, as a counter-clockwise boundary. */
const rect = (x, y, w, d) => [P(x, y + d), P(x + w, y + d), P(x + w, y), P(x, y)];

const CLEAR = Math.round(8.25 * FT); // 8'-3" clear under the beams, from Section A-A
const FLOOR_TO_FLOOR = Math.round(9.75 * FT); // 9'-9"

// ---------------------------------------------------------------------------
// Spaces
// ---------------------------------------------------------------------------

/** What the architect drew. Positions read off the basement layout sheet. */
const EXISTING = [
  ['KITCHEN', 'kitchen', 1.2, 0.5, 8.417, 6.333],
  ['BATH', 'toilet', 1.2, 7.2, 4.583, 5.458],
  ['SUMP', 'plant', 0.4, 13.2, 3, 5],
  ['M.H', 'plant', 4.2, 13.4, 2.6, 2.6],
  ['M.H', 'plant', 7.0, 13.4, 2.6, 2.6],
  ['U.G.W.T', 'plant', 10.13, 5.5, 10, 10],
  ['STAIRS', 'stair', 1.2, 15.4, 8.375, 18.833],
  ['LIFT', 'lift', 1.2, 34.7, 7.5, 6.25],
];

/** New, enclosed: these get partitions and a door. */
const ENCLOSED = [
  ['TUCK SHOP / CAFE', 'retail', 20.9, 0.8, 11, 9, 'west'],
  ['PRAYER ROOM', 'other', 20.9, 10.8, 18.83, 15.5, 'west'],
  ['ABLUTION', 'toilet', 16.4, 16.3, 4.333, 9, 'south'],
];

/**
 * The open floor, as three rectangles.
 *
 * One room would have to be an L with a bite out of it for the water tank, and a
 * concave polygon buys nothing here — three rectangles tile the same floor, keep
 * every boundary convex, and let the plan label each part for what it holds.
 */
const OPEN = [
  ['GAMES FLOOR', 'lounge', 9.833, 26.8, 30.167, 16.33],
  ['GAMES FLOOR (WEST)', 'lounge', 9.833, 15.5, 11.067, 11.3],
  ['LOBBY', 'lobby', 9.833, 0.3, 10.297, 5.2],
];

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

const EXTERIOR_MM = Math.round(0.75 * FT); // 9"
const PARTITION_MM = Math.round(0.375 * FT); // 4½"

const wall = (x1, y1, x2, y2, thickness, fn, openings = []) => ({
  start: P(x1, y1),
  end: P(x2, y2),
  thickness,
  height: CLEAR,
  function: fn,
  loadBearing: fn === 'exterior',
  confidence: fn === 'exterior' ? 'extracted' : 'inferred',
  note:
    fn === 'exterior'
      ? 'Existing shell, from the drawing.'
      : 'Proposed partition. New construction, not on the architect’s drawing.',
  openings,
});

/**
 * A way through a wall with NO DOOR IN IT.
 *
 * Modelled as a `door` opening because that is the kind the twin has for a gap
 * you walk through at floor level, but nothing hangs in it. A tuck shop counter
 * and a prayer hall in a private basement do not need one, and the two that were
 * drawn here could not be opened anyway.
 */
const opening = (alongFt, widthFt = 4) => ({
  kind: 'door',
  distanceAlongWall: Math.round(alongFt * FT),
  width: Math.round(widthFt * FT),
  height: Math.round(7 * FT),
  sillHeight: 0,
  confidence: 'inferred',
  note: 'Open threshold. No door leaf.',
});

const door = (alongFt, widthFt = 3) => ({
  kind: 'door',
  distanceAlongWall: Math.round(alongFt * FT),
  width: Math.round(widthFt * FT),
  height: Math.round(7 * FT),
  sillHeight: 0,
  confidence: 'inferred',
  note: 'Proposed doorway.',
});

/**
 * Four partitions round an enclosed zone, with its way in on the named side.
 *
 * `at` is the distance along that side, defaulting to its middle, and `wide` is
 * the opening's width. Both exist because the middle was blocked twice: the
 * prayer room's opening sat 99 mm from the ablution's outer wall and the tuck
 * shop's 155 mm from the prayer room's, and neither room could be entered at
 * all. A body needs about 550 mm.
 *
 * These are OPENINGS, not doorways — no leaf, as asked. The distinction matters
 * to the model: an opening still cuts the wall, so removing the entry entirely
 * would have sealed 391 sq ft of basement rather than freeing it.
 */
function enclose(x, y, w, d, side, at = null, wide = 4) {
  const along = (span) => (at === null ? span / 2 : at);
  const doors = {
    north: [wall(x, y, x + w, y, PARTITION_MM, 'partition', [opening(along(w), wide)])],
    south: [wall(x, y + d, x + w, y + d, PARTITION_MM, 'partition', [opening(along(w), wide)])],
    west: [wall(x, y, x, y + d, PARTITION_MM, 'partition', [opening(along(d), wide)])],
    east: [wall(x + w, y, x + w, y + d, PARTITION_MM, 'partition', [opening(along(d), wide)])],
  };
  const plain = {
    north: wall(x, y, x + w, y, PARTITION_MM, 'partition'),
    south: wall(x, y + d, x + w, y + d, PARTITION_MM, 'partition'),
    west: wall(x, y, x, y + d, PARTITION_MM, 'partition'),
    east: wall(x + w, y, x + w, y + d, PARTITION_MM, 'partition'),
  };
  return Object.entries(plain)
    .filter(([name]) => name !== side)
    .map(([, w2]) => w2)
    .concat(doors[side]);
}

/**
 * Where each proposed room's opening goes, in feet along the named side.
 *
 * Left to the middle, both of these landed against another wall — see the note
 * on `enclose`. Measured from the wall's start.
 */
const OPENING_AT = {
  // Measured from the wall's START, which for a west wall is its NORTH end.
  'PRAYER ROOM': 2.75,
  // 7'-6" and not the middle: the tea counter is 9'-10" long in an 11'-0" room,
  // so it runs almost wall to wall and there is only one stretch of this wall
  // it is not standing against.
  // 6'-6": a 4'-0" opening centred at 7'-6" runs past the end of a 9'-0"
  // wall, and an opening that does not fit its wall is no opening at all.
  'TUCK SHOP / CAFE': 6.5,
};

export function basementFloor() {
  const rooms = [
    ...EXISTING.map(([name, use, x, y, w, d]) => ({
      name,
      use,
      boundary: rect(x, y, w, d),
      clearHeight: CLEAR,
      confidence: 'extracted',
      note: 'From the architect’s drawing. Unchanged.',
    })),
    ...ENCLOSED.map(([name, use, x, y, w, d]) => ({
      name,
      use,
      boundary: rect(x, y, w, d),
      clearHeight: CLEAR,
      confidence: 'inferred',
      note: 'Proposed. New partitions inside the existing hall.',
    })),
    ...OPEN.map(([name, use, x, y, w, d]) => ({
      name,
      use,
      boundary: rect(x, y, w, d),
      clearHeight: CLEAR,
      confidence: 'inferred',
      note: 'Open floor. The games sit here; their clearance is the circulation.',
    })),
  ];

  const walls = [
    // Shell, 40' x 43'-6".
    wall(0, 0, 40, 0, EXTERIOR_MM, 'exterior'),
    wall(40, 0, 40, 43.5, EXTERIOR_MM, 'exterior'),
    wall(40, 43.5, 0, 43.5, EXTERIOR_MM, 'exterior'),
    wall(0, 43.5, 0, 0, EXTERIOR_MM, 'exterior', [door(24, 4)]),
    // The wall between the service strip and the hall, with the stair's landing
    // left open — that opening is why the games sit either side of it.
    wall(9.833, 0, 9.833, 15.4, EXTERIOR_MM, 'interior'),
    wall(9.833, 19.4, 9.833, 43.5, EXTERIOR_MM, 'interior'),
    // The prayer room's way in sits at 12'-9" along its west wall, not the 7'-9"
    // middle: the ablution stands against the first 10 ft of it, 99 mm away.
    // The tuck shop's moves off its own middle for the same reason.
    ...ENCLOSED.flatMap(([name, , x, y, w, d, side]) =>
      enclose(x, y, w, d, side, OPENING_AT[name] ?? null),
    ),
  ];

  return {
    name: 'Basement',
    level: -1,
    elevation: -FLOOR_TO_FLOOR,
    floorToFloor: FLOOR_TO_FLOOR,
    clearHeight: CLEAR,
    confidence: 'extracted',
    rooms,
    walls,
  };
}
