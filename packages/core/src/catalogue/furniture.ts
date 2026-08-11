/**
 * Furniture catalogue.
 *
 * Dimensions here are real. They are what the clearance validator checks against
 * and what the 3D view draws, so an approximate desk size becomes an approximate
 * room layout and eventually an approximate capacity figure. Sizes follow common
 * commercial furniture modules rather than any one manufacturer's range.
 *
 * `clearanceFront` is the space a person needs to actually use the item — chair
 * pull-out at a desk, drawer travel at a cabinet. It is the difference between a
 * layout that fits on paper and one that works.
 *
 * It describes ONE face, the item's front. Anything needing space on more than
 * one side — a cue swing all round a pool table, a foosball table with a player
 * at each end — says so in its `note`, because the field cannot express it and a
 * layout that validates would otherwise still be unusable.
 */

import type { Millimetres } from '../units.js';

export type FurnitureCategory =
  | 'desk'
  | 'chair'
  | 'table'
  | 'seating'
  | 'storage'
  | 'reception'
  | 'bed'
  | 'display'
  | 'equipment'
  | 'decor'
  // Technical and outdoor contents. `exhibit` is a plinth or model on show —
  // it occupies floor and is walked round, which is why it is furniture and not
  // decor. `outdoor` is anything that lives on a roof and has to survive being
  // rained on; keeping it apart from `seating` stops an indoor sofa being
  // offered for a terrace.
  | 'exhibit'
  | 'outdoor'
  // Recreation and hospitality contents. `games` covers the tables and boards
  // that fill a lounge floor — they are contents of a room, never rooms
  // themselves. `counter` is a serving counter; calling it a reception desk
  // because the joinery looks similar would misdescribe what the room does.
  | 'games'
  | 'counter';

export interface FurnitureItem {
  /** Stable catalogue key referenced by `FurniturePlacement.catalogueKey`. */
  readonly key: string;
  readonly name: string;
  readonly category: FurnitureCategory;
  readonly width: Millimetres;
  readonly depth: Millimetres;
  readonly height: Millimetres;
  readonly clearanceFront?: Millimetres;
  /** Style keys this item suits, matched against `Theme.furnitureStyle`. */
  readonly styles: readonly string[];
  /** Rough colour for the 3D placeholder mesh before a material is assigned. */
  readonly placeholderColorHex: string;
  readonly note?: string;
}

