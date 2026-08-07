/**
 * Design option comparison.
 *
 * Requirement 37: generate several designs, then compare what each one costs.
 *
 * The comparison is meaningful only because every option shares one
 * architecture. Same building, same rooms, same quantities of floor and wall
 * area — so a cost difference between Option A and Option B is entirely the
 * effect of specification, with nothing else moving. That is exactly the
 * question a client is asking when they ask which one is cheaper.
 *
 * Costs are `null` where an option could not be fully priced. They are never
 * approximated to make the table look complete, and a comparison containing a
 * null says so rather than ranking on partial data.
 */

import type { Design } from '../model/design.js';
import type { Floor } from '../model/architecture.js';
import type { Currency } from '../pricing/price.js';
import { computeTakeoff } from '../takeoff/takeoff.js';
import {
  estimate,
  type EstimateResult,
  type EstimateSettings,
  type LabourResolver,
  type PriceResolver,
} from '../estimate/estimate.js';
import { findMaterial, type MaterialCategory } from '../catalogue/materials.js';

export interface OptionCost {
  readonly designId: Design['id'];
  readonly name: string;
  readonly label?: string;
  readonly currency: Currency;
  /** Null when the option has unpriced lines — never an approximation. */
  readonly total: number | null;
  readonly materialCost: number;
  readonly labourCost: number;
  readonly transportCost: number;
  readonly contingency: number;
  /** Material cost split by trade group, for the comparison table. */
  readonly byCategory: ReadonlyMap<MaterialCategory, number>;
  readonly complete: boolean;
  readonly unpricedLineCount: number;
  readonly completeness: number;
  readonly result: EstimateResult;
}

export interface ComparisonResult {
  readonly options: readonly OptionCost[];
  /** Cheapest fully priced option, if any option is fully priced. */
  readonly cheapest: OptionCost | null;
  readonly mostExpensive: OptionCost | null;
  /** Spread between cheapest and dearest, when both are known. */
  readonly spread: number | null;
  readonly statement: string;
}

const CATEGORY_OF_INTEREST: readonly MaterialCategory[] = [
  'flooring',
  'wall_finish',
  'ceiling',
  'facade',
  'lighting',
  'glazing',
  'joinery',
  'furniture',
];

export function costOption(
  design: Design,
  floors: readonly Floor[],
  resolvePrice: PriceResolver,
  resolveLabour: LabourResolver,
  settings: EstimateSettings,
): OptionCost {
  const takeoff = computeTakeoff(floors, design);
  const result = estimate([...takeoff.lines, ...takeoff.gaps], resolvePrice, resolveLabour, settings);

  const byCategory = new Map<MaterialCategory, number>();
  for (const line of result.lines) {
    if (line.materialCost === undefined) continue;
    const key = takeoff.lines.find((l) => l.key === line.key)?.materialId;
    const material = key ? findMaterial(key) : undefined;
    if (!material) continue;
    if (!CATEGORY_OF_INTEREST.includes(material.category)) continue;
    byCategory.set(material.category, (byCategory.get(material.category) ?? 0) + line.materialCost);
  }

  return {
    designId: design.id,
    name: design.name,
    label: design.label,
    currency: result.currency,
    total: result.complete ? result.total : null,
    materialCost: result.materialCost,
    labourCost: result.labourCost,
    transportCost: result.transportCost,
    contingency: result.contingencyAmount,
    byCategory,
    complete: result.complete,
    unpricedLineCount: result.unpricedLineCount,
    completeness: result.completeness,
    result,
  };
}

export function compareDesigns(
  designs: readonly Design[],
  floors: readonly Floor[],
  resolvePrice: PriceResolver,
  resolveLabour: LabourResolver,
  settings: EstimateSettings,
): ComparisonResult {
  const options = designs.map((d) => costOption(d, floors, resolvePrice, resolveLabour, settings));
  const priced = options.filter((o): o is OptionCost & { total: number } => o.total !== null);

  if (priced.length === 0) {
    return {
      options,
      cheapest: null,
      mostExpensive: null,
      spread: null,
      statement:
        options.length === 0
          ? 'No design options to compare.'
          : 'No option is fully priced, so none can be ranked. Record the missing prices first.',
    };
  }

  const sorted = [...priced].sort((a, b) => a.total - b.total);
  const cheapest = sorted[0]!;
  const dearest = sorted[sorted.length - 1]!;
  const spread = dearest.total - cheapest.total;

  const partial = options.length - priced.length;
  const caveat =
    partial > 0
      ? ` ${partial} of ${options.length} option(s) could not be fully priced and are excluded from the ranking.`
      : '';

  const statement =
    priced.length === 1
      ? `Only "${cheapest.name}" is fully priced, at ${cheapest.total.toFixed(0)} ${cheapest.currency}.${caveat}`
      : `"${cheapest.name}" is cheapest at ${cheapest.total.toFixed(0)} ${cheapest.currency}; ` +
        `"${dearest.name}" is dearest at ${dearest.total.toFixed(0)}. ` +
        `The spread is ${spread.toFixed(0)} ${cheapest.currency} ` +
        `(${((spread / dearest.total) * 100).toFixed(1)}%).${caveat}`;

  return { options, cheapest, mostExpensive: dearest, spread, statement };
}

/**
 * Line-level difference between two options.
 *
 * Answers "why is Option C more expensive than Option A" with the specific
 * lines responsible, largest first — which is the question that actually gets
 * asked once a spread is on screen.
 */
export interface LineDelta {
  readonly key: string;
  readonly description: string;
  readonly aCost: number | null;
  readonly bCost: number | null;
  readonly delta: number | null;
}

export function diffOptions(a: OptionCost, b: OptionCost): LineDelta[] {
  const aLines = new Map(a.result.lines.map((l) => [l.key, l]));
  const bLines = new Map(b.result.lines.map((l) => [l.key, l]));
  const keys = new Set([...aLines.keys(), ...bLines.keys()]);

  const deltas: LineDelta[] = [];
  for (const key of keys) {
    const la = aLines.get(key);
    const lb = bLines.get(key);
    const aCost = la?.subtotal ?? null;
    const bCost = lb?.subtotal ?? null;
    const delta = aCost !== null && bCost !== null ? bCost - aCost : null;
    if (delta !== null && Math.abs(delta) < 1) continue;
    deltas.push({
      key,
      description: lb?.description ?? la?.description ?? key,
      aCost,
      bCost,
      delta,
    });
  }

  return deltas.sort((x, y) => Math.abs(y.delta ?? 0) - Math.abs(x.delta ?? 0));
}
