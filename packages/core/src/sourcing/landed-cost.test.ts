import { describe, expect, it } from 'vitest';
import type { ExchangeRate } from '../pricing/price.js';
import { compareSourcing, computeLandedCost, type DutySchedule, type FreightAndHandling } from './landed-cost.js';

const RATES: readonly ExchangeRate[] = [
  {
    from: 'CNY',
    to: 'PKR',
    rate: 40,
    retrievedAt: '2026-08-07T00:00:00.000Z',
    sourceName: 'Test rate',
    sourceUrl: 'https://example.invalid/fx',
  },
];

const duty: DutySchedule = {
  pctCode: '6907.2100',
  description: 'Ceramic tiles',
  customsDuty: 0.2,
  additionalCustomsDuty: 0.02,
  regulatoryDuty: 0.1,
  salesTax: 0.18,
  valueAdditionTax: 0.03,
  withholdingTax: 0.055,
  sourceName: 'Test schedule',
  sourceUrl: 'https://example.invalid/tariff',
  readAt: '2026-08-01T00:00:00.000Z',
  provisional: false,
};

const handling: FreightAndHandling = {
  internationalFreight: 200_000,
  insurance: 20_000,
  portCharges: 50_000,
  clearingAgentFee: 40_000,
  inlandFreight: 60_000,
  warehousing: 10_000,
  installation: 100_000,
  currency: 'PKR',
};

describe('landed cost', () => {
  it('cascades duty then sales tax then withholding, not all on CIF', () => {
    const outcome = computeLandedCost({
      description: 'Porcelain tile',
      unitPrice: 25, // CNY per sqft
      quantity: 1000,
      currency: 'CNY',
      duty,
      handling,
      targetCurrency: 'PKR',
      rates: RATES,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const b = outcome.breakdown;

    expect(b.fob).toBeCloseTo(25 * 1000 * 40, 6); // 1,000,000 PKR
    expect(b.cif).toBeCloseTo(1_000_000 + 200_000 + 20_000, 6); // 1,220,000

    // Duties are on CIF.
    expect(b.customsDuty).toBeCloseTo(1_220_000 * 0.2, 6);
    expect(b.dutyPaidValue).toBeCloseTo(1_220_000 * 1.32, 6);

    // Sales tax is on the DUTY-PAID value, not on CIF. This is the whole point.
    expect(b.salesTax).toBeCloseTo(b.dutyPaidValue * 0.18, 6);
    expect(b.salesTax).toBeGreaterThan(b.cif * 0.18);

    // Withholding is on the TAX-PAID value.
    expect(b.withholdingTax).toBeCloseTo(b.taxPaidValue * 0.055, 6);

    // And the factory price is nowhere near the landed cost.
    expect(b.landedTotal).toBeGreaterThan(b.fob * 1.7);
  });

  it('refuses to compute without a dated exchange rate', () => {
    const outcome = computeLandedCost({
      description: 'Tile',
      unitPrice: 25,
      quantity: 100,
      currency: 'CNY',
      duty,
      handling,
      targetCurrency: 'PKR',
      rates: [],
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('no_exchange_rate');
  });

  it('bills the minimum order quantity and reports the overhang', () => {
    const outcome = computeLandedCost({
      description: 'Façade panel',
      unitPrice: 100,
      quantity: 300,
      minimumOrderQuantity: 500,
      currency: 'CNY',
      duty,
      handling,
      targetCurrency: 'PKR',
      rates: RATES,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.breakdown.billedQuantity).toBe(500);
    expect(outcome.breakdown.moqOverhang).toBeGreaterThan(0);
    expect(outcome.breakdown.warnings.some((w) => /Minimum order quantity/.test(w))).toBe(true);
  });

  it('flags a provisional duty schedule', () => {
    const outcome = computeLandedCost({
      description: 'Tile',
      unitPrice: 25,
      quantity: 100,
      currency: 'CNY',
      duty: { ...duty, provisional: true },
      handling,
      targetCurrency: 'PKR',
      rates: RATES,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.breakdown.provisional).toBe(true);
      expect(outcome.breakdown.warnings.some((w) => /PROVISIONAL/.test(w))).toBe(true);
    }
  });
});

describe('sourcing comparison', () => {
  it('says so plainly when local is cheaper', () => {
    const c = compareSourcing({
      description: 'Tile',
      localTotal: 1_000_000,
      importedTotal: 1_400_000,
      currency: 'PKR',
    });
    expect(c.verdict).toBe('local_cheaper');
    expect(c.statement).toMatch(/Local sourcing is cheaper/);
  });

  it('does not claim a winner inside the comparable band', () => {
    const c = compareSourcing({
      description: 'Tile',
      localTotal: 1_000_000,
      importedTotal: 1_030_000,
      currency: 'PKR',
    });
    expect(c.verdict).toBe('comparable');
  });

  it('refuses to compare when one side is unpriced', () => {
    const c = compareSourcing({
      description: 'Tile',
      localTotal: null,
      importedTotal: 1_000_000,
      currency: 'PKR',
    });
    expect(c.verdict).toBe('insufficient_data');
    expect(c.statement).toMatch(/No local price/);
  });
});
