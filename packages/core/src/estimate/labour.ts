/**
 * LABOUR MODEL.
 *
 * Requirement 40: "Do not combine labour invisibly into material rates."
 *
 * Two distinct things live here, and the distinction matters:
 *
 *   PRODUCTIVITY COEFFICIENTS — how many worker-days a trade needs per unit of
 *   work. These are physical/organisational facts that vary by site and crew but
 *   not by market date. They are shipped as documented, editable assumptions
 *   because an estimate with no labour line is more wrong than one with a stated
 *   assumption.
 *
 *   WAGE RATES — what a mason costs per day in Rawalpindi this month. These are
 *   prices. They are NOT shipped. They come from the price repository like every
 *   other price, with a source, a date and a confidence, or the labour line is
 *   reported as unpriced.
 *
 * Conflating the two is how estimating tools end up quietly asserting a wage.
 */

import type { LabourRateId, SourceId } from '../model/ids.js';
import type { Currency, PriceConfidence, PriceUnit } from '../pricing/price.js';
import type { SourceTier } from '../pricing/source.js';
import type { TradeCode } from '../catalogue/materials.js';

/**
 * Worker-days required per unit of finished work, by trade.
 *
 * Sources for the shape of these figures are conventional analysis-of-rates
 * practice (CPWD/Pakistan PWD style composite rates). They are starting points
 * shown to the user as assumptions, and every estimate that uses them says so
 * on its assumptions page.
 */
export interface ProductivityCoefficient {
  readonly key: string;
  readonly description: string;
  readonly unit: PriceUnit;
  /** Worker-days per unit, per trade. */
  readonly crew: ReadonlyArray<{ readonly trade: TradeCode; readonly daysPerUnit: number }>;
  readonly assumption: string;
}

export const PRODUCTIVITY: readonly ProductivityCoefficient[] = [
  {
    key: 'tiling_floor',
    description: 'Floor tiling, laid on cement mortar bed',
    unit: 'sqft',
    crew: [
      { trade: 'tile_worker', daysPerUnit: 1 / 120 },
      { trade: 'helper', daysPerUnit: 1 / 120 },
    ],
    assumption: 'One tile worker with one helper lays about 120 sq ft of standard-format tile per day.',
  },
  {
    key: 'marble_floor',
    description: 'Marble or granite slab flooring',
    unit: 'sqft',
    crew: [
      { trade: 'marble_worker', daysPerUnit: 1 / 80 },
      { trade: 'helper', daysPerUnit: 1 / 80 },
    ],
    assumption:
      'Slab stone is slower than modular tile: about 80 sq ft per worker-day including cutting and matching.',
  },
  {
    key: 'plaster',
    description: 'Cement plaster to walls',
    unit: 'sqft',
    crew: [
      { trade: 'mason', daysPerUnit: 1 / 150 },
      { trade: 'helper', daysPerUnit: 1 / 100 },
    ],
    assumption: 'One mason plasters about 150 sq ft per day; helpers mix and supply at a higher ratio.',
  },
  {
    key: 'paint',
    description: 'Emulsion paint, primer plus two coats',
    unit: 'sqft',
    crew: [{ trade: 'painter', daysPerUnit: 1 / 250 }],
    assumption: 'About 250 sq ft per painter-day across primer and two finish coats.',
  },
  {
    key: 'gypsum_ceiling',
    description: 'Gypsum board false ceiling on GI framing',
    unit: 'sqft',
    crew: [
      { trade: 'gypsum_worker', daysPerUnit: 1 / 90 },
      { trade: 'helper', daysPerUnit: 1 / 90 },
    ],
    assumption: 'About 90 sq ft per worker-day including framing, boarding and jointing.',
  },
  {
    key: 'masonry',
    description: 'Brick or block masonry',
    unit: 'cft',
    crew: [
      { trade: 'mason', daysPerUnit: 1 / 100 },
      { trade: 'helper', daysPerUnit: 1 / 60 },
    ],
    assumption: 'About 100 cft of masonry per mason-day, with helper support at a higher ratio.',
  },
  {
    key: 'door_install',
    description: 'Door and frame installation',
    unit: 'each',
    crew: [{ trade: 'carpenter', daysPerUnit: 0.5 }],
    assumption: 'About two doors hung, with ironmongery, per carpenter-day.',
  },
  {
    key: 'glazing_install',
    description: 'Aluminium and glass installation',
    unit: 'sqft',
    crew: [
      { trade: 'aluminium_glass_installer', daysPerUnit: 1 / 60 },
      { trade: 'helper', daysPerUnit: 1 / 60 },
    ],
    assumption: 'About 60 sq ft of glazed area per worker-day.',
  },
  {
    key: 'facade_panel',
    description: 'Façade panel installation on subframe',
    unit: 'sqft',
    crew: [
      { trade: 'facade_installer', daysPerUnit: 1 / 45 },
      { trade: 'helper', daysPerUnit: 1 / 45 },
    ],
    assumption: 'About 45 sq ft per worker-day at height, including subframe.',
  },
  {
    key: 'electrical_point',
    description: 'Electrical point: conduit, wiring, accessory',
    unit: 'each',
    crew: [
      { trade: 'electrician', daysPerUnit: 0.25 },
      { trade: 'helper', daysPerUnit: 0.25 },
    ],
    assumption: 'About four points per electrician-day in first and second fix combined.',
  },
  {
    key: 'light_fitting',
    description: 'Light fitting installation',
    unit: 'each',
    crew: [{ trade: 'electrician', daysPerUnit: 0.1 }],
    assumption: 'About ten fittings per electrician-day for standard recessed or surface fittings.',
  },
];

