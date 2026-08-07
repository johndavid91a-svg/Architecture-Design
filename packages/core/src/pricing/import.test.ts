import { describe, expect, it } from 'vitest';
import { importPriceCsv, inferColumns, matchMaterial, parseAmount, parseUnit } from './import.js';
import { priceTrend } from './history.js';
import type { PriceId, PriceRecord, ProductId, SourceId } from '../model/ids.js';

describe('amount parsing', () => {
  it('reads the formats that appear on a Pakistani price list', () => {
    expect(parseAmount('1,450')).toBe(1450);
    expect(parseAmount('PKR 1450')).toBe(1450);
    expect(parseAmount('Rs. 1,450.50')).toBe(1450.5);
    expect(parseAmount('  1450  ')).toBe(1450);
  });

  it('refuses anything it cannot read cleanly', () => {
    // A partial reading here is a 10x error in a figure someone will act on.
    expect(parseAmount('1,2 50')).toBeNull();
    expect(parseAmount('on request')).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('-500')).toBeNull();
    expect(parseAmount('1450-1600')).toBeNull();
  });
});

describe('unit parsing', () => {
  it('accepts the common spellings', () => {
    expect(parseUnit('sqft')).toBe('sqft');
    expect(parseUnit('Sq Ft')).toBe('sqft');
    expect(parseUnit('per sqft')).toBe('sqft');
    expect(parseUnit('bag')).toBe('bag_50kg');
    expect(parseUnit('Nos')).toBe('each');
  });

  it('returns null for anything unrecognised', () => {
    expect(parseUnit('per truck')).toBeNull();
    expect(parseUnit('lot')).toBeNull();
  });
});

describe('material matching', () => {
  it('matches a clear description', () => {
    const m = matchMaterial('Porcelain floor tile 600x600 premium');
    expect(m.materialId).toBe('mat_tile_porcelain');
    expect(m.confidence).toBeGreaterThan(0.6);
  });

  it('declines a weak match rather than guessing', () => {
    // Attaching an unrelated line to a material would price the wrong thing.
    const m = matchMaterial('Miscellaneous site consumables');
    expect(m.materialId).toBeNull();
  });
});

describe('CSV import', () => {
  const csv = [
    'Description,Brand,Unit,Rate,Supplier',
    'Porcelain floor tile 600x600,Brand A,sqft,450,Supplier X',
    'Marble slab flooring,Brand B,sqft,1200,Supplier X',
    '"Cement, ordinary portland",Brand C,bag,1450,Supplier Y',
    'Mystery item,,lot,on request,Supplier Z',
  ].join('\n');

  it('infers the column mapping from the header row', () => {
    const mapping = inferColumns(['Description', 'Brand', 'Unit', 'Rate', 'Supplier']);
    expect(mapping).not.toBeNull();
    expect(mapping!.description).toBe(0);
    expect(mapping!.amount).toBe(3);
    expect(mapping!.unit).toBe(2);
  });

  it('parses quoted fields containing commas', () => {
    const result = importPriceCsv(csv);
    const cement = result.rows.find((r) => r.rawDescription.includes('Cement'));
    expect(cement?.rawDescription).toBe('Cement, ordinary portland');
    expect(cement?.amount).toBe(1450);
    expect(cement?.unit).toBe('bag_50kg');
  });

  it('flags rows it cannot read instead of dropping or guessing them', () => {
    const result = importPriceCsv(csv);
    const mystery = result.rows.find((r) => r.rawDescription === 'Mystery item')!;
    expect(mystery.importable).toBe(false);
    expect(mystery.problems.length).toBeGreaterThan(0);
    expect(mystery.problems.join(' ')).toMatch(/rate|unit|material/i);

    // The row is still returned — the user decides what to do with it.
    expect(result.rows).toHaveLength(4);
    expect(result.importableCount).toBe(3);
    expect(result.problemCount).toBe(1);
  });

  it('reports a file whose columns cannot be identified', () => {
    const result = importPriceCsv('Foo,Bar\n1,2');
    expect(result.rows).toHaveLength(0);
    expect(result.warnings[0]).toMatch(/Could not identify/);
  });
});

function record(amount: number, at: string): PriceRecord {
  return {
    id: `prc_${at}` as PriceId,
    productId: 'prd_cement' as ProductId,
    amount,
    currency: 'PKR',
    unit: 'bag_50kg',
    sourceId: 'src_brick_pakistan' as SourceId,
    sourceTier: 'LEVEL_2_MARKET',
    sourceUrl: 'https://example.invalid',
    retrievedAt: at,
    location: 'Islamabad',
  };
}

describe('price trend', () => {
  it('refuses to claim a direction from too few points', () => {
    const trend = priceTrend([record(1400, '2026-01-01T00:00:00Z'), record(1500, '2026-06-01T00:00:00Z')]);
    expect(trend.direction).toBe('insufficient_data');
    expect(trend.statement).toMatch(/too few/i);
  });

  it('refuses to claim a direction over too short a window', () => {
    const trend = priceTrend([
      record(1400, '2026-08-01T00:00:00Z'),
      record(1450, '2026-08-03T00:00:00Z'),
      record(1500, '2026-08-05T00:00:00Z'),
    ]);
    expect(trend.direction).toBe('insufficient_data');
    expect(trend.statement).toMatch(/too short/i);
  });

  it('reports a rise with the annualised rate', () => {
    const trend = priceTrend([
      record(1400, '2026-01-01T00:00:00Z'),
      record(1450, '2026-03-01T00:00:00Z'),
      record(1540, '2026-06-01T00:00:00Z'),
    ]);
    expect(trend.direction).toBe('rising');
    expect(trend.change).toBeCloseTo(0.1, 2);
    expect(trend.annualisedChange).toBeGreaterThan(0.1);
    expect(trend.highest?.amount).toBe(1540);
    expect(trend.lowest?.amount).toBe(1400);
  });

  it('calls a small movement flat rather than a trend', () => {
    const trend = priceTrend([
      record(1500, '2026-01-01T00:00:00Z'),
      record(1505, '2026-03-01T00:00:00Z'),
      record(1510, '2026-06-01T00:00:00Z'),
    ]);
    expect(trend.direction).toBe('flat');
  });

  it('excludes observations in a different unit rather than mixing them', () => {
    const mixed: PriceRecord[] = [
      record(1400, '2026-01-01T00:00:00Z'),
      record(1450, '2026-03-01T00:00:00Z'),
      record(1500, '2026-06-01T00:00:00Z'),
      { ...record(29_000, '2026-06-02T00:00:00Z'), unit: 'tonne' },
    ];
    const trend = priceTrend(mixed);
    expect(trend.points).toHaveLength(3);
    expect(trend.statement).toMatch(/excluded from the series/);
  });
});
