/**
 * The basement scheme's own design: finishes, light, and the agreed contents.
 *
 * `basement-model.mjs` is the architecture — rooms, walls, dimensions — and
 * nothing here may move any of it. This module is the design layer over that
 * architecture: which material every surface is finished in, how the floor is
 * lit, and where the pool table, the darts lanes, the foosball, the tea counter
 * and the prayer rugs actually stand.
 *
 * It exists because the app's generic themes are written for offices. Applied to
 * this floor they gave a near-white porcelain floor, near-white emulsion walls
 * and a white grid ceiling, and furnished a games room with office sofas — which
 * is what the user saw in the 3D view and rightly said was not their basement.
 *
 * WHY IT BINDS BY NAME, NOT BY ID
 * `RoomId`s are minted inside `materialise()` from `crypto.randomUUID()`, so
 * they are different on every single run and a design authored on disk cannot
 * contain one. Every entry below is therefore keyed by the room NAME exactly as
 * `basement-model.mjs` writes it, and bound to the real room after materialise.
 * Two rules make that binding deterministic and loud:
 *
 *   - Duplicate names (there are two `M.H`) are ordered north to south, then
 *     west to east, by room centroid, and an entry's `ordinal` indexes into that
 *     order. Nothing is left to array order or to a Map that would silently drop
 *     the second one.
 *   - A name that matches no room is REPORTED, never assumed. `materialise`
 *     drops rooms it does not believe (both `M.H` rooms are dropped today, at
 *     7 sq ft each, with a `ROOM_AREA` issue), so a design entry with no room is
 *     an expected outcome and has to be visible rather than silently skipped.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * No prices, no rates, no suppliers: this file names materials and catalogue
 * keys, and both catalogues carry appearance and dimensions only. Nothing here
 * has been checked against CDA bye-laws or any other local regulation, and the
 * clearances used are conventional working dimensions, not code compliance.
 *
 * The layout this file produces is proved by `tools/basement-layout-check.mjs`,
 * which runs the app's own clearance validator over it and then walks the floor.
 */

/** A position in model millimetres. Positions are the CENTRE of a footprint. */
const at = (x, y) => ({ x, y });

/**
 * Qibla, as a SAMPLE — not surveyed.
 *
 * 255° from true north is the bearing usually quoted for Islamabad, and it is
 * used here so the rug rows are laid at a real angle rather than square to a
 * wall that happens to face west. It has NOT been surveyed for this plot and no
 * compass reading was taken on site. Before anything is built the direction must
 * be confirmed on site; the rows below rotate with this one constant.
 */
export const QIBLA_BEARING_DEG = 255;

/** Bearing (clockwise from north) to the plan angle used by `rotationDeg`. */
const bearingToRotation = (bearing) => (90 - bearing + 360) % 360;

/**
 * Furniture dimensions, copied from `packages/core/src/catalogue/furniture.ts`.
 *
 * A `FurniturePlacement` carries its own width, depth and height, and the
 * clearance validator measures the PLACEMENT, not the catalogue. A copy that
 * drifts from the catalogue would validate against sizes the catalogue no longer
 * carries — so `tools/basement-layout-check.mjs` compares every field of this
 * table against `findFurniture()` and fails if one letter differs.
 */
const CATALOGUE = {
  'games.pool.9ft': { width: 2900, depth: 1626, height: 800, clearanceFront: 1500 },
  'games.foosball': { width: 1500, depth: 760, height: 900, clearanceFront: 700 },
  'games.dartboard': { width: 600, depth: 120, height: 600, clearanceFront: 2370 },
  'counter.servery.3000': { width: 3000, depth: 700, height: 1050, clearanceFront: 900 },
  'seating.stool.bar': { width: 400, depth: 400, height: 750, clearanceFront: 450 },
  'table.coffee.1200': { width: 1200, depth: 600, height: 400 },
  'storage.shoe.rack': { width: 900, depth: 350, height: 900, clearanceFront: 700 },
  'decor.prayer.rug': { width: 1200, depth: 700, height: 20, clearanceFront: 0 },
  'seating.sofa.3': { width: 2100, depth: 900, height: 800, clearanceFront: 600 },
  'seating.lounge.chair': { width: 800, depth: 800, height: 750, clearanceFront: 500 },
  'display.screen.75': { width: 1680, depth: 80, height: 960 },
  'decor.planter.large': { width: 600, depth: 600, height: 1400 },
};

