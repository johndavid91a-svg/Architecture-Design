import { describe, expect, it } from 'vitest';
import type { MaterialId, PriceId, ProductId, SourceId } from '../model/ids.js';
import type { PriceLookup, PriceRecord } from '../pricing/price.js';
import { unavailable } from '../pricing/price.js';
import type { QuantityLine } from '../takeoff/takeoff.js';
import type { LabourRateLookup } from './labour.js';
import { DEFAULT_SETTINGS, estimate, totalCaveat } from './estimate.js';

const TILE = 'mat_tile_ceramic' as MaterialId;
const MARBLE = 'mat_marble' as MaterialId;

function priced(amount: number): PriceLookup {
  const record: PriceRecord = {
    id: 'prc' as PriceId,
    productId: 'prd' as ProductId,
    amount,
    currency: 'PKR',
    unit: 'sqft',
    sourceId: 'src_supplier_quotation' as SourceId,
    sourceTier: 'LEVEL_3_SUPPLIER_QUOTE',
    sourceUrl: 'https://example.invalid/quote',
    retrievedAt: new Date().toISOString(),
    verifiedAt: new Date().toISOString(),
    location: 'Islamabad',
  };
  return { available: true, record, confidence: 'HIGH', ageDays: 0, alternatives: [] };
}

const labourAt = (rate: number | null) =>
  (trade: Parameters<LabourResolverType>[0]): LabourRateLookup =>
    rate === null
      ? { available: false, trade, remedy: 'Record a daily wage rate.' }
      : {
          available: true,
          confidence: 'MEDIUM',
          rate: {
            id: 'lab' as never,
            trade,
            amount: rate,
            currency: 'PKR',
            unit: 'day',
            location: 'Islamabad',
            sourceId: 'src_manual_entry' as SourceId,
            sourceTier: 'LEVEL_2_MARKET',
            sourceUrl: '',
            retrievedAt: new Date().toISOString(),
          },
        };
type LabourResolverType = (trade: never) => LabourRateLookup;

const tileLine: QuantityLine = {
  key: 'floor_finish:room1',
  description: 'Reception — ceramic floor tile',
  materialId: TILE,
  unit: 'sqft',
  quantity: 300,
  basis: 'measured_from_model',
  derivation: 'polygon area of room boundary = 300.00 sq ft',
};

const marbleLine: QuantityLine = {
  key: 'floor_finish:room2',
  description: 'Lobby — marble flooring',
  materialId: MARBLE,
  unit: 'sqft',
  quantity: 200,
  basis: 'measured_from_model',
  derivation: 'polygon area of room boundary = 200.00 sq ft',
};

describe('estimation engine', () => {
  it('applies wastage to procurement quantity but not to labour', () => {
    const result = estimate([tileLine], () => priced(100), labourAt(2000) as never, DEFAULT_SETTINGS);
    const line = result.lines[0]!;

    // Ceramic tile default wastage is 10%.
    expect(line.wastageFraction).toBeCloseTo(0.1, 6);
    expect(line.procurementQuantity).toBeCloseTo(330, 6);
    expect(line.materialCost).toBeCloseTo(33_000, 6);

    // Labour follows what is installed (300 sq ft), not what is bought (330).
    const tileWorker = line.labourBreakdown.find((c) => c.trade === 'tile_worker')!;
    expect(tileWorker.workerDays).toBeCloseTo(300 / 120, 6);
  });

  it('keeps material and labour separate in the totals', () => {
    const result = estimate([tileLine], () => priced(100), labourAt(2000) as never, DEFAULT_SETTINGS);
    expect(result.materialCost).toBeGreaterThan(0);
    expect(result.labourCost).toBeGreaterThan(0);
    expect(result.materialCost).not.toBe(result.labourCost);
    // Subtotal is the sum of the named components, with nothing folded in.
    expect(result.subtotal).toBeCloseTo(
      result.materialCost + result.labourCost + result.transportCost + result.equipmentCost,
      6,
    );
  });

  it('excludes an unpriced line from the total and reports the estimate as incomplete', () => {
    const resolve = (materialId: MaterialId): PriceLookup =>
      materialId === TILE ? priced(100) : unavailable('prd' as ProductId, 'no_record');

    const result = estimate([tileLine, marbleLine], resolve, labourAt(2000) as never, DEFAULT_SETTINGS);

    expect(result.complete).toBe(false);
    expect(result.unpricedLineCount).toBe(1);
    expect(result.completeness).toBeCloseTo(0.5, 6);

    // The unpriced line still appears — it is not dropped from the BOQ.
    expect(result.lines).toHaveLength(2);
    const gap = result.unpricedLines[0]!;
    expect(gap.materialCost).toBeUndefined();
    expect(gap.subtotal).toBeUndefined();

    // The material cost reflects only the priced line.
    expect(result.materialCost).toBeCloseTo(33_000, 6);

    // And the caveat says plainly that the true cost is higher.
    expect(totalCaveat(result)).toMatch(/higher than the figure shown/);
  });

  it('does not invent a labour cost when the wage rate is missing', () => {
    const result = estimate([tileLine], () => priced(100), labourAt(null) as never, DEFAULT_SETTINGS);
    const line = result.lines[0]!;
    expect(line.labourCost).toBeUndefined();
    expect(result.labourCost).toBe(0);
    expect(line.unpriced?.what).toBe('labour');
    // Worker-days are still reported: the effort is known even when the rate is not.
    expect(line.labourBreakdown[0]!.workerDays).toBeGreaterThan(0);
  });

  it('carries engineering gaps into the estimate rather than dropping them', () => {
    const gapLine: QuantityLine = {
      key: 'rebar',
      description: 'Steel reinforcement',
      unit: 'kg',
      quantity: 0,
      basis: 'requires_engineering',
      derivation: 'not derivable from a floor plan',
      gap: 'Needs the structural design.',
    };
    const result = estimate([tileLine, gapLine], () => priced(100), labourAt(2000) as never);
    expect(result.lines).toHaveLength(2);
    expect(result.complete).toBe(false);
    expect(result.unpricedLines[0]!.unpriced!.reason).toMatch(/structural design/i);
  });

  it('does not count a quantity with no material assigned as priced', () => {
    // Bare masonry volume, or a floor area before any finish is chosen. Costing
    // it at zero would make an estimate containing nothing look mostly complete.
    const noMaterial: QuantityLine = {
      key: 'masonry:wall1',
      description: 'Wall — masonry',
      unit: 'cft',
      quantity: 420,
      basis: 'measured_from_model',
      derivation: 'length x height less openings x thickness',
    };
    const result = estimate([noMaterial], () => priced(100), labourAt(2000) as never);
    expect(result.complete).toBe(false);
    expect(result.unpricedLineCount).toBe(1);
    expect(result.completeness).toBe(0);
    expect(result.materialCost).toBe(0);
    expect(result.unpricedLines[0]!.unpriced!.reason).toBe('no_material_selected');
  });

  it('states its assumptions', () => {
    const result = estimate([tileLine], () => priced(100), labourAt(2000) as never);
    expect(result.assumptions.some((a) => /Contingency/i.test(a))).toBe(true);
    expect(result.assumptions.some((a) => /120 sq ft/.test(a))).toBe(true);
  });

  it('applies contingency to the subtotal, shown separately', () => {
    const result = estimate([tileLine], () => priced(100), labourAt(2000) as never, {
      ...DEFAULT_SETTINGS,
      contingency: 0.15,
    });
    expect(result.contingencyAmount).toBeCloseTo(result.subtotal * 0.15, 6);
    expect(result.total).toBeCloseTo(result.subtotal * 1.15, 6);
  });
});
