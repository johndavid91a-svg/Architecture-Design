/**
 * ESTIMATION ENGINE.
 *
 * Quantity x rate, with everything the requirements insist stays visible:
 * material and labour separated, wastage shown as its own step, transport,
 * contingency, and — most importantly — unpriced items surviving as unpriced.
 *
 * The central rule:
 *
 *   An estimate with unpriced lines reports a RANGE and a COMPLETENESS figure,
 *   never a single total.
 *
 * A total that silently omits the twelve items nobody could price is worse than
 * no total, because it looks finished. `EstimateResult.complete` is false
 * whenever anything is unpriced, and the UI is expected to refuse to present
 * `total` as final in that state.
 */

import type { QuantityLine } from '../takeoff/takeoff.js';
import { findMaterial, type TradeCode } from '../catalogue/materials.js';
import type { Currency, PriceConfidence, PriceLookup } from '../pricing/price.js';
import { findProductivity, type LabourRateLookup } from './labour.js';
import type { MaterialId, ProductId } from '../model/ids.js';

/** Which quality/price band a scenario represents. Requirement 36. */
export type BudgetScenario = 'ECONOMY' | 'STANDARD' | 'PREMIUM' | 'LUXURY' | 'CUSTOM';

export interface EstimateSettings {
  readonly currency: Currency;
  /** 0.10 = 10%. Applied to the sum of material, labour, transport and equipment. */
  readonly contingency: number;
  /** Transport as a fraction of material cost where no explicit freight is known. */
  readonly transportFraction: number;
  /** Equipment and scaffolding as a fraction of labour cost. */
  readonly equipmentFraction: number;
  /** Per-material wastage overrides, keyed by material id. */
  readonly wastageOverrides?: Readonly<Record<string, number>>;
  /** Which productivity key applies to a given material. */
  readonly productivityMapping?: Readonly<Record<string, string>>;
  readonly scenario: BudgetScenario;
}

export const DEFAULT_SETTINGS: EstimateSettings = {
  currency: 'PKR',
  contingency: 0.1,
  transportFraction: 0.03,
  equipmentFraction: 0.05,
  scenario: 'STANDARD',
};

/**
 * Which productivity coefficient applies to which material.
 *
 * Explicit rather than inferred from category, because "flooring" covers both
 * carpet tile (fast, one trade) and marble (slow, two trades) and averaging them
 * would misstate both.
 */
export const DEFAULT_PRODUCTIVITY_MAPPING: Readonly<Record<string, string>> = {
  mat_tile_ceramic: 'tiling_floor',
  mat_tile_porcelain: 'tiling_floor',
  mat_marble: 'marble_floor',
  mat_granite: 'marble_floor',
  mat_plaster: 'plaster',
  mat_paint_emulsion: 'paint',
  mat_gypsum_ceiling: 'gypsum_ceiling',
  mat_grid_ceiling: 'gypsum_ceiling',
  mat_door_flush: 'door_install',
  mat_glass_glazing: 'glazing_install',
  mat_acp_panel: 'facade_panel',
  mat_stone_cladding: 'facade_panel',
  mat_electrical_point: 'electrical_point',
  mat_light_fitting: 'light_fitting',
};

export interface EstimateLine {
  readonly key: string;
  readonly description: string;
  readonly unit: string;
  /** Net quantity from the takeoff. */
  readonly netQuantity: number;
  readonly wastageFraction: number;
  /** What must actually be bought: net x (1 + wastage). Requirement 41. */
  readonly procurementQuantity: number;

  readonly materialRate?: number;
  readonly materialCost?: number;
  readonly materialConfidence?: PriceConfidence;
  readonly materialSourceName?: string;
  readonly materialSourceUrl?: string;
  readonly materialPriceDate?: string;

  readonly labourCost?: number;
  readonly labourBreakdown: readonly LabourComponent[];

  readonly transport?: number;
  readonly subtotal?: number;

  /** Set when the line could not be costed. The line still appears in the BOQ. */
  readonly unpriced?: UnpricedDetail;
  readonly derivation: string;
}

export interface LabourComponent {
  readonly trade: TradeCode;
  readonly workerDays: number;
  readonly rate?: number;
  readonly cost?: number;
  readonly unpricedReason?: string;
}

export interface UnpricedDetail {
  readonly what: 'material' | 'labour' | 'both';
  readonly reason: string;
  readonly remedy: string;
}

export interface EstimateResult {
  readonly lines: readonly EstimateLine[];
  readonly currency: Currency;
  readonly scenario: BudgetScenario;

  readonly materialCost: number;
  readonly labourCost: number;
  readonly transportCost: number;
  readonly equipmentCost: number;
  readonly subtotal: number;
  readonly contingencyAmount: number;
  readonly total: number;