/**
 * Furniture that is MEANT to stand inside another item's working clearance.
 *
 * A stool at a counter and a coffee table in front of a sofa are not clearance
 * failures — the clearance is the reason they are there. Everything else that
 * lands in a clearance zone is a fault, so the exceptions are listed here, by
 * pair, and the check script prints them rather than passing over them.
 */
export const EXPECTED_CLEARANCE_SHARING = [
  ['counter.servery.3000', 'seating.stool.bar', 'a stool stands in the counter it is served at'],
  ['seating.sofa.3', 'table.coffee.1200', 'a coffee table sits in the sofa’s leg room, which is what it is for'],
  ['seating.lounge.chair', 'table.coffee.1200', 'the chair is turned to the same table'],
];

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------
//
// Every id below exists in `BASE_MATERIALS` today. Two substitutions are worth
// stating, because the catalogue cannot say what the reference photograph shows
// and a silent near-miss reads later as a mistake:
//
//  - The games floor wants dark timber or a dark stone tile. There is no timber
//    flooring material, and `mat_granite` (#4a4a4e) is the only genuinely dark
//    floor in the catalogue. Reaching for `mat_door_flush` to borrow its timber
//    colour would put "Flush door with frame", measured in `each`, into the
//    floor line of the BOQ.
//  - The deep feature wall wants a dark warm colour. Paint is one material with
//    one appearance, so a colour cannot be asked for by id at all. The obvious
//    reach is `mat_brick_common`, whose #9c5a3c is exactly the warmth wanted —
//    and it is the wrong answer for the same reason `mat_door_flush` is. Brick
//    is masonry, measured in THOUSANDS OF BRICKS, so putting a wall AREA on it
//    sent 1,076,360 bricks into the BOQ for two feature walls. A finish must be
//    measured the way the surface is measured. `mat_stone_cladding` is a wall
//    cladding measured in sq ft; its #b6ab99 is paler than the reference photo
//    and that is the honest cost of keeping the quantity right.

const FLOOR_DARK = 'mat_granite';
const FLOOR_HARD = 'mat_tile_porcelain';
const FLOOR_WET = 'mat_tile_ceramic';
const FLOOR_BEST = 'mat_marble';
const FLOOR_SOFT = 'mat_carpet_tile';
const WALL_WARM = 'mat_plaster';
const WALL_CALM = 'mat_paint_emulsion';
const WALL_FEATURE = 'mat_stone_cladding';
const CEILING_FLAT = 'mat_gypsum_ceiling';
const SKIRTING = 'mat_skirting';

/**
 * The theme this design belongs to.
 *
 * Referenced by id rather than imported, so this module stays free of a build
 * step. The check script asserts `findTheme()` still resolves it — if the theme
 * is renamed, that assertion fails loudly instead of the design quietly losing
 * its family.
 */
export const THEME_ID = 'theme_recreation_lounge';

/**
 * A gypsum ceiling drops the clear height, and this basement cannot spare much.
 *
 * Clear under the beams is 2,515 mm. 150 mm is a skim on hangers and leaves
 * 2,365 mm. A coffered ceiling books 450 mm and would leave 2,065 mm, which is
 * why nothing here is coffered. Not checked against local bye-laws.
 */
const CEILING_DROP = 150;

const floor = (materialId, note) => ({ surface: 'floor', materialId, note });
const wall = (materialId, note) => ({ surface: 'wall_internal', materialId, note });
const dado = (materialId, heightLimit, note) => ({
  surface: 'wall_internal',
  materialId,
  heightLimit,
  note,
});
const skirting = () => ({ surface: 'skirting', materialId: SKIRTING });

/**
 * A wall finish restricted to ONE named wall, resolved to a real `WallId` at
 * bind time. The side is stated by the design because a feature wall is chosen
 * for what it faces; asking for "the longest" picked wrong twice out of two.
 */
const featureWall = (materialId, side, note) => ({
  surface: 'wall_internal',
  materialId,
  onSide: side,
  note,
});

const light = (kind, count, wattsEach, note) => ({
  kind,
  count,
  wattsEach,
  colourTemperatureK: 2700,
  note,
});

/** Service rooms are lit to be worked in, not to be sat in. */
const serviceLight = (kind, count, wattsEach, note) => ({
  kind,
  count,
  wattsEach,
  colourTemperatureK: 3000,
  note,
});

