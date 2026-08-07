/**
 * Material and product catalogue.
 *
 * A `Material` is a design-layer concept ("Statuario marble, honed"). A
 * `Product` is the procurable thing a price attaches to ("Statuario marble slab
 * 18 mm, Supplier X"). Keeping them apart is what lets the procurement
 * assistant answer "find me three alternatives to this marble" — the design
 * keeps referring to the same material while the product underneath changes.
 */

import type { MaterialId, ProductId, SupplierId } from '../model/ids.js';
import type { Currency, PriceUnit } from '../pricing/price.js';

export type MaterialCategory =
  | 'structure'
  | 'masonry'
  | 'flooring'
  | 'wall_finish'
  | 'ceiling'
  | 'joinery'
  | 'glazing'
  | 'metalwork'
  | 'facade'
  | 'paint'
  | 'electrical'
  | 'plumbing'
  | 'sanitary'
  | 'hvac'
  | 'lighting'
  | 'furniture'
  | 'landscape';

/**
 * How a material's quantity is measured. Determines which takeoff rule applies
 * and which price units are compatible.
 */
export type MeasureBasis = 'area' | 'length' | 'volume' | 'count' | 'mass';

export interface Material {
  readonly id: MaterialId;
  readonly name: string;
  readonly category: MaterialCategory;
  readonly basis: MeasureBasis;
  /** Unit the takeoff reports this material in. Must be convertible to the price unit. */
  readonly takeoffUnit: PriceUnit;
  /**
   * Default wastage fraction (0.10 = 10%). Requirement 41.
   * These are configurable per project; the defaults encode conventional trade
   * allowances and are shown to the user rather than applied invisibly.
   */
  readonly defaultWastage: number;
  /** Rendering hints for the 3D view. Not used in any calculation. */
  readonly appearance?: MaterialAppearance;
  /** Trades that install it, used to derive the labour lines. */
  readonly trades: readonly TradeCode[];
  readonly note?: string;
}

export interface MaterialAppearance {
  readonly baseColorHex: string;
  readonly roughness: number;
  readonly metalness: number;
  /** Physical size one texture tile covers, in millimetres. */
  readonly textureScaleMm?: number;
  readonly textureUrl?: string;
  readonly normalMapUrl?: string;
}

export type TradeCode =
  | 'mason'
  | 'helper'
  | 'carpenter'
  | 'electrician'
  | 'plumber'
  | 'painter'
  | 'tile_worker'
  | 'marble_worker'
  | 'gypsum_worker'
  | 'aluminium_glass_installer'
  | 'steel_fixer'
  | 'hvac_technician'
  | 'facade_installer'
  | 'landscaper'
  | 'general_labour';

export const TRADE_LABELS: Record<TradeCode, string> = {
  mason: 'Mason',
  helper: 'Helper',
  carpenter: 'Carpenter',
  electrician: 'Electrician',
  plumber: 'Plumber',
  painter: 'Painter',
  tile_worker: 'Tile worker',
  marble_worker: 'Marble worker',
  gypsum_worker: 'Gypsum / false-ceiling worker',
  aluminium_glass_installer: 'Aluminium and glass installer',
  steel_fixer: 'Steel fixer',
  hvac_technician: 'HVAC technician',
  facade_installer: 'Façade installer',
  landscaper: 'Landscaper',
  general_labour: 'General labour',
};

/**
 * A procurable product from a specific supplier.
 *
 * Note what is absent: a price. Prices live in their own records with their own
 * provenance and history, so one product can carry a supplier quotation, a
 * market listing and an official statistic simultaneously, each with its own
 * date and confidence.
 */
export interface Product {
  readonly id: ProductId;
  readonly materialId: MaterialId;
  readonly name: string;
  readonly brand?: string;
  readonly specification: string;
  readonly supplierId?: SupplierId;
  readonly priceUnit: PriceUnit;
  /** Origin country. Drives whether the landed-cost model applies. */
  readonly origin: 'PK' | 'CN' | 'AE' | 'TR' | 'IT' | 'DE' | 'OTHER';
  readonly minimumOrderQuantity?: number;
  readonly leadTimeDays?: number;
  readonly note?: string;
}

export interface Supplier {
  readonly id: SupplierId;
  readonly name: string;
  readonly location: string;
  readonly country: string;
  readonly categories: readonly MaterialCategory[];
  readonly contact?: string;
  readonly url?: string;
  /** Platform rating where one exists (e.g. Alibaba). Not a quality guarantee. */
  readonly rating?: number;
  readonly yearsActive?: number;
  readonly certifications?: readonly string[];
  readonly currency: Currency;
  readonly lastCheckedAt?: string;
}

