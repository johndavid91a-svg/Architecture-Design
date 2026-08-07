import { describe, expect, it } from 'vitest';
import type { PriceId, ProductId, SourceId } from '../model/ids.js';
import { confidenceOf, isStale, selectBestPrice, type PriceRecord } from './price.js';

const PRODUCT = 'prd_cement' as ProductId;

function record(over: Partial<PriceRecord> = {}): PriceRecord {
  return {
    id: 'prc_1' as PriceId,
    productId: PRODUCT,
    amount: 1500,
    currency: 'PKR',
    unit: 'bag_50kg',
    sourceId: 'src_brick_pakistan' as SourceId,
    sourceTier: 'LEVEL_2_MARKET',
    sourceUrl: 'https://example.invalid/rates',
    retrievedAt: '2026-08-01T00:00:00.000Z',
    location: 'Islamabad',
    ...over,
  };
}

const NOW = new Date('2026-08-07T00:00:00.000Z');

describe('price selection', () => {
  it('reports unavailable when nothing is on file, with no amount to read', () => {
    const result = selectBestPrice([], NOW);
    expect(result.available).toBe(false);
    // The point of the union: there is no numeric field to accidentally use.
    expect(result).not.toHaveProperty('record');
    if (!result.available) {
      expect(result.reason).toBe('no_record');
      expect(result.remedy).toMatch(/quotation|connector/i);
    }
  });

  it('refuses to fall back on a stale price', () => {
    // A 200-day-old market listing is not a current price. Silently using it
    // would be fabricating a price by omission.
    const old = record({ retrievedAt: '2026-01-01T00:00:00.000Z' });
    const result = selectBestPrice([old], NOW);
    expect(result.available).toBe(false);
    if (!result.available) {
      expect(result.reason).toBe('all_stale');
      expect(result.staleRecords).toHaveLength(1);
    }
  });

  it('prefers a supplier quotation over a market listing', () => {
    const market = record({ id: 'prc_market' as PriceId, amount: 1500 });
    const quote = record({
      id: 'prc_quote' as PriceId,
      amount: 1440,
      sourceTier: 'LEVEL_3_SUPPLIER_QUOTE',
      sourceId: 'src_supplier_quotation' as SourceId,
    });
    const result = selectBestPrice([market, quote], NOW);
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.record.id).toBe('prc_quote');
      expect(result.alternatives).toHaveLength(1);
    }
  });

  it('decays confidence with age rather than storing it', () => {
    const fresh = record({
      sourceTier: 'LEVEL_1_OFFICIAL',
      retrievedAt: '2026-08-06T00:00:00.000Z',
    });
    expect(confidenceOf(fresh, NOW)).toBe('HIGH');

    const middling = record({
      sourceTier: 'LEVEL_1_OFFICIAL',
      retrievedAt: '2026-07-05T00:00:00.000Z', // 33 days: past half the 45-day window
    });
    expect(confidenceOf(middling, NOW)).toBe('MEDIUM');

    const old = record({
      sourceTier: 'LEVEL_1_OFFICIAL',
      retrievedAt: '2026-05-01T00:00:00.000Z',
    });
    expect(confidenceOf(old, NOW)).toBe('LOW');
    expect(isStale(old, NOW)).toBe(true);
  });

  it('never reports a user estimate above low confidence', () => {
    const guess = record({
      sourceTier: 'LEVEL_4_ESTIMATE',
      retrievedAt: '2026-08-07T00:00:00.000Z',
      verifiedAt: '2026-08-07T00:00:00.000Z',
    });
    expect(confidenceOf(guess, NOW)).toBe('LOW');
  });
});