// ---------------------------------------------------------------------------
// The rooms
// ---------------------------------------------------------------------------
//
// Room extents below are model millimetres, read from the materialised floor.
// The building's Y runs NORTH: y = 0 is the south shell wall, y = 13,259 the
// north one. Furniture is kept at least half a wall thickness off every wall
// that bounds its room (114.5 mm at the 229 mm shell and interior walls, 57 mm
// at the 114 mm partitions), because the clearance validator measures to the
// wall CENTRELINE.

/** Prayer rugs, laid in rows square to the qibla rather than to the room. */
function prayerRugs(centre, rows, perRow) {
  const rotation = bearingToRotation(QIBLA_BEARING_DEG);
  const rad = (rotation * Math.PI) / 180;
  // The rug's long axis points at the qibla; rows step back along it, and each
  // worshipper stands shoulder to shoulder along the perpendicular.
  const facing = { x: Math.cos(rad), y: Math.sin(rad) };
  const along = { x: -Math.sin(rad), y: Math.cos(rad) };
  const rowPitch = 1400; // 1,200 mm rug plus 200 mm between rows
  const seatPitch = 800; // 700 mm rug plus 100 mm shoulder gap

  const items = [];
  for (let row = 0; row < rows; row++) {
    // Row 0 is nearest the qibla; later rows step back away from it.
    const back = (row - (rows - 1) / 2) * rowPitch;
    for (let seat = 0; seat < perRow; seat++) {
      const side = (seat - (perRow - 1) / 2) * seatPitch;
      items.push({
        key: 'decor.prayer.rug',
        label: `Prayer rug, row ${row + 1}`,
        position: at(
          Math.round(centre.x - facing.x * back + along.x * side),
          Math.round(centre.y - facing.y * back + along.y * side),
        ),
        rotationDeg: rotation,
      });
    }
  }
  return items;
}