export const FURNITURE: readonly FurnitureItem[] = [
  {
    key: 'desk.workstation.1400',
    name: 'Workstation desk 1400',
    category: 'desk',
    width: 1400,
    depth: 700,
    height: 750,
    clearanceFront: 900,
    styles: ['contemporary.office', 'technical.workstation'],
    placeholderColorHex: '#c9c2b6',
  },
  {
    key: 'desk.workstation.1600',
    name: 'Workstation desk 1600',
    category: 'desk',
    width: 1600,
    depth: 800,
    height: 750,
    clearanceFront: 900,
    styles: ['contemporary.office', 'technical.workstation'],
    placeholderColorHex: '#c9c2b6',
  },
  {
    key: 'desk.executive.1800',
    name: 'Executive desk 1800',
    category: 'desk',
    width: 1800,
    depth: 900,
    height: 750,
    clearanceFront: 1000,
    styles: ['executive.timber', 'contemporary.office'],
    placeholderColorHex: '#6b4a30',
  },
  {
    key: 'chair.task',
    name: 'Task chair',
    category: 'chair',
    width: 620,
    depth: 620,
    height: 1150,
    styles: ['contemporary.office', 'technical.workstation'],
    placeholderColorHex: '#2f333a',
  },
  {
    key: 'chair.executive',
    name: 'Executive chair',
    category: 'chair',
    width: 700,
    depth: 720,
    height: 1250,
    styles: ['executive.timber'],
    placeholderColorHex: '#43342a',
  },
  {
    key: 'table.conference.8',
    name: 'Conference table, 8 seats',
    category: 'table',
    width: 2400,
    depth: 1200,
    height: 750,
    clearanceFront: 1200,
    styles: ['contemporary.office', 'executive.timber', 'technical.workstation'],
    placeholderColorHex: '#8a7358',
    note: 'Allow 1200 mm all round for chair pull-out and circulation.',
  },
  {
    key: 'table.conference.14',
    name: 'Conference table, 14 seats',
    category: 'table',
    width: 4200,
    depth: 1400,
    height: 750,
    clearanceFront: 1200,
    styles: ['contemporary.office', 'executive.timber'],
    placeholderColorHex: '#8a7358',
  },
  {
    key: 'reception.desk.2400',
    name: 'Reception desk 2400',
    category: 'reception',
    width: 2400,
    depth: 900,
    height: 1100,
    clearanceFront: 1200,
    styles: ['contemporary.office', 'technical.workstation', 'executive.timber'],
    placeholderColorHex: '#3c4652',
  },
  {
    key: 'seating.sofa.3',
    name: 'Three-seat sofa',
    category: 'seating',
    width: 2100,
    depth: 900,
    height: 800,
    clearanceFront: 600,
    styles: ['contemporary.office', 'executive.timber', 'lounge.recreation', 'hospitality.warm'],
    placeholderColorHex: '#4a5260',
  },
  {
    key: 'seating.lounge.chair',
    name: 'Lounge chair',
    category: 'seating',
    width: 800,
    depth: 800,
    height: 750,
    clearanceFront: 500,
    styles: ['contemporary.office', 'executive.timber', 'lounge.recreation', 'hospitality.warm'],
    placeholderColorHex: '#55606e',
  },
  {
    key: 'storage.cabinet.1000',
    name: 'Storage cabinet 1000',
    category: 'storage',
    width: 1000,
    depth: 450,
    height: 1800,
    clearanceFront: 750,
    styles: ['contemporary.office', 'technical.workstation'],
    placeholderColorHex: '#9aa0a6',
  },
  {
    key: 'display.screen.75',
    name: 'Display screen, 75 in',
    category: 'display',
    width: 1680,
    depth: 80,
    height: 960,
    styles: ['contemporary.office', 'technical.workstation', 'lounge.recreation', 'hospitality.warm'],
    placeholderColorHex: '#14181d',
  },
  {
    key: 'display.videowall.3x2',
    name: 'Video wall, 3 x 2',
    category: 'display',
    width: 3400,
    depth: 120,
    height: 1300,
    styles: ['technical.workstation'],
    placeholderColorHex: '#0d1116',
    note: 'Mission-control and demonstration rooms. Needs a viewing distance of roughly 4 m.',
  },
  {
    key: 'equipment.rack.42u',
    name: 'Server rack, 42U',
    category: 'equipment',
    width: 600,
    depth: 1000,
    height: 2000,
    clearanceFront: 1000,
    styles: ['technical.workstation'],
    placeholderColorHex: '#1c2026',
    note: 'Needs front and rear access; the front clearance figure applies to both faces.',
  },
  {
    key: 'decor.planter.large',
    name: 'Large planter',
    category: 'decor',
    width: 600,
    depth: 600,
    height: 1400,
    // Also claimed by the recreation styles. The soft seating, the planting and
    // the screen are older than the games items but a recreation lounge places
    // all of them, and a style key that reaches the pool table but not the sofa
    // hands the AI a room with nothing to sit on.
    styles: [
      'contemporary.office',
      'executive.timber',
      'technical.workstation',
      'lounge.recreation',
      'hospitality.warm',
    ],
    placeholderColorHex: '#3f5c3a',
  },
  {
    key: 'bed.double',
    name: 'Double bed',
    category: 'bed',
    width: 1500,
    depth: 2000,
    height: 600,
    clearanceFront: 700,
    styles: ['residential'],
    placeholderColorHex: '#b9aa96',
  },

  // Recreation-lounge contents. Every one of these carries both style keys, so
  // whichever single string a recreation theme puts in `furnitureStyle` reaches
  // all of them. `bed.double` is the warning here: its lone `residential` style
  // is claimed by no theme, which makes it unreachable through
  // `furnitureForStyle` and quietly absent from every layout.
  {
    key: 'games.pool.9ft',
    name: 'Pool table, 9 ft American',
    category: 'games',
    width: 2900,
    depth: 1626,
    height: 800,
    clearanceFront: 1500,
    styles: ['lounge.recreation', 'hospitality.warm'],
    placeholderColorHex: '#1e5c40',
    note: 'Cabinet size over rails and pockets; the playing surface itself is 2540 x 1270. The 1500 mm clearance is one cue length (1470 mm) and is needed on all four sides, not only the front — a table with a cue length at one end and a wall at the other cannot be played.',
  },
  {
    key: 'games.foosball',
    name: 'Foosball table',
    category: 'games',
    width: 1500,
    depth: 760,
    height: 900,
    clearanceFront: 700,
    styles: ['lounge.recreation', 'hospitality.warm'],
    placeholderColorHex: '#3f6f4f',
    note: 'Players stand at both ends and the handles slide out past the cabinet; the 700 mm clearance covers one end only.',
  },
  {
    key: 'games.dartboard',
    name: 'Dartboard, wall mounted',
    category: 'games',
    width: 600,
    depth: 120,
    height: 600,
    clearanceFront: 2370,
    styles: ['lounge.recreation', 'hospitality.warm'],
    placeholderColorHex: '#20242a',
    note: 'The 2370 mm clearance is the throw line (oche), 7 ft 9.25 in from the face of the board — the whole reason a darts lane needs floor it does not appear to occupy. Wall mounted, but a placement carries no mounting height, so it draws standing on the floor.',
  },
  {
    key: 'counter.servery.3000',
    name: 'Servery counter 3000',
    category: 'counter',
    width: 3000,
    depth: 700,
    height: 1050,
    clearanceFront: 900,
    styles: ['lounge.recreation', 'hospitality.warm'],
    placeholderColorHex: '#8a6a4a',
    note: 'The 900 mm clearance is the customer side. Staff working space behind the counter is a separate allowance and is not expressed here.',
  },
  {
    key: 'seating.stool.bar',
    name: 'Bar stool',
    category: 'seating',
    width: 400,
    depth: 400,
    height: 750,
    clearanceFront: 450,
    styles: ['lounge.recreation', 'hospitality.warm'],
    placeholderColorHex: '#6f563f',
  },
  {
    key: 'table.coffee.1200',
    name: 'Coffee table 1200',
    category: 'table',
    width: 1200,
    depth: 600,
    height: 400,
    styles: ['lounge.recreation', 'hospitality.warm'],
    placeholderColorHex: '#7d6448',
  },
  {
    key: 'storage.shoe.rack',
    name: 'Shoe rack 900',
    category: 'storage',
    width: 900,
    depth: 350,
    height: 900,
    clearanceFront: 700,
    styles: ['lounge.recreation', 'hospitality.warm'],
    placeholderColorHex: '#96795a',
  },
  {
    key: 'decor.prayer.rug',
    name: 'Prayer rug',
    category: 'decor',
    width: 1200,
    depth: 700,
    height: 20,
    clearanceFront: 0,
    styles: ['lounge.recreation', 'hospitality.warm'],
    placeholderColorHex: '#6d2f36',
    note: 'Laid in rows and stood on, not walked around, so the clearance is deliberately zero rather than absent — an inherited default here would reserve floor that a prayer hall needs for the next row.',
  },
  {
    key: 'exhibit.plinth.1200',
    name: 'Display plinth 1200',
    category: 'exhibit',
    width: 1200,
    depth: 1200,
    height: 900,
    clearanceFront: 900,
    styles: ['technical.workstation', 'contemporary.office'],
    placeholderColorHex: '#2a2f36',
    note: 'Carries the globe, the satellite model and the terrain model. The clearance is all round in use, not just in front — a plinth is walked round — but the validator only grows the front face, so the layout has to hold the other three sides by hand.',
  },
  {
    key: 'exhibit.model.terrain',
    name: 'Terrain / GIS model, sunken',
    category: 'exhibit',
    width: 2400,
    depth: 2400,
    height: 450,
    clearanceFront: 900,
    styles: ['technical.workstation'],
    placeholderColorHex: '#3f5a3a',
    note: 'A built-in, not a table: it is set into the floor build-up, so its 450 mm is a raised lip rather than a leg height. Moving it later is a builder’s job, which is why it is placed against the structure and not in the middle of a circulation route.',
  },
  {
    key: 'equipment.console.monitoring',
    name: 'Monitoring console, curved',
    category: 'equipment',
    width: 3600,
    depth: 1400,
    height: 750,
    clearanceFront: 1200,
    styles: ['technical.workstation'],
    placeholderColorHex: '#23272e',
    note: 'Three operator positions on a curve. The 1,200 mm clearance is the chair run behind it, which is deeper than a desk needs because the operators sit back to a wall of screens.',
  },
  {
    key: 'equipment.ups.cabinet',
    name: 'UPS and battery cabinet',
    category: 'equipment',
    width: 1600,
    depth: 800,
    height: 2000,
    clearanceFront: 1000,
    styles: ['technical.workstation'],
    placeholderColorHex: '#4a4f55',
    note: 'Working space in front is for switchgear access. Battery ventilation and the fire strategy are MEP questions this catalogue does not answer.',
  },
  {
    key: 'equipment.crac.unit',
    name: 'Precision cooling unit (CRAC)',
    category: 'equipment',
    width: 1400,
    depth: 900,
    height: 2000,
    clearanceFront: 1000,
    styles: ['technical.workstation'],
    placeholderColorHex: '#5a6069',
    note: 'The indoor half only. Its condenser stands outside and is a separate item; a CRAC drawn without one is the commonest way a data centre layout looks finished and is not.',
  },
  {
    key: 'equipment.condenser.roof',
    name: 'Condensing unit, roof mounted',
    category: 'equipment',
    width: 1300,
    depth: 900,
    height: 1500,
    clearanceFront: 1000,
    styles: ['technical.workstation'],
    placeholderColorHex: '#8a9099',
    note: 'The outdoor half of a precision cooling split. It needs air on all four sides and above, not just in front — the clearance field can only express one face, so the layout has to hold the rest by hand. Capacity is not stated: it depends on the load, and the load depends on what goes in the racks.',
  },
  {
    key: 'outdoor.pergola.4x4',
    name: 'Shade canopy bay, 4 m x 4 m',
    category: 'outdoor',
    width: 4000,
    depth: 4000,
    height: 2600,
    styles: ['hospitality.warm'],
    placeholderColorHex: '#e8e3d8',
    note: 'One bay of tensile shade on four legs. No clearance: you walk under it, and reserving floor round a canopy would delete the terrace it exists to make usable.',
  },
  {
    key: 'outdoor.planter.trough',
    name: 'Planter trough 1800',
    category: 'outdoor',
    width: 1800,
    depth: 600,
    height: 700,
    styles: ['hospitality.warm'],
    placeholderColorHex: '#6b5a48',
    note: 'Run end to end to make a green edge and a guard to the parapet. Height is deliberately below the 1,050 mm a balustrade needs — it screens, it does not restrain, and it must not be relied on as protection.',
  },
  {
    key: 'outdoor.solar.panel',
    name: 'PV module, framed',
    category: 'outdoor',
    width: 1700,
    depth: 1130,
    height: 40,
    styles: ['hospitality.warm', 'technical.workstation'],
    placeholderColorHex: '#1b2a44',
    note: 'One standard 60-cell module. Mounted tilted on a frame over the roof, so the plan footprint it occupies is shaded floor rather than lost floor. Output is not stated: that depends on the array, the inverter and the site, none of which are known here.',
  },
];

const FURNITURE_INDEX = new Map(FURNITURE.map((f) => [f.key, f]));

export function findFurniture(key: string): FurnitureItem | undefined {
  return FURNITURE_INDEX.get(key);
}

export function furnitureForStyle(style: string): readonly FurnitureItem[] {
  return FURNITURE.filter((f) => f.styles.includes(style));
}
