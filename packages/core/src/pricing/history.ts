/**
 * Price history and trend.
 *
 * Requirement 45/46: refreshing prices must never overwrite history, and where
 * enough data exists, show the trend.
 *
 * The reason history matters here is specific to this market. Pakistani
 * construction prices move enough within a project's life that a user needs to
 * know not just what cement costs but which way it is going — a 6% rise over
 * two months is a different procurement decision from a flat rate, even at the
 * same number today.
 *
 * The module refuses to draw a trend from too few points or too short a window.
 * Two observations a week apart do not establish a direction, and a chart that
 * implies one is worse than no chart.
 */

import type { MaterialId, ProductId } from '../model/ids.js';
import type { Currency, PriceRecord, PriceUnit } from './price.js';

export interface PricePoint {
  readonly at: string;
  readonly amount: number;
  readonly currency: Currency;
  readonly unit: PriceUnit;
  readonly sourceId: string;
  readonly sourceUrl: string;
  readonly specification?: string;
}

export type TrendDirection = 'rising' | 'falling' | 'flat' | 'insufficient_data';

export interface PriceTrend {
  readonly productId: ProductId;
  readonly points: readonly PricePoint[];
  readonly direction: TrendDirection;
  /** Fractional change from first to last point. Null when not established. */
  readonly change: number | null;
  /** Change annualised, for comparing series of different lengths. */
  readonly annualisedChange: number | null;
  readonly spanDays: number;
  readonly statement: string;
  readonly latest: PricePoint | null;
  readonly lowest: PricePoint | null;
  readonly highest: PricePoint | null;
}

/** Below this many observations, no direction is claimed. */
const MIN_POINTS_FOR_TREND = 3;
/** Below this span, no direction is claimed regardless of point count. */
const MIN_SPAN_DAYS = 21;
/** Change below this is reported as flat rather than as a direction. */
const FLAT_THRESHOLD = 0.02;

function toPoint(record: PriceRecord): PricePoint {
  return {
    at: record.verifiedAt ?? record.retrievedAt,
    amount: record.amount,
    currency: record.currency,
    unit: record.unit,
    sourceId: record.sourceId,
    sourceUrl: record.sourceUrl,
    specification: record.specification,
  };
}

/**
 * Build a trend from a product's records.
 *
 * Records in different units or currencies are excluded rather than converted:
 * a series that silently mixes PKR/bag with PKR/tonne produces a chart that is
 * pure noise, and converting would require an exchange rate for every point.
 * The dominant unit and currency win, and the exclusion is reported.
 */
export function priceTrend(records: readonly PriceRecord[]): PriceTrend {
  if (records.length === 0) {
    return {
      productId: 'unknown' as ProductId,
      points: [],
      direction: 'insufficient_data',
      change: null,
      annualisedChange: null,
      spanDays: 0,
      statement: 'No price history on file.',
      latest: null,
      lowest: null,
      highest: null,
    };
  }

  const productId = records[0]!.productId;

  // Pick the most common (unit, currency) pair and keep only those.
  const counts = new Map<string, number>();
  for (const r of records) {
    const key = `${r.unit}|${r.currency}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0]!;
  const [dominantUnit, dominantCurrency] = dominant.split('|');
  const excluded = records.length - (counts.get(dominant) ?? 0);

  const points = records
    .filter((r) => r.unit === dominantUnit && r.currency === dominantCurrency)
    .map(toPoint)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  const latest = points[points.length - 1] ?? null;
  const lowest = points.reduce<PricePoint | null>(
    (min, p) => (min === null || p.amount < min.amount ? p : min),
    null,
  );
  const highest = points.reduce<PricePoint | null>(
    (max, p) => (max === null || p.amount > max.amount ? p : max),
    null,
  );

  const exclusionNote =
    excluded > 0
      ? ` ${excluded} observation(s) in a different unit or currency are excluded from the series.`
      : '';

  if (points.length < MIN_POINTS_FOR_TREND) {
    return {
      productId,
      points,
      direction: 'insufficient_data',
      change: null,
      annualisedChange: null,
      spanDays: spanOf(points),
      statement:
        `${points.length} observation(s) — too few to establish a direction. ` +
        `At least ${MIN_POINTS_FOR_TREND} are needed.${exclusionNote}`,
      latest,
      lowest,
      highest,
    };
  }

  const spanDays = spanOf(points);
  if (spanDays < MIN_SPAN_DAYS) {
    return {
      productId,
      points,
      direction: 'insufficient_data',
      change: null,
      annualisedChange: null,
      spanDays,
      statement:
        `${points.length} observations spanning ${spanDays.toFixed(0)} days — too short a window to ` +
        `establish a direction.${exclusionNote}`,
      latest,
      lowest,
      highest,
    };
  }

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const change = (last.amount - first.amount) / first.amount;
  const annualisedChange = change * (365 / spanDays);

  const direction: TrendDirection =
    Math.abs(change) < FLAT_THRESHOLD ? 'flat' : change > 0 ? 'rising' : 'falling';

  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const statement =
    direction === 'flat'
      ? `Flat: ${pct(change)} over ${spanDays.toFixed(0)} days across ${points.length} observations.${exclusionNote}`
      : `${direction === 'rising' ? 'Rising' : 'Falling'} ${pct(Math.abs(change))} over ` +
        `${spanDays.toFixed(0)} days (${pct(Math.abs(annualisedChange))} annualised) across ` +
        `${points.length} observations.${exclusionNote}`;

  return {
    productId,
    points,
    direction,
    change,
    annualisedChange,
    spanDays,
    statement,
    latest,
    lowest,
    highest,
  };
}

function spanOf(points: readonly PricePoint[]): number {
  if (points.length < 2) return 0;
  const first = Date.parse(points[0]!.at);
  const last = Date.parse(points[points.length - 1]!.at);
  return (last - first) / 86_400_000;
}

/**
 * What a refresh changed.
 *
 * Shown after "Refresh market prices" so the user sees what moved rather than
 * a silently different total.
 */
export interface RefreshDelta {
  readonly materialId: MaterialId;
  readonly materialName: string;
  readonly previous: number | null;
  readonly current: number;
  readonly change: number | null;
  readonly currency: Currency;
  readonly unit: PriceUnit;
  readonly sourceId: string;
}

export function summariseRefresh(deltas: readonly RefreshDelta[]): string {
  if (deltas.length === 0) return 'No prices changed.';
  const moved = deltas.filter((d) => d.change !== null && Math.abs(d.change) > 0.001);
  const added = deltas.filter((d) => d.previous === null);

  const parts: string[] = [];
  if (added.length > 0) parts.push(`${added.length} new price(s) recorded`);
  if (moved.length > 0) {
    const up = moved.filter((d) => (d.change ?? 0) > 0).length;
    const down = moved.length - up;
    parts.push(`${moved.length} changed (${up} up, ${down} down)`);
  }
  if (parts.length === 0) return `${deltas.length} price(s) re-verified, none changed.`;
  return `${parts.join('; ')}. Previous values are kept in history.`;
}