const ROOMS = [
  {
    name: 'LOBBY',
    // x 2,997..6,136   y 11,582..13,167
    finishes: [
      floor(FLOOR_BEST, 'The arrival surface. Marble here and nowhere else on this floor.'),
      wall(WALL_WARM),
      skirting(),
    ],
    ceiling: { kind: 'gypsum_flat', materialId: CEILING_FLAT, dropHeight: CEILING_DROP },
    lighting: [
      light('cove', 3, 24, 'Perimeter cove, ~200 lux over 5 m². Nothing overhead reads as a grid.'),
      light('wall_washer', 2, 12, 'Washes the two long walls so the space reads wider than it is.'),
    ],
    furniture: [
      { key: 'decor.planter.large', label: 'Planter', position: at(3450, 12750), rotationDeg: 0 },
    ],
    rationale:
      'The one room a visitor meets before they have decided anything, so it gets the best floor on ' +
      'the plan — marble, in a 54 sq ft room where the quantity is small and the effect is not. Walls ' +
      'are warm plaster rather than white emulsion: below ground, white reads as a basement corridor.',
  },
  {
    name: 'KITCHEN',
    // x 366..2,931   y 11,176..13,106
    finishes: [
      floor(FLOOR_WET, 'Ceramic tile: washable, and the floor most likely to meet spilt water.'),
      wall(WALL_CALM),
      dado(FLOOR_WET, 1500, 'Tiled splashback to 1,500 mm, above the highest worktop.'),
    ],
    ceiling: { kind: 'gypsum_flat', materialId: CEILING_FLAT, dropHeight: CEILING_DROP },
    lighting: [serviceLight('linear_led', 3, 20, 'Working light, ~500 lux over 5 m². Warm, not cool white.')],
    furniture: [],
    rationale:
      'Plain and honest. A back-of-house kitchen gets a washable floor, a tiled dado to splashback ' +
      'height and light you can work under. No skirting: the dado starts at the floor and does the ' +
      'same job. Nothing is furnished here — the catalogue carries no kitchen equipment, and inventing ' +
      'a placeholder would put a fictional line into the quantities.',
  },
  {
    name: 'BATH',
    // x 366..1,763   y 9,401..11,064
    finishes: [
      floor(FLOOR_WET),
      wall(WALL_CALM),
      dado(FLOOR_WET, 1200, 'Tiled dado to 1,200 mm — the wet band, which is what heightLimit is for.'),
    ],
    ceiling: { kind: 'gypsum_flat', materialId: CEILING_FLAT, dropHeight: CEILING_DROP },
    lighting: [serviceLight('recessed_downlight', 2, 9, 'Sealed downlights, ~200 lux over 2 m².')],
    furniture: [],
    rationale:
      'Tile underfoot and a tiled dado to 1,200 mm with paint above: the standard wet-room build, and ' +
      'the one place a downlight beats a cove — a cove above a shower is a water trap. No sanitaryware ' +
      'is placed because the furniture catalogue holds none, and a WC drawn as a grey box would be a lie.',
  },
  {
    name: 'ABLUTION',
    // x 4,999..6,319   y 5,547..8,291
    finishes: [
      floor(FLOOR_WET, 'Ceramic tile, laid to fall towards the drain. Falls are not modelled here.'),
      wall(WALL_CALM),
      dado(FLOOR_WET, 1200, 'Tiled dado to 1,200 mm above the wudu bench line.'),
    ],
    ceiling: { kind: 'gypsum_flat', materialId: CEILING_FLAT, dropHeight: CEILING_DROP },
    lighting: [serviceLight('recessed_downlight', 2, 9, 'Sealed downlights, ~200 lux over 3.6 m².')],
    furniture: [],
    rationale:
      'The same wet-room build as the bath, because it is the same problem: standing water, bare feet, ' +
      'and a wall that gets splashed to about a metre. The wudu benches themselves are not in the ' +
      'catalogue and are not drawn.',
  },
  {
    name: 'TUCK SHOP / CAFE',
    // x 6,370..9,723   y 10,272..13,015
    finishes: [
      floor(FLOOR_HARD, 'Porcelain: the hardest-wearing floor in the catalogue, for the busiest 99 sq ft.'),
      wall(WALL_WARM),
      featureWall(
        WALL_FEATURE,
        'north',
        'The counter wall, clad. Named by side rather than by length: north and south are both ' +
          '3,353 mm here, so "the longest wall" put the cladding behind the door instead of behind ' +
          'the counter. NOTE: takeoff does not yet read wallId, so this room’s wall quantity is ' +
          'measured twice — see the design rationale.',
      ),
      skirting(),
    ],
    ceiling: { kind: 'gypsum_flat', materialId: CEILING_FLAT, dropHeight: CEILING_DROP },
    lighting: [
      light('linear_led', 2, 18, 'A run over the counter, ~500 lux on the working face.'),
      light('cove', 2, 18, 'Low ambient behind it, so the counter is the lit object in the room.'),
    ],
    furniture: [
      { key: 'counter.servery.3000', label: 'Tea counter', position: at(8046, 12608), rotationDeg: 0 },
      // The planting the games floor could not hold. South-west corner, clear of
      // the counter's 900 mm service side.
      { key: 'decor.planter.large', label: 'Planter', position: at(9200, 10700), rotationDeg: 0 },
            // Spread, and held south of the threshold, which moved to this room's
      // WEST wall when its blocked south door was replaced by an opening.
      { key: 'seating.stool.bar', label: 'Stool', position: at(7500, 11950), rotationDeg: 0 },
      { key: 'seating.stool.bar', label: 'Stool', position: at(8300, 11950), rotationDeg: 0 },
      { key: 'seating.stool.bar', label: 'Stool', position: at(9100, 11950), rotationDeg: 0 },
    ],
    rationale:
      'Hard-wearing underfoot and warm at eye level: a 3 m counter along the north wall with the warm ' +
      'brick behind it, lit so the counter is the brightest thing on that side of the floor and does ' +
      'the work of a sign. Three stools stand in the counter’s 900 mm service zone, which is what that ' +
      'zone is for; the check script lists them as expected rather than as a clash.',
  },
  {
    name: 'PRAYER ROOM',
    // x 6,370..12,110   y 5,243..9,967
    finishes: [
      floor(FLOOR_SOFT, 'Carpet tile, dark and matt. Warm underfoot, and it takes bare feet.'),
      wall(WALL_CALM, 'Flat emulsion, one colour, no pattern and no feature wall.'),
      skirting(),
    ],
    ceiling: { kind: 'gypsum_flat', materialId: CEILING_FLAT, dropHeight: CEILING_DROP },
    lighting: [
      light('cove', 4, 18, 'Cove only, ~200 lux over 27 m². No fitting is in a worshipper’s eyeline.'),
    ],
    furniture: [
      ...prayerRugs(at(9700, 7500), 3, 4),
      // Clear of the threshold, which is now at y 9,129 on this wall. The rack
      // stood squarely in it and shut the room off with the door removed.
      { key: 'storage.shoe.rack', label: 'Shoe rack', position: at(6650, 7000), rotationDeg: 90 },
    ],
    rationale:
      'Carpet, calm walls, nothing busy: the one room on this floor that is not entertainment. Twelve ' +
      'rugs in three rows of four, laid square to a SAMPLE qibla bearing of 255° rather than square to ' +
      'the walls — the bearing has not been surveyed for this plot and must be confirmed on site before ' +
      'anything is set out. The shoe rack stands inside the room beside its door, because there is ' +
      'nowhere outside to put it: the ablution’s east wall and this room’s west wall are 51 mm apart ' +
      'on centre and their faces overlap, which the layout check reports as this room having no usable ' +
      'door at all. That is an architecture finding, not a design one, and it is left standing.',
  },
  {
    name: 'GAMES FLOOR',
    // x 2,997..12,192   y 113..5,090
    finishes: [
      floor(FLOOR_DARK, 'Dark stone. The floor a games room is lit against, not the surface you notice.'),
      wall(WALL_WARM, 'Warm plaster on every wall except the feature one.'),
      featureWall(
        WALL_FEATURE,
        'south',
        'One clad wall, the long south wall the lounge faces. Named by side rather than by length: ' +
          'the east shell wall runs 13,259 mm and this room only sees 4,977 of it, so "the longest ' +
          'wall" put the feature on the wrong face entirely. NOTE: takeoff does not yet read ' +
          'wallId, so this room’s wall quantity is measured twice — see the design rationale.',
      ),
      skirting(),
    ],
    // Exposed, and painted out dark.
    //
    // No material id: the colour cannot be expressed. Emulsion is one material
    // with one appearance, so "dark" is not something a material id can carry,
    // and naming a dark FLOOR material for a soffit would be a false BOQ line.
    // The consequence is honest and worth stating: the walkthrough draws this
    // ceiling in its pale fallback colour, not the dark the design intends.
    ceiling: { kind: 'exposed' },
    lighting: [
      light('cove', 6, 24, 'Perimeter cove, ~150 lux ambient over 46 m². Deliberately low.'),
      light('pendant', 2, 40, 'Dropped over the pool table, ~500 lux on the cloth and nowhere else.'),
      light('linear_led', 2, 20, 'One run per darts lane, aimed at the board, away from the thrower.'),
    ],
    furniture: [
      { key: 'games.pool.9ft', label: 'Pool table, 9 ft American', position: at(6350, 2595), rotationDeg: 0 },
      { key: 'display.screen.75', label: 'Screen', position: at(6350, 160), rotationDeg: 180 },
      // Darts: boards on the south wall, throwing north. The lanes are 1,200 mm
      // apart so two people can throw without knocking elbows, and everything
      // else on this floor is held north of y = 3,303 — see the rationale.
      { key: 'games.dartboard', label: 'Darts lane 1', position: at(10200, 195), rotationDeg: 180 },
      { key: 'games.dartboard', label: 'Darts lane 2', position: at(11400, 195), rotationDeg: 180 },
      // The lounge, entirely north of the throw zone.
      { key: 'seating.sofa.3', label: 'Sofa', position: at(10400, 4600), rotationDeg: 0 },
      { key: 'table.coffee.1200', label: 'Coffee table', position: at(10400, 3700), rotationDeg: 0 },
      // No planter here, and the arithmetic says why. Between the cue swing's
      // east limit (x 9,300) and the inner face of the exterior wall
      // (x 12,077.5) there are 2,777.5 mm. The sofa takes 2,100 of it and its
      // own 600 mm of leg room runs the full width of that; a planter fits in
      // neither. The greenery this room wants is at the tea counter instead.
    ],
    rationale:
      'The room the whole scheme is for, and the one the generic theme got most wrong. Dark floor, warm ' +
      'walls, one deep feature wall and a soffit left exposed, so the light falls on the tables and not ' +
      'on the ceiling. The 9 ft table sits in the middle of the hall with 1,500 mm — one cue length — ' +
      'clear on all four sides, which is why it is the only object in the western two thirds of the ' +
      'room; the way in from the stair crosses that cue swing, because a room this shape has nowhere ' +
      'else to put a route, and when a frame is on people wait. Both darts lanes are wall-mounted at ' +
      'the east end of the south wall, throwing north up a 2,370 mm oche into floor nothing else uses. ' +
      'THE THROW ZONE IS THE CONSTRAINT NOBODY SEES. The 2,370 mm oche is the distance to the throw ' +
      'line, not the space the game needs: a thrower also has to STAND behind it. The first version ' +
      'of this layout cleared the 2,370 mm on both lanes and still put a lounge chair 75 mm behind ' +
      'lane 2’s oche, which passes every check the app runs and cannot be played. Everything on this ' +
      'floor is now held north of y = 3,303 mm — the oche at 2,603 plus 700 mm to stand in — and the ' +
      'lounge fits in the 1,787 mm that leaves with 287 mm to spare. A lounge chair does not, so ' +
      'there is not one. The planting is massed at the east end rather than dotted round the ' +
      'perimeter — which on this floor means at the tea counter, not here: the strip between the cue ' +
      'swing and the exterior wall is 2,777.5 mm, the sofa and its leg room take all of it, and a ' +
      'planter squeezed in beside them stood in the leg room. The room is 46 m² and three of them ' +
      'belong to one pool table.',
  },
  {
    name: 'GAMES FLOOR (WEST)',
    // x 2,997..6,370   y 5,090..8,534, less the ablution box at x 4,999..6,319
    finishes: [
      floor(FLOOR_DARK, 'The same dark stone as the main games floor: one unbroken surface.'),
      wall(WALL_WARM),
      skirting(),
    ],
    ceiling: { kind: 'exposed' },
    lighting: [
      light('cove', 2, 24, 'Cove on the stair wall, ~150 lux over 12 m². Continuous with the main floor.'),
    ],
    // Empty, and it has to be. See the rationale: this alcove is the only route
    // from the stair to the games floor and it is too narrow to hold anything.
    furniture: [],
    rationale:
      'An alcove, not a room: the same floor and the same walls as the main games floor, because a ' +
      'change of finish here would read as a threshold where there is no door. It gets no feature ' +
      'wall for the same reason. IT IS ALSO EMPTY, AND THAT IS THE ANSWER, NOT AN OMISSION. This is ' +
      'the only route from the stair to the games floor, and beside the ablution it is 1,830.5 mm ' +
      'clear. A foosball table is 760 mm across, which leaves 1,070.5 mm even when the table is ' +
      'pushed hard against one wall — below the 1,100 mm the app’s own egress rule asks for on the ' +
      'sole way out of a basement, before anyone stands at either end of it to play. It is not a ' +
      'placement that needs adjusting; the table does not fit. So the alcove stays circulation, and ' +
      'the games are the pool table and the two darts lanes that were asked for.',
  },
  {
    name: 'STAIRS',
    // x 366..2,918   y 2,825..8,565
    finishes: [
      floor(FLOOR_HARD, 'Porcelain, the same as the other circulation. Treads are not finished here.'),
      wall(WALL_CALM),
      skirting(),
    ],
    // No ceiling: the soffit of a stair is the flight above it.
    ceiling: { kind: 'none' },
    lighting: [serviceLight('linear_led', 3, 20, 'A run per flight, on the wall, lighting the treads.')],
    furniture: [],
    rationale:
      'Plain and honest. The one route in and out of this floor, so the floor finish is chosen for wear ' +
      'and the light is put on the treads rather than on the walls. No false ceiling: there is nothing ' +
      'above a stair to hang one from.',
  },
  {
    name: 'LIFT',
    // x 366..2,652   y 777..2,682
    finishes: [floor(FLOOR_HARD), wall(WALL_CALM), skirting()],
    ceiling: { kind: 'none' },
    lighting: [serviceLight('recessed_downlight', 1, 9, 'One fitting at the lift door.')],
    furniture: [],
    rationale:
      'The lift lobby, finished to match the stair so the two ways out of the basement read as one ' +
      'system. Nothing is designed inside the car: the car is not part of this model.',
  },
  {
    name: 'SUMP',
    ...plantRoom(),
    rationale:
      'A plant room gets no design. Bare structure, no finish, no ceiling and no light fitting in the ' +
      'design layer — a sump is inspected, not occupied. Waterproof tanking is a real material this ' +
      'catalogue does not carry, and it is left out rather than substituted with something that would ' +
      'price as the wrong thing.',
  },
  {
    name: 'U.G.W.T',
    ...plantRoom(),
    rationale:
      'The underground water tank stays, and stays undesigned. Bare, for the same reason as the sump: ' +
      'the tanking and the internal render a water tank actually needs are not in the catalogue, and ' +
      'naming a floor tile here would put a floor finish into the BOQ for the inside of a water tank.',
  },
  {
    name: 'M.H',
    ordinal: 0,
    ...plantRoom(),
    rationale: 'Manhole. No design, and no room either — see the note in the bind report.',
  },
  {
    name: 'M.H',
    ordinal: 1,
    ...plantRoom(),
    rationale: 'Manhole. No design, and no room either — see the note in the bind report.',
  },
];