const PRODUCTIVITY_INDEX = new Map(PRODUCTIVITY.map((p) => [p.key, p]));

export function findProductivity(key: string): ProductivityCoefficient | undefined {
  return PRODUCTIVITY_INDEX.get(key);
}

/**
 * A wage rate. Structurally identical to a `PriceRecord` in its provenance
 * requirements, because it is a price.
 */
export interface LabourRate {
  readonly id: LabourRateId;
  readonly trade: TradeCode;
  readonly amount: number;
  readonly currency: Currency;
  /** 'day' for daily wage, or an output unit for piece-rate trades. */
  readonly unit: Extract<PriceUnit, 'day' | 'hour' | 'sqft' | 'sqm' | 'each' | 'rft' | 'cft'>;
  readonly location: string;
  readonly sourceId: SourceId;
  readonly sourceTier: SourceTier;
  readonly sourceUrl: string;
  readonly retrievedAt: string;
  readonly verifiedAt?: string;
  readonly note?: string;
}

export type LabourRateLookup =
  | { readonly available: true; readonly rate: LabourRate; readonly confidence: PriceConfidence }
  | { readonly available: false; readonly trade: TradeCode; readonly remedy: string };

/**
 * Crew plan for a work package — the "5 masons, 8 helpers, N days" view.
 *
 * Duration is worker-days divided by crew size, floored at one day. It is a
 * resourcing estimate, not a programme: it assumes the work is divisible and
 * the crew is continuously available, and says so.
 */
export interface CrewPlanEntry {
  readonly trade: TradeCode;
  readonly workerDays: number;
  readonly suggestedCrewSize: number;
  readonly estimatedDays: number;
}

export function planCrew(
  workerDaysByTrade: ReadonlyMap<TradeCode, number>,
  targetDurationDays?: number,
): CrewPlanEntry[] {
  const entries: CrewPlanEntry[] = [];
  for (const [trade, workerDays] of workerDaysByTrade) {
    if (workerDays <= 0) continue;
    const crewSize = targetDurationDays
      ? Math.max(1, Math.ceil(workerDays / targetDurationDays))
      : Math.max(1, Math.ceil(workerDays / 20)); // default: aim for a ~20-working-day package
    entries.push({
      trade,
      workerDays,
      suggestedCrewSize: crewSize,
      estimatedDays: Math.max(1, Math.ceil(workerDays / crewSize)),
    });
  }
  return entries.sort((a, b) => b.workerDays - a.workerDays);
}
