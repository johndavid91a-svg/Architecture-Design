/**
 * Price records and lookup results.
 *
 * Requirement 62 is the hard one: "NEVER FABRICATE PRICES. If the application
 * cannot find a current price, DO NOT invent one."
 *
 * Documentation alone does not achieve that. What achieves it is making
 * "unpriced" a value the estimator is forced to handle. `PriceLookup` is a
 * discriminated union with no numeric field on the unavailable branch, so a
 * caller cannot read `.amount` off a miss, and cannot accidentally coerce it to
 * zero. An unpriced item propagates all the way to the BOQ as an explicit gap
 * with a call to action, and the project total is reported as incomplete rather
 * than as a smaller number.
 */

import type { PriceId, ProductId, SourceId } from '../model/ids.js';
import type { SourceTier } from './source.js';
import { SOURCE_TIER_ORDER } from './source.js';

export type Currency = 'PKR' | 'USD' | 'CNY' | 'EUR' | 'AED' | 'GBP';

/** The unit a price is quoted in. Must match the takeoff unit before multiplying. */
export type PriceUnit =
  | 'bag_50kg'
  | 'kg'
  | 'tonne'
  | 'each'
  | 'thousand'
  | 'sqft'
  | 'sqm'
  | 'cft'
  | 'cum'
  | 'rft'
  | 'rm'
  | 'litre'
  | 'gallon'
  | 'day'
  | 'hour';

export type PriceConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * A price observation. Immutable once written.
 *
 * Refreshing a price never overwrites one of these; it appends a new record and
 * supersedes the old one. That is what makes the price-history view possible and
 * what stops a refresh from silently rewriting the basis of an estimate the user
 * already approved.
 */
export interface PriceRecord {
  readonly id: PriceId;
  readonly productId: ProductId;
  readonly amount: number;
  readonly currency: Currency;
  readonly unit: PriceUnit;
  readonly sourceId: SourceId;
  readonly sourceTier: SourceTier;
  /** Deep link to the exact page or document the figure came from. */
  readonly sourceUrl: string;
  /** ISO date the figure was retrieved from the source. */
  readonly retrievedAt: string;
  /** ISO date a human last confirmed it. Absent until someone actually checks. */
  readonly verifiedAt?: string;
  /** e.g. "Islamabad", "Rawalpindi", "Ex-works Foshan". */
  readonly location: string;
  /** Brand/grade the figure applies to. A rate without a grade cannot be compared. */
  readonly specification?: string;
  /** Minimum order quantity the price is conditional on, if any. */
  readonly minimumQuantity?: number;
  /** Set when this record replaces an earlier one; the old record is kept. */
  readonly supersedesPriceId?: PriceId;
  readonly note?: string;
}

/**
 * How long a price from each tier stays trustworthy.
 *
 * Pakistani construction material prices move with fuel and exchange rates, and
 * have moved sharply within single months. A 90-day-old market listing is not a
 * current price, and presenting it as one is the quiet version of fabricating it.
 */
export const STALENESS_DAYS: Record<SourceTier, number> = {
  LEVEL_3_SUPPLIER_QUOTE: 30, // Quotations typically state 15–30 day validity.
  LEVEL_1_OFFICIAL: 45,
  LEVEL_2_MARKET: 30,
  LEVEL_4_ESTIMATE: 14,
};

export function ageInDays(record: PriceRecord, now: Date): number {
  const basis = record.verifiedAt ?? record.retrievedAt;
  const then = Date.parse(basis);
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  return (now.getTime() - then) / 86_400_000;
}

export function isStale(record: PriceRecord, now: Date): boolean {
  return ageInDays(record, now) > STALENESS_DAYS[record.sourceTier];
}

/**
 * Confidence is derived, never stored.
 *
 * If it were a stored field, a stale HIGH would keep claiming to be HIGH. Deriving
 * it from tier plus age means confidence decays on its own as a project sits.
 */
export function confidenceOf(record: PriceRecord, now: Date): PriceConfidence {
  const age = ageInDays(record, now);
  const limit = STALENESS_DAYS[record.sourceTier];

  if (age > limit) return 'LOW';

  switch (record.sourceTier) {
    case 'LEVEL_3_SUPPLIER_QUOTE':
      return record.verifiedAt ? 'HIGH' : 'MEDIUM';
    case 'LEVEL_1_OFFICIAL':
      return age <= limit / 2 ? 'HIGH' : 'MEDIUM';
    case 'LEVEL_2_MARKET':
      return 'MEDIUM';
    case 'LEVEL_4_ESTIMATE':
      return 'LOW';
  }
}