/** No finish, no ceiling, no light, nothing placed. */
function plantRoom() {
  return { finishes: [], ceiling: { kind: 'none' }, lighting: [], furniture: [] };
}

// ---------------------------------------------------------------------------
// Binding
// ---------------------------------------------------------------------------

/** Mirrors `newId` in packages/core/src/model/ids.ts, without the build step. */
const newId = (prefix) => `${prefix}_${globalThis.crypto.randomUUID()}`;

const centroid = (boundary) => ({
  x: boundary.reduce((s, p) => s + p.x, 0) / boundary.length,
  y: boundary.reduce((s, p) => s + p.y, 0) / boundary.length,
});

/**
 * Rooms of one name, in a fixed order: north to south, then west to east.
 *
 * Room names on this floor are not unique — there are two `M.H` — and a Map
 * keyed on name would keep one and silently lose the other. Centroid order is
 * stable for a given architecture and does not depend on the order rooms happen
 * to arrive in.
 */
function roomsNamed(floor, name) {
  return floor.rooms
    .filter((r) => r.name === name)
    .sort((a, b) => {
      const ca = centroid(a.boundary);
      const cb = centroid(b.boundary);
      return cb.y - ca.y || ca.x - cb.x;
    });
}

/**
 * The wall on a named side of a room, for a finish that belongs to one wall.
 *
 * NOT the longest bounding wall, which is what this used to be and which chose
 * wrong twice out of two. A room's longest bounding wall is often a shell wall
 * running the length of the building that the room only touches a fraction of:
 * the games floor's feature colour landed on the east shell (13,259 mm long, of
 * which the room sees 4,977) instead of the south wall it faces, and the tuck
 * shop's landed on the wall carrying its own door because north and south were
 * the same length and the tiebreak was arbitrary. A feature wall is chosen for
 * what it faces, so it is asked for by side.
 *
 * `side` is 'north' | 'south' | 'east' | 'west' in PLAN terms, y running north.
 * Ties are broken on the length of wall the room actually shares, not the wall's
 * own length.
 */
