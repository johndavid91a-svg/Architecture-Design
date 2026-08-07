/**
 * The session's price book.
 *
 * It starts EMPTY, and that is the single most deliberate decision in the
 * application.
 *
 * Shipping a seeded price list would make the first run look impressive and
 * would be the exact failure requirement 62 forbids. A rate scraped from a blog
 * post six months ago, presented in a total the user is about to quote against,
 * is a fabricated price whether or not it was invented from nothing. Pakistani
 * cement, steel and brick rates have moved sharply within single months; a
 * shipped constant is wrong by the time it reaches anyone.
 *
 * So prices enter one of three ways, all of them attributed:
 *
 *   1. A supplier quotation the user uploads or types in (LEVEL 3).
 *   2. A price connector fetching a configured source on the user's own machine,
 *      which records the URL and the retrieval date (LEVEL 1 / LEVEL 2).
 *   3. A manual estimate the user enters knowingly, which is always reported as
 *      LOW confidence (LEVEL 4).
 *
 * Until one of those happens, the estimate reports the gap. That is the correct
 * behaviour, not a missing feature.
 */

import {
  newId,
  selectBestPrice,
  unavailable,
  type Currency,
  type MaterialId,
  type PriceId,
  type PriceLookup,
  type PriceRecord,
  type PriceUnit,
  type ProductId,
  type SourceId,
  type SourceTier,
  type TradeCode,
  type LabourRate,
  type LabourRateId,
  type LabourRateLookup,
  confidenceOf,
  isStale,
} from '@adp/core';

export interface ManualPriceEntry {
  readonly materialId: MaterialId;
  readonly amount: number;
  readonly currency: Currency;
  readonly unit: PriceUnit;
  readonly location: string;
  readonly specification?: string;
  /** A supplier quotation, or the user's own market estimate. */
  readonly kind: 'supplier_quote' | 'user_estimate';
  readonly sourceUrl?: string;
  readonly supplierName?: string;
}

export interface ManualLabourEntry {
  readonly trade: TradeCode;
  readonly amount: number;
  readonly currency: Currency;
  readonly location: string;
  readonly kind: 'supplier_quote' | 'user_estimate';
  readonly note?: string;
}

export class PriceBook {
  /** Material prices, keyed by material. One material may hold many records. */
  private readonly prices = new Map<MaterialId, PriceRecord[]>();
  private readonly labour = new Map<TradeCode, LabourRate[]>();

  /**
   * Material ids double as product ids here because the desktop build does not
   * yet model per-supplier products. The distinction exists in the core types
   * and becomes load-bearing when the supplier database lands; keeping the ids
   * parallel now means that change does not rewrite the estimator.
   */
  addPrice(entry: ManualPriceEntry, now = new Date()): PriceRecord {
    const isQuote = entry.kind === 'supplier_quote';
    const tier: SourceTier = isQuote ? 'LEVEL_3_SUPPLIER_QUOTE' : 'LEVEL_4_ESTIMATE';
    const record: PriceRecord = {
      id: newId<PriceId>('prc'),
      productId: entry.materialId as unknown as ProductId,
      amount: entry.amount,
      currency: entry.currency,
      unit: entry.unit,
      sourceId: (isQuote ? 'src_supplier_quotation' : 'src_manual_entry') as SourceId,
      sourceTier: tier,
      sourceUrl: entry.sourceUrl ?? '',
      retrievedAt: now.toISOString(),
      // A quotation the user is looking at counts as verified now; an estimate
      // never does, which is what keeps it pinned to LOW confidence.
      verifiedAt: isQuote ? now.toISOString() : undefined,
      location: entry.location,
      specification: entry.specification,
      note: entry.supplierName ? `Quoted by ${entry.supplierName}` : undefined,
    };

    const existing = this.prices.get(entry.materialId) ?? [];
    this.prices.set(entry.materialId, [...existing, record]);
    return record;
  }

  addLabourRate(entry: ManualLabourEntry, now = new Date()): LabourRate {
    const isQuote = entry.kind === 'supplier_quote';
    const rate: LabourRate = {
      id: newId<LabourRateId>('lab'),
      trade: entry.trade,
      amount: entry.amount,
      currency: entry.currency,
      unit: 'day',
      location: entry.location,
      sourceId: (isQuote ? 'src_supplier_quotation' : 'src_manual_entry') as SourceId,
      sourceTier: isQuote ? 'LEVEL_3_SUPPLIER_QUOTE' : 'LEVEL_4_ESTIMATE',
      sourceUrl: '',
      retrievedAt: now.toISOString(),
      verifiedAt: isQuote ? now.toISOString() : undefined,
      note: entry.note,
    };
    const existing = this.labour.get(entry.trade) ?? [];
    this.labour.set(entry.trade, [...existing, rate]);
    return rate;
  }

  lookup(materialId: MaterialId, now = new Date()): PriceLookup {
    const records = this.prices.get(materialId);
    if (!records || records.length === 0) {
      return unavailable(materialId as unknown as ProductId, 'no_record');
    }
    return selectBestPrice(records, now, materialId as unknown as ProductId);
  }

  lookupLabour(trade: TradeCode, now = new Date()): LabourRateLookup {
    const rates = this.labour.get(trade);
    if (!rates || rates.length === 0) {
      return {
        available: false,
        trade,
        remedy: `No wage rate on file for ${trade}. Record a daily rate with its source and date.`,
      };
    }
    // Reuse the price staleness and confidence rules: a wage rate is a price.
    const asPrice = (r: LabourRate): PriceRecord => ({
      id: r.id as unknown as PriceId,
      productId: r.trade as unknown as ProductId,
      amount: r.amount,
      currency: r.currency,
      unit: 'day',
      sourceId: r.sourceId,
      sourceTier: r.sourceTier,
      sourceUrl: r.sourceUrl,
      retrievedAt: r.retrievedAt,
      verifiedAt: r.verifiedAt,
      location: r.location,
    });

    const fresh = rates.filter((r) => !isStale(asPrice(r), now));
    if (fresh.length === 0) {
      return {
        available: false,
        trade,
        remedy: `Every wage rate on file for ${trade} is past its validity window. Re-verify it.`,
      };
    }
    const best = fresh[fresh.length - 1]!;
    return { available: true, rate: best, confidence: confidenceOf(asPrice(best), now) };
  }

  allPrices(): ReadonlyMap<MaterialId, readonly PriceRecord[]> {
    return this.prices;
  }

  allLabour(): ReadonlyMap<TradeCode, readonly LabourRate[]> {
    return this.labour;
  }

  get isEmpty(): boolean {
    return this.prices.size === 0 && this.labour.size === 0;
  }
}
