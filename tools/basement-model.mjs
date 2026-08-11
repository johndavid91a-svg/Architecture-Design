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
  ['TUCK SHOP / CAFE', 'retail', 20.9, 0.8, 11, 9, 'south'],
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

const door = (alongFt, widthFt = 3) => ({
  kind: 'door',
  distanceAlongWall: Math.round(alongFt * FT),
  width: Math.round(widthFt * FT),
  height: Math.round(7 * FT),
  sillHeight: 0,
  confidence: 'inferred',
  note: 'Proposed doorway.',
});

/** Four partitions round an enclosed zone, with its door on the named side. */
function enclose(x, y, w, d, side) {
  const doors = {
    north: [wall(x, y, x + w, y, PARTITION_MM, 'partition', [door(w / 2)])],
    south: [wall(x, y + d, x + w, y + d, PARTITION_MM, 'partition', [door(w / 2)])],
    west: [wall(x, y, x, y + d, PARTITION_MM, 'partition', [door(d / 2)])],
    east: [wall(x + w, y, x + w, y + d, PARTITION_MM, 'partition', [door(d / 2)])],
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
    ...ENCLOSED.flatMap(([, , x, y, w, d, side]) => enclose(x, y, w, d, side)),
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