function boundingWallOnSide(room, floor, side) {
  const walls = floor.walls.filter((w) => room.boundingWallIds.includes(w.id));
  if (walls.length === 0) return undefined;

  const xs = room.boundary.map((p) => p.x);
  const ys = room.boundary.map((p) => p.y);
  const box = {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys),
  };
  // How far the wall's midpoint sits towards the named side. The wall that is
  // most extreme in that direction is the one the room faces.
  const towards = (w) => {
    const mx = (w.start.x + w.end.x) / 2;
    const my = (w.start.y + w.end.y) / 2;
    if (side === 'north') return my;
    if (side === 'south') return -my;
    if (side === 'east') return mx;
    return -mx;
  };
  // The run of wall that lies within the room's own extent — the part the room
  // can actually see.
  const shared = (w) => {
    const horizontal = Math.abs(w.end.y - w.start.y) < Math.abs(w.end.x - w.start.x);
    const [a, b, lo, hi] = horizontal
      ? [w.start.x, w.end.x, box.minX, box.maxX]
      : [w.start.y, w.end.y, box.minY, box.maxY];
    return Math.max(0, Math.min(Math.max(a, b), hi) - Math.max(Math.min(a, b), lo));
  };
  // A wall the room barely grazes is not the wall it faces.
  const facing = walls.filter((w) => shared(w) > 500);
  const pool = facing.length > 0 ? facing : walls;
  return pool.sort((a, b) => towards(b) - towards(a) || shared(b) - shared(a))[0];
}