/** Why no price could be produced. Each maps to a different UI call to action. */
export type UnavailableReason =
  /** Nothing in the repository for this product at all. */
  | 'no_record'
  /** Records exist but every one is past its staleness window. */
  | 'all_stale'
  /** A record exists but its unit cannot be reconciled with the takeoff unit. */
  | 'unit_mismatch'
  /** A record exists but in a currency with no dated exchange rate available. */
  | 'no_exchange_rate'
  /** The connector for the configured source has not been run on this machine. */
  | 'connector_not_run';

/**
 * The result of asking for a price.
 *
 * There is deliberately no `amount` on the unavailable branch, and deliberately
 * no default. Every consumer must destructure on `available` and decide what to
 * do about a gap.
 */
export type PriceLookup =
  | {
      readonly available: true;
      readonly record: PriceRecord;
      readonly confidence: PriceConfidence;
      readonly ageDays: number;
      /** Other records for the same product, for the "multiple options" UI. */
      readonly alternatives: readonly PriceRecord[];
    }
  | {
      readonly available: false;
      readonly reason: UnavailableReason;
      readonly productId: ProductId;
      /** What the user should do about it, shown verbatim in the BOQ gap row. */
      readonly remedy: string;
      /** Stale records, if any — offered to the user to re-verify, never used silently. */
      readonly staleRecords: readonly PriceRecord[];
    };

export function unavailable(
  productId: ProductId,
  reason: UnavailableReason,
  staleRecords: readonly PriceRecord[] = [],
): PriceLookup {
  const remedies: Record<UnavailableReason, string> = {
    no_record:
      'No price on file. Enter a supplier quotation, import a price list, or run a price connector.',
    all_stale:
      'Every price on file is past its validity window. Re-verify with the supplier or refresh market prices.',
    unit_mismatch:
      'The price on file is quoted in a unit that cannot be converted to the takeoff unit. Enter a price in the required unit.',
    no_exchange_rate:
      'The price is in a foreign currency and no dated exchange rate is on file. Record an exchange rate with its source and date.',
    connector_not_run:
      'The configured price source has not been fetched on this machine. Run Refresh Market Prices.',
  };
  return { available: false, reason, productId, remedy: remedies[reason], staleRecords };
}

/**
 * Choose the best record for a product: highest-standing tier first, then most
 * recently verified. Stale records are excluded entirely rather than ranked last —
 * a stale price is not a worse price, it is not a price.
 */
export function selectBestPrice(
  records: readonly PriceRecord[],
  now: Date,
  /** Needed only when `records` is empty, so the miss can name what it missed. */
  requestedProductId?: ProductId,
): PriceLookup {
  if (records.length === 0) {
    return unavailable(requestedProductId ?? ('unknown' as ProductId), 'no_record');
  }
  const productId = records[0]!.productId;
  const fresh = records.filter((r) => !isStale(r, now));
  if (fresh.length === 0) {
    return unavailable(productId, 'all_stale', records);
  }

  const ranked = [...fresh].sort((a, b) => {
    const tierDelta = SOURCE_TIER_ORDER[a.sourceTier] - SOURCE_TIER_ORDER[b.sourceTier];
    if (tierDelta !== 0) return tierDelta;
    const aDate = Date.parse(a.verifiedAt ?? a.retrievedAt);
    const bDate = Date.parse(b.verifiedAt ?? b.retrievedAt);
    return bDate - aDate;
  });

  const best = ranked[0]!;
  return {
    available: true,
    record: best,
    confidence: confidenceOf(best, now),
    ageDays: ageInDays(best, now),
    alternatives: ranked.slice(1),
  };
}

/** A dated exchange rate. Requirement 64: store the source and the date, always. */
export interface ExchangeRate {
  readonly from: Currency;
  readonly to: Currency;
  readonly rate: number;
  readonly retrievedAt: string;
  readonly sourceName: string;
  readonly sourceUrl: string;
}

export function convert(
  amount: number,
  from: Currency,
  to: Currency,
  rates: readonly ExchangeRate[],
): { ok: true; amount: number; rate: ExchangeRate } | { ok: false; reason: 'no_rate' } {
  if (from === to) {
    return {
      ok: true,
      amount,
      rate: { from, to, rate: 1, retrievedAt: 'n/a', sourceName: 'identity', sourceUrl: '' },
    };
  }
  const direct = rates.find((r) => r.from === from && r.to === to);
  if (direct) return { ok: true, amount: amount * direct.rate, rate: direct };

  const inverse = rates.find((r) => r.from === to && r.to === from);
  if (inverse && inverse.rate !== 0) {
    return {
      ok: true,
      amount: amount / inverse.rate,
      rate: { ...inverse, from, to, rate: 1 / inverse.rate },
    };
  }
  return { ok: false, reason: 'no_rate' };
}
