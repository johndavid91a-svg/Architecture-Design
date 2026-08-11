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
    styles: ['contemporary.office', 'executive.timber'],
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
    styles: ['contemporary.office', 'executive.timber'],
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
    styles: ['contemporary.office', 'technical.workstation'],
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
    styles: ['contemporary.office', 'executive.timber', 'technical.workstation'],
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
];

const FURNITURE_INDEX = new Map(FURNITURE.map((f) => [f.key, f]));

export function findFurniture(key: string): FurnitureItem | undefined {
  return FURNITURE_INDEX.get(key);
}

export function furnitureForStyle(style: string): readonly FurnitureItem[] {
  return FURNITURE.filter((f) => f.styles.includes(style));
}