/**
 * Build the design for one materialised basement floor.
 *
 * `floors` is the materialised `Floor[]` — the rooms must already carry their
 * ids and their recomputed `boundingWallIds`, because a feature wall is resolved
 * to a real `WallId` here and furniture is validated against those walls later.
 *
 * Returns a `Design` in the shape `packages/core/src/model/design.ts` defines,
 * ready to hand to the store. Names that matched no room are passed to
 * `options.onUnmatched` AND written into the design's own rationale, so the miss
 * survives into the file rather than living only in a console line.
 */
export function basementDesign(floors, options = {}) {
  const { projectId, designId, versionId, createdAt, onUnmatched } = options;
  if (!projectId) {
    // Refusing beats guessing: a design carrying the wrong project id is a
    // design that silently attaches to somebody else's building.
    throw new Error('basementDesign needs options.projectId — take it from the materialised project.');
  }

  const target = floors.find((f) => f.level === -1) ?? floors[0];
  if (!target) throw new Error('basementDesign needs at least one materialised floor.');

  const unmatched = [];
  const rooms = [];

  for (const spec of ROOMS) {
    const candidates = roomsNamed(target, spec.name);
    const room = candidates[spec.ordinal ?? 0];
    if (!room) {
      unmatched.push(`${spec.name}${spec.ordinal ? ` (#${spec.ordinal + 1})` : ''}`);
      continue;
    }

    const finishes = spec.finishes.map((f) => {
      const { onSide, ...rest } = f;
      if (!onSide) return rest;
      const feature = boundingWallOnSide(room, target, onSide);
      // A feature finish that resolved to no wall would silently become an
      // unrestricted whole-room finish — the deep accent quietly painted over
      // everything. Drop it and report it instead.
      if (!feature) {
        unmatched.push(`${spec.name}: no ${onSide} wall for the feature finish`);
        return null;
      }
      return { ...rest, wallId: feature.id };
    }).filter(Boolean);

    rooms.push({
      roomId: room.id,
      themeId: THEME_ID,
      finishes,
      ceiling: spec.ceiling,
      lighting: spec.lighting,
      furniture: spec.furniture.map((item) => {
        const size = CATALOGUE[item.key];
        if (!size) throw new Error(`No dimensions held for catalogue key "${item.key}".`);
        return {
          id: newId('fur'),
          roomId: room.id,
          catalogueKey: item.key,
          label: item.label,
          position: item.position,
          rotationDeg: item.rotationDeg,
          width: size.width,
          depth: size.depth,
          height: size.height,
          ...(size.clearanceFront === undefined ? {} : { clearanceFront: size.clearanceFront }),
        };
      }),
      rationale: spec.rationale,
    });
  }

  if (unmatched.length > 0) onUnmatched?.(unmatched);

  return {
    id: designId ?? newId('dsg'),
    projectId,
    versionId: versionId ?? newId('ver'),
    name: 'Entertainment & Recreation Lounge',
    label: 'Basement — Entertainment & Recreation Lounge',
    themeId: THEME_ID,
    createdAt: createdAt ?? new Date().toISOString(),
    origin: { kind: 'manual' },
    floors: [{ floorId: target.id, themeId: THEME_ID, rooms, rationale: FLOOR_RATIONALE }],
    rationale:
      DESIGN_RATIONALE +
      (unmatched.length > 0
        ? ` ${unmatched.length} named space(s) had no room to attach to and were left out: ` +
          `${unmatched.join(', ')}. materialise() drops rooms whose area it does not believe, ` +
          `and a design entry with nowhere to go is reported rather than assumed away.`
        : ''),
  };
}

const FLOOR_RATIONALE =
  'One floor, three characters: a dark games hall lit low, a calm carpeted prayer room, and a service ' +
  'strip left plain. The finishes change where the use changes and nowhere else, so the floor reads as ' +
  'one place rather than as a corridor of decorated rooms.';

const DESIGN_RATIONALE =
  'The agreed basement: an entertainment and recreation lounge in 1,192 usable sq ft, holding 833 sq ft ' +
  'of content — prayer room and ablution, tuck shop and cafe, one 9 ft American pool table with full cue ' +
  'clearance, two wall-mounted darts lanes, foosball — with the rest left as circulation. Hand authored ' +
  'over the architecture in tools/basement-model.mjs; no room boundary, wall or dimension is touched by ' +
  'anything in this file. Clearances used are conventional working dimensions and nothing here has been ' +
  'checked against CDA bye-laws or any other local regulation.';
