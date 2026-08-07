/**
 * VALUE ENGINEERING.
 *
 * "Keep this design but reduce the cost by 20%."
 *
 * The rule that shapes the whole module: a substitution is only proposed when
 * both the current material and the alternative are actually priced. A saving
 * computed against an unpriced alternative is a fabricated price wearing a
 * different hat, and it would arrive attached to a confident recommendation.
 *
 * The second rule: geometry is never touched. Reducing cost by shrinking rooms
 * is not value engineering, and the integrity guard would reject it anyway.
 */

import {
  BASE_MATERIALS,
  findMaterial,
  type Material,
  type MaterialCategory,
} from '../catalogue/materials.js';
import type { MaterialId } from '../model/ids.js';
import type { Currency, PriceLookup } from '../pricing/price.js';
import type { EstimateLine, EstimateResult, PriceResolver, BudgetScenario } from './estimate.js';

export type Recommendation = 'recommended' | 'acceptable' | 'last_resort';

export interface Substitution {
  readonly lineKey: string;
  readonly lineDescription: string;
  readonly currentMaterialId: MaterialId;
  readonly currentMaterialName: string;
  readonly currentRate: number;
  readonly currentCost: number;
  readonly alternativeMaterialId: MaterialId;
  readonly alternativeMaterialName: string;
  readonly alternativeRate: number;
  readonly alternativeCost: number;
  /** Positive means money saved. Computed from two real prices, never estimated. */
  readonly saving: number;
  readonly savingFraction: number;
  readonly currency: Currency;
  readonly qualityImpact: string;
  readonly visualImpact: string;
  readonly recommendation: Recommendation;
}

export interface ValueEngineeringResult {
  readonly substitutions: readonly Substitution[];
  readonly totalSaving: number;
  readonly currency: Currency;
  /** Substitutions that would meet the target, largest saving first. */
  readonly toReachTarget: readonly Substitution[];
  readonly targetReached: boolean;
  readonly statement: string;
  /** Materials that could not be considered because they are unpriced. */
  readonly skipped: readonly string[];
}

/**
 * Which materials can stand in for which, with the honest consequence.
 *
 * Curated rather than derived from category alone: "flooring" contains carpet
 * tile and marble, and proposing carpet in a marble reception because they
 * share a category would be a substitution nobody asked for. Each entry states
 * what is actually lost.
 */
interface SubstitutionRule {
  readonly from: string;
  readonly to: string;
  readonly qualityImpact: string;
  readonly visualImpact: string;
  readonly recommendation: Recommendation;
}

const RULES: readonly SubstitutionRule[] = [
  {
    from: 'mat_marble',
    to: 'mat_tile_porcelain',
    qualityImpact:
      'Large-format porcelain is harder-wearing than marble and needs no sealing or periodic polishing.',
    visualImpact:
      'Loses the depth and veining variation of natural stone. Reads as a good floor rather than an expensive one.',
    recommendation: 'recommended',
  },
  {
    from: 'mat_marble',
    to: 'mat_granite',
    qualityImpact: 'Granite is denser and more stain-resistant than marble.',
    visualImpact: 'Darker and more uniform. Suits a technical identity better than a luxury one.',
    recommendation: 'acceptable',
  },
  {
    from: 'mat_granite',
    to: 'mat_tile_porcelain',
    qualityImpact: 'Comparable durability in commercial traffic; lighter, so cheaper to install.',
    visualImpact: 'Loses the natural stone reading at close range.',
    recommendation: 'recommended',
  },
  {
    from: 'mat_tile_porcelain',
    to: 'mat_tile_ceramic',
    qualityImpact:
      'Ceramic is softer and more prone to chipping. Acceptable in low-traffic rooms, a false economy in circulation.',
    visualImpact: 'Little difference at normal viewing distance.',
    recommendation: 'acceptable',
  },
  {
    from: 'mat_tile_porcelain',
    to: 'mat_carpet_tile',
    qualityImpact:
      'Better acoustically and warmer underfoot; shorter life and needs replacing in traffic lanes.',
    visualImpact: 'Substantially different character. Not a like-for-like swap.',
    recommendation: 'last_resort',
  },
  {
    from: 'mat_stone_cladding',
    to: 'mat_acp_panel',
    qualityImpact:
      'Aluminium composite is far lighter, so the subframe is cheaper. Shorter design life than stone and more vulnerable to impact at ground level.',
    visualImpact: 'Flat and manufactured against the depth and shadow of stone.',
    recommendation: 'acceptable',
  },
  {
    from: 'mat_acp_panel',
    to: 'mat_plaster',
    qualityImpact: 'Plaster and paint needs recoating every few years where a panel system does not.',
    visualImpact: 'Removes the modern panelised reading entirely. A different building.',
    recommendation: 'last_resort',
  },
  {
    from: 'mat_gypsum_ceiling',
    to: 'mat_grid_ceiling',
    qualityImpact:
      'A grid ceiling gives full service access, which gypsum does not. Genuinely better in an office.',
    visualImpact: 'Visible grid. Fine in offices, wrong in a reception or a boardroom.',
    recommendation: 'recommended',
  },
];

const RULE_INDEX = new Map<string, SubstitutionRule[]>();
for (const rule of RULES) {
  const existing = RULE_INDEX.get(rule.from) ?? [];
  existing.push(rule);
  RULE_INDEX.set(rule.from, existing);
}

