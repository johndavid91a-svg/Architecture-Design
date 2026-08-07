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
  | 'decor';

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
];

const FURNITURE_INDEX = new Map(FURNITURE.map((f) => [f.key, f]));

export function findFurniture(key: string): FurnitureItem | undefined {
  return FURNITURE_INDEX.get(key);
}

export function furnitureForStyle(style: string): readonly FurnitureItem[] {
  return FURNITURE.filter((f) => f.styles.includes(style));
}