/**
 * Baseline material definitions.
 *
 * These describe *what things are and how they are measured* — geometry and
 * trade facts that do not vary by market. They contain no prices, because a
 * price depends on brand, grade, city and date, none of which a shipped
 * constant can know.
 *
 * Wastage defaults follow conventional trade allowances: large-format stone
 * cuts worse than ceramic, paint loses to absorption and touch-up, cement is
 * lost to spillage and over-batching.
 */
export const BASE_MATERIALS: readonly Material[] = [
  {
    id: 'mat_cement_opc' as MaterialId,
    name: 'Ordinary Portland cement',
    category: 'structure',
    basis: 'count',
    takeoffUnit: 'bag_50kg',
    defaultWastage: 0.03,
    trades: ['mason', 'helper'],
  },
  {
    id: 'mat_steel_rebar' as MaterialId,
    name: 'Deformed steel reinforcement bar',
    category: 'structure',
    basis: 'mass',
    takeoffUnit: 'kg',
    defaultWastage: 0.05,
    trades: ['steel_fixer', 'helper'],
  },
  {
    id: 'mat_brick_common' as MaterialId,
    name: 'Common burnt clay brick',
    category: 'masonry',
    basis: 'count',
    takeoffUnit: 'thousand',
    defaultWastage: 0.05,
    trades: ['mason', 'helper'],
    appearance: { baseColorHex: '#9c5a3c', roughness: 0.95, metalness: 0 },
  },
  {
    id: 'mat_block_concrete' as MaterialId,
    name: 'Concrete block',
    category: 'masonry',
    basis: 'count',
    takeoffUnit: 'each',
    defaultWastage: 0.04,
    trades: ['mason', 'helper'],
    appearance: { baseColorHex: '#9e9e97', roughness: 0.95, metalness: 0 },
  },
  {
    id: 'mat_sand' as MaterialId,
    name: 'Sand',
    category: 'structure',
    basis: 'volume',
    takeoffUnit: 'cft',
    defaultWastage: 0.05,
    trades: ['helper'],
  },
  {
    id: 'mat_crush' as MaterialId,
    name: 'Crushed stone aggregate',
    category: 'structure',
    basis: 'volume',
    takeoffUnit: 'cft',
    defaultWastage: 0.05,
    trades: ['helper'],
  },
  {
    id: 'mat_plaster' as MaterialId,
    name: 'Cement plaster',
    category: 'wall_finish',
    basis: 'area',
    takeoffUnit: 'sqft',
    defaultWastage: 0.08,
    trades: ['mason', 'helper'],
    appearance: { baseColorHex: '#d9d5cd', roughness: 0.9, metalness: 0 },
  },
  {
    id: 'mat_paint_emulsion' as MaterialId,
    name: 'Emulsion paint',
    category: 'paint',
    basis: 'area',
    takeoffUnit: 'sqft',
    defaultWastage: 0.1,
    trades: ['painter'],
    appearance: { baseColorHex: '#f2efe9', roughness: 0.85, metalness: 0 },
  },
  {
    id: 'mat_tile_ceramic' as MaterialId,
    name: 'Ceramic floor tile',
    category: 'flooring',
    basis: 'area',
    takeoffUnit: 'sqft',
    defaultWastage: 0.1,
    trades: ['tile_worker', 'helper'],
    appearance: { baseColorHex: '#e8e4dc', roughness: 0.35, metalness: 0, textureScaleMm: 600 },
  },
  {
    id: 'mat_tile_porcelain' as MaterialId,
    name: 'Porcelain floor tile',
    category: 'flooring',
    basis: 'area',
    takeoffUnit: 'sqft',
    defaultWastage: 0.1,
    trades: ['tile_worker', 'helper'],
    appearance: { baseColorHex: '#ded9d1', roughness: 0.25, metalness: 0, textureScaleMm: 800 },
  },
  {
    id: 'mat_marble' as MaterialId,
    name: 'Marble slab flooring',
    category: 'flooring',
    basis: 'area',
    takeoffUnit: 'sqft',
    // Slab stone cuts worse than modular tile: more offcut, more matching waste.
    defaultWastage: 0.15,
    trades: ['marble_worker', 'helper'],
    appearance: { baseColorHex: '#efeeea', roughness: 0.15, metalness: 0, textureScaleMm: 1200 },
  },
  {
    id: 'mat_granite' as MaterialId,
    name: 'Granite slab',
    category: 'flooring',
    basis: 'area',
    takeoffUnit: 'sqft',
    defaultWastage: 0.15,
    trades: ['marble_worker', 'helper'],
    appearance: { baseColorHex: '#4a4a4e', roughness: 0.2, metalness: 0.05, textureScaleMm: 1200 },
  },
  {
    id: 'mat_carpet_tile' as MaterialId,
    name: 'Carpet tile',
    category: 'flooring',
    basis: 'area',
    takeoffUnit: 'sqft',
    defaultWastage: 0.08,
    trades: ['general_labour'],
    appearance: { baseColorHex: '#3d4450', roughness: 1, metalness: 0, textureScaleMm: 500 },
  },
  {
    id: 'mat_gypsum_ceiling' as MaterialId,
    name: 'Gypsum board false ceiling',
    category: 'ceiling',
    basis: 'area',
    takeoffUnit: 'sqft',
    defaultWastage: 0.12,
    trades: ['gypsum_worker', 'helper'],
    appearance: { baseColorHex: '#fbfbf9', roughness: 0.9, metalness: 0 },
  },
  {
    id: 'mat_grid_ceiling' as MaterialId,
    name: 'Mineral fibre grid ceiling',
    category: 'ceiling',
    basis: 'area',
    takeoffUnit: 'sqft',
    defaultWastage: 0.08,
    trades: ['gypsum_worker'],
    appearance: { baseColorHex: '#f4f4f0', roughness: 0.95, metalness: 0, textureScaleMm: 600 },
  },
  {
    id: 'mat_glass_glazing' as MaterialId,
    name: 'Double-glazed glass unit',
    category: 'glazing',
    basis: 'area',
    takeoffUnit: 'sqft',
    defaultWastage: 0.05,
    trades: ['aluminium_glass_installer'],
    appearance: { baseColorHex: '#a8c4cf', roughness: 0.05, metalness: 0.1 },
  },
  {
    id: 'mat_aluminium_section' as MaterialId,
    name: 'Aluminium window and door section',
    category: 'metalwork',
    basis: 'length',
    takeoffUnit: 'rft',
    defaultWastage: 0.08,
    trades: ['aluminium_glass_installer'],
    appearance: { baseColorHex: '#b9bcc0', roughness: 0.3, metalness: 0.85 },
  },
  {
    id: 'mat_acp_panel' as MaterialId,
    name: 'Aluminium composite façade panel',
    category: 'facade',
    basis: 'area',
    takeoffUnit: 'sqft',
    defaultWastage: 0.12,
    trades: ['facade_installer'],
    appearance: { baseColorHex: '#6f7479', roughness: 0.35, metalness: 0.6 },
  },
  {
    id: 'mat_stone_cladding' as MaterialId,
    name: 'Natural stone cladding',
    category: 'facade',
    basis: 'area',
    takeoffUnit: 'sqft',
    defaultWastage: 0.15,
    trades: ['marble_worker', 'mason'],
    appearance: { baseColorHex: '#b6ab99', roughness: 0.8, metalness: 0, textureScaleMm: 600 },
  },
  {
    id: 'mat_door_flush' as MaterialId,
    name: 'Flush door with frame',
    category: 'joinery',
    basis: 'count',
    takeoffUnit: 'each',
    defaultWastage: 0,
    trades: ['carpenter'],
    appearance: { baseColorHex: '#8a6242', roughness: 0.6, metalness: 0 },
  },
  {
    id: 'mat_skirting' as MaterialId,
    name: 'Skirting',
    category: 'wall_finish',
    basis: 'length',
    takeoffUnit: 'rft',
    defaultWastage: 0.1,
    trades: ['tile_worker', 'carpenter'],
  },
  {
    id: 'mat_electrical_point' as MaterialId,
    name: 'Electrical point (wiring, conduit, accessory)',
    category: 'electrical',
    basis: 'count',
    takeoffUnit: 'each',
    defaultWastage: 0.05,
    trades: ['electrician', 'helper'],
  },
  {
    id: 'mat_light_fitting' as MaterialId,
    name: 'Light fitting',
    category: 'lighting',
    basis: 'count',
    takeoffUnit: 'each',
    defaultWastage: 0.02,
    trades: ['electrician'],
  },
];

const MATERIAL_INDEX = new Map(BASE_MATERIALS.map((m) => [m.id, m]));

export function findMaterial(id: MaterialId): Material | undefined {
  return MATERIAL_INDEX.get(id);
}