  /** False when any line is unpriced. The UI must not present `total` as final. */
  readonly complete: boolean;
  readonly pricedLineCount: number;
  readonly unpricedLineCount: number;
  /** Priced lines as a fraction of all lines, by count. */
  readonly completeness: number;
  readonly unpricedLines: readonly EstimateLine[];
  readonly workerDaysByTrade: ReadonlyMap<TradeCode, number>;
  readonly assumptions: readonly string[];
  readonly lowestConfidence: PriceConfidence | 'NONE';
}

/** Resolves a material to a product and then to a price. Supplied by the host. */
export type PriceResolver = (materialId: MaterialId, scenario: BudgetScenario) => PriceLookup;
export type LabourResolver = (trade: TradeCode) => LabourRateLookup;

const CONFIDENCE_ORDER: Record<PriceConfidence, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export function estimate(
  quantities: readonly QuantityLine[],
  resolvePrice: PriceResolver,
  resolveLabour: LabourResolver,
  settings: EstimateSettings = DEFAULT_SETTINGS,
): EstimateResult {
  const lines: EstimateLine[] = [];
  const workerDaysByTrade = new Map<TradeCode, number>();
  const assumptions = new Set<string>();
  const mapping = { ...DEFAULT_PRODUCTIVITY_MAPPING, ...(settings.productivityMapping ?? {}) };

  let materialTotal = 0;
  let labourTotal = 0;
  let transportTotal = 0;
  let lowestConfidence: PriceConfidence | 'NONE' = 'NONE';

  for (const q of quantities) {
    // Lines that need engineering input are carried through as unpriced gaps
    // rather than dropped, so they stay visible in the BOQ.
    if (q.basis === 'requires_engineering') {
      lines.push({
        key: q.key,
        description: q.description,
        unit: q.unit,
        netQuantity: 0,
        wastageFraction: 0,
        procurementQuantity: 0,
        labourBreakdown: [],
        unpriced: {
          what: 'both',
          reason: q.gap ?? 'Quantity requires engineering input.',
          remedy: 'Enter the quantity from the structural or services drawings.',
        },
        derivation: q.derivation,
      });
      continue;
    }

    const material = q.materialId ? findMaterial(q.materialId) : undefined;
    const wastage =
      settings.wastageOverrides?.[q.materialId ?? ''] ?? material?.defaultWastage ?? 0;
    const procurementQuantity = q.quantity * (1 + wastage);

    // ---- Material ---------------------------------------------------------
    let materialRate: number | undefined;
    let materialCost: number | undefined;
    let materialConfidence: PriceConfidence | undefined;
    let materialSourceName: string | undefined;
    let materialSourceUrl: string | undefined;
    let materialPriceDate: string | undefined;
    let unpricedMaterial: string | undefined;
    let materialRemedy: string | undefined;

    if (!q.materialId) {
      // A quantity with no material chosen — bare masonry volume, or a floor
      // area with no finish selected yet — cannot be priced. Treating it as a
      // priced zero would inflate the completeness figure and make an estimate
      // with nothing in it look 76% done.
      unpricedMaterial = 'no_material_selected';
      materialRemedy =
        'No material is assigned to this quantity. Choose a material in the design layer, then price it.';
    } else {
      const lookup = resolvePrice(q.materialId, settings.scenario);
      if (lookup.available) {
        materialRate = lookup.record.amount;
        materialCost = materialRate * procurementQuantity;
        materialConfidence = lookup.confidence;
        materialSourceName = lookup.record.sourceId;
        materialSourceUrl = lookup.record.sourceUrl;
        materialPriceDate = lookup.record.verifiedAt ?? lookup.record.retrievedAt;
        materialTotal += materialCost;
        if (
          lowestConfidence === 'NONE' ||
          CONFIDENCE_ORDER[lookup.confidence] > CONFIDENCE_ORDER[lowestConfidence]
        ) {
          lowestConfidence = lookup.confidence;
        }
      } else {
        unpricedMaterial = lookup.reason;
        materialRemedy = lookup.remedy;
      }
    }

    // ---- Labour -----------------------------------------------------------
    const labourBreakdown: LabourComponent[] = [];
    let lineLabourCost = 0;
    let anyLabourUnpriced = false;

    const productivityKey = q.materialId ? mapping[q.materialId] : undefined;
    const productivity = productivityKey ? findProductivity(productivityKey) : undefined;

    if (productivity) {
      assumptions.add(productivity.assumption);
      for (const member of productivity.crew) {
        // Labour follows the net quantity installed, not the procurement
        // quantity: nobody is paid to lay the offcuts.
        const workerDays = q.quantity * member.daysPerUnit;
        workerDaysByTrade.set(member.trade, (workerDaysByTrade.get(member.trade) ?? 0) + workerDays);

        const rateLookup = resolveLabour(member.trade);
        if (rateLookup.available && rateLookup.rate.unit === 'day') {
          const cost = workerDays * rateLookup.rate.amount;
          lineLabourCost += cost;
          labourBreakdown.push({ trade: member.trade, workerDays, rate: rateLookup.rate.amount, cost });
          if (
            lowestConfidence === 'NONE' ||
            CONFIDENCE_ORDER[rateLookup.confidence] > CONFIDENCE_ORDER[lowestConfidence]
          ) {
            lowestConfidence = rateLookup.confidence;
          }
        } else {
          anyLabourUnpriced = true;
          labourBreakdown.push({
            trade: member.trade,
            workerDays,
            unpricedReason: rateLookup.available
              ? `Rate on file is per ${rateLookup.rate.unit}, not per day; cannot apply to a worker-day figure.`
              : rateLookup.remedy,
          });
        }
      }
      if (!anyLabourUnpriced) labourTotal += lineLabourCost;
    }

    // ---- Transport --------------------------------------------------------
    const transport = materialCost !== undefined ? materialCost * settings.transportFraction : undefined;
    if (transport !== undefined) transportTotal += transport;

    const unpriced: UnpricedDetail | undefined =
      unpricedMaterial && anyLabourUnpriced
        ? {
            what: 'both',
            reason: `Material: ${unpricedMaterial}. Labour rate also unavailable.`,
            remedy: materialRemedy ?? 'Enter a price and a labour rate.',
          }
        : unpricedMaterial
          ? { what: 'material', reason: unpricedMaterial, remedy: materialRemedy ?? '' }
          : anyLabourUnpriced
            ? {
                what: 'labour',
                reason: 'One or more trade rates unavailable.',
                remedy: 'Record a daily wage rate for the trades listed, with source and date.',
              }
            : undefined;

    const subtotal =
      unpriced === undefined
        ? (materialCost ?? 0) + lineLabourCost + (transport ?? 0)
        : undefined;

    lines.push({
      key: q.key,
      description: q.description,
      unit: q.unit,
      netQuantity: q.quantity,
      wastageFraction: wastage,
      procurementQuantity,
      materialRate,
      materialCost,
      materialConfidence,
      materialSourceName,
      materialSourceUrl,
      materialPriceDate,
      labourCost: anyLabourUnpriced ? undefined : lineLabourCost,
      labourBreakdown,
      transport,
      subtotal,
      unpriced,
      derivation: q.derivation,
    });
  }

  const equipmentCost = labourTotal * settings.equipmentFraction;
  const subtotal = materialTotal + labourTotal + transportTotal + equipmentCost;
  const contingencyAmount = subtotal * settings.contingency;
  const total = subtotal + contingencyAmount;

  const unpricedLines = lines.filter((l) => l.unpriced !== undefined);
  const pricedLineCount = lines.length - unpricedLines.length;

  if (settings.contingency > 0) {
    assumptions.add(
      `Contingency applied at ${(settings.contingency * 100).toFixed(0)}% of the subtotal.`,
    );
  }
  assumptions.add(
    `Transport allowed at ${(settings.transportFraction * 100).toFixed(1)}% of material cost where no explicit freight figure is on file.`,
  );
  assumptions.add(
    `Equipment and scaffolding allowed at ${(settings.equipmentFraction * 100).toFixed(1)}% of labour cost.`,
  );
  if (unpricedLines.length > 0) {
    assumptions.add(
      `${unpricedLines.length} line(s) could not be priced and are EXCLUDED from the total. ` +
        `The figure shown is therefore a floor, not a complete estimate.`,
    );
  }

  return {
    lines,
    currency: settings.currency,
    scenario: settings.scenario,
    materialCost: materialTotal,
    labourCost: labourTotal,
    transportCost: transportTotal,
    equipmentCost,
    subtotal,
    contingencyAmount,
    total,
    complete: unpricedLines.length === 0,
    pricedLineCount,
    unpricedLineCount: unpricedLines.length,
    completeness: lines.length === 0 ? 0 : pricedLineCount / lines.length,
    unpricedLines,
    workerDaysByTrade,
    assumptions: [...assumptions],
    lowestConfidence,
  };
}

/**
 * A short statement of what the total does and does not mean, for display
 * directly beside the figure. Requirement 43: never present uncertain pricing
 * as exact.
 */
export function totalCaveat(result: EstimateResult): string {
  if (result.lines.length === 0) return 'No quantities to price.';
  if (!result.complete) {
    return (
      `Incomplete: ${result.unpricedLineCount} of ${result.lines.length} lines are unpriced and ` +
      `excluded. The true cost is higher than the figure shown.`
    );
  }
  switch (result.lowestConfidence) {
    case 'HIGH':
      return 'All lines priced from verified recent sources.';
    case 'MEDIUM':
      return 'Priced, but some lines rest on market benchmarks rather than supplier quotations.';
    case 'LOW':
      return 'Priced, but some lines rest on stale or user-estimated figures. Treat as indicative only.';
    default:
      return 'No priced lines.';
  }
}

/** Product resolution per budget scenario, used by the scenario comparison view. */
export interface ScenarioProductChoice {
  readonly materialId: MaterialId;
  readonly productByScenario: Readonly<Record<BudgetScenario, ProductId | undefined>>;
}