/** Rooms where a downgrade is most visible, used to soften the recommendation. */
const CLIENT_FACING = /reception|lobby|conference|executive|board/i;

function adjustForRoom(rule: SubstitutionRule, description: string): Recommendation {
  if (!CLIENT_FACING.test(description)) return rule.recommendation;
  // The same swap that is sensible in a store room is a visible loss in a
  // reception. Demote rather than hide it.
  if (rule.recommendation === 'recommended') return 'acceptable';
  if (rule.recommendation === 'acceptable') return 'last_resort';
  return 'last_resort';
}

export function findSubstitutions(
  result: EstimateResult,
  lineMaterials: ReadonlyMap<string, MaterialId>,
  resolvePrice: PriceResolver,
  scenario: BudgetScenario,
  targetSaving = 0,
): ValueEngineeringResult {
  const substitutions: Substitution[] = [];
  const skipped: string[] = [];

  for (const line of result.lines) {
    if (line.materialCost === undefined || line.materialRate === undefined) continue;
    const materialId = lineMaterials.get(line.key);
    if (!materialId) continue;

    const current = findMaterial(materialId);
    if (!current) continue;

    for (const rule of RULE_INDEX.get(materialId) ?? []) {
      const alternativeId = rule.to as MaterialId;
      const alternative = findMaterial(alternativeId);
      if (!alternative) continue;

      const lookup: PriceLookup = resolvePrice(alternativeId, scenario);
      if (!lookup.available) {
        skipped.push(
          `${alternative.name} (no price on file — cannot compute a saving against it)`,
        );
        continue;
      }

      // Wastage differs between materials, so the comparison must be made on
      // procurement quantity, not on the rate alone. Marble at 15% waste versus
      // porcelain at 10% is a real part of the difference.
      const netQuantity = line.netQuantity;
      const alternativeQuantity = netQuantity * (1 + alternative.defaultWastage);
      const alternativeCost = lookup.record.amount * alternativeQuantity;
      const saving = line.materialCost - alternativeCost;

      if (saving <= 0) continue;

      substitutions.push({
        lineKey: line.key,
        lineDescription: line.description,
        currentMaterialId: materialId,
        currentMaterialName: current.name,
        currentRate: line.materialRate,
        currentCost: line.materialCost,
        alternativeMaterialId: alternativeId,
        alternativeMaterialName: alternative.name,
        alternativeRate: lookup.record.amount,
        alternativeCost,
        saving,
        savingFraction: saving / line.materialCost,
        currency: result.currency,
        qualityImpact: rule.qualityImpact,
        visualImpact: rule.visualImpact,
        recommendation: adjustForRoom(rule, line.description),
      });
    }
  }

  substitutions.sort((a, b) => b.saving - a.saving);

  // Reaching a target: take the best substitution per line, preferring the
  // recommended ones, until the target is met.
  const usedLines = new Set<string>();
  const ordered = [...substitutions].sort((a, b) => {
    const rank: Record<Recommendation, number> = { recommended: 0, acceptable: 1, last_resort: 2 };
    const byRank = rank[a.recommendation] - rank[b.recommendation];
    return byRank !== 0 ? byRank : b.saving - a.saving;
  });

  const toReachTarget: Substitution[] = [];
  let accumulated = 0;
  for (const s of ordered) {
    if (targetSaving > 0 && accumulated >= targetSaving) break;
    if (usedLines.has(s.lineKey)) continue;
    usedLines.add(s.lineKey);
    toReachTarget.push(s);
    accumulated += s.saving;
  }

  const totalSaving = substitutions.reduce((sum, s) => {
    return usedLines.has(s.lineKey) && toReachTarget.includes(s) ? sum + s.saving : sum;
  }, 0);

  const targetReached = targetSaving === 0 || accumulated >= targetSaving;

  let statement: string;
  if (substitutions.length === 0) {
    statement =
      skipped.length > 0
        ? `No substitution could be costed. ${skipped.length} candidate(s) have no price on file.`
        : 'No cheaper alternative was found among the priced materials in this design.';
  } else if (targetSaving > 0 && !targetReached) {
    statement =
      `Specification changes alone reach ${accumulated.toFixed(0)} ${result.currency} of the ` +
      `${targetSaving.toFixed(0)} target — a shortfall of ${(targetSaving - accumulated).toFixed(0)}. ` +
      `Closing the rest means changing scope, not specification. The architecture is not adjustable here.`;
  } else if (targetSaving > 0) {
    statement =
      `${toReachTarget.length} substitution(s) reach ${accumulated.toFixed(0)} ${result.currency}, ` +
      `meeting the ${targetSaving.toFixed(0)} target.`;
  } else {
    statement = `${substitutions.length} substitution(s) found, worth up to ${accumulated.toFixed(0)} ${result.currency}.`;
  }

  return {
    substitutions,
    totalSaving,
    currency: result.currency,
    toReachTarget,
    targetReached,
    statement,
    skipped: [...new Set(skipped)],
  };
}

/** Alternatives within a category, for the "find me three options" query. */
export function alternativesFor(materialId: MaterialId): readonly Material[] {
  const material = findMaterial(materialId);
  if (!material) return [];
  return BASE_MATERIALS.filter(
    (m) => m.id !== materialId && m.category === material.category && m.basis === material.basis,
  );
}

export function materialsInCategory(category: MaterialCategory): readonly Material[] {
  return BASE_MATERIALS.filter((m) => m.category === category);
}
