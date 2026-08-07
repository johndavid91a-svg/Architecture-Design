/**
 * Price source hierarchy.
 *
 * Requirement 29: "Do NOT treat every website equally."
 *
 * Every price in the system carries the source it came from, and every source
 * carries a tier. The tier is not decoration — it drives the confidence level
 * shown next to the figure, it decides which of two conflicting prices wins,
 * and it decides how quickly a price goes stale.
 */

import type { SourceId } from '../model/ids.js';

export type SourceTier =
  /** Government and statutory bodies: PBS, CDA, RDA, FBR, provincial schedules of rates. */
  | 'LEVEL_1_OFFICIAL'
  /** Established market platforms and published price databases. */
  | 'LEVEL_2_MARKET'
  /** A named supplier's actual quotation for this project. */
  | 'LEVEL_3_SUPPLIER_QUOTE'
  /** General market estimate. Lowest standing; always reported as low confidence. */
  | 'LEVEL_4_ESTIMATE';

export const SOURCE_TIER_ORDER: Record<SourceTier, number> = {
  LEVEL_3_SUPPLIER_QUOTE: 0, // A real quote for this project beats a published average.
  LEVEL_1_OFFICIAL: 1,
  LEVEL_2_MARKET: 2,
  LEVEL_4_ESTIMATE: 3,
};

/**
 * Note on ordering: a supplier quotation outranks an official statistic.
 *
 * PBS publishes a national average retail price; CDA publishes a schedule of
 * rates for its own works. Both are authoritative *as statistics*. But if a
 * Rawalpindi supplier has quoted this project a specific figure for a specific
 * quantity on a specific date, that is the number the user will actually pay.
 * Official sources still rank above market platforms because they are
 * accountable and methodologically documented.
 */

export interface PriceSource {
  readonly id: SourceId;
  readonly name: string;
  readonly tier: SourceTier;
  /** Landing page a user can open to check the figure themselves. */
  readonly url: string;
  /** What this source is legitimately good for, shown as UI help text. */
  readonly covers: string;
  /** Known limitations. Displayed so a user does not over-trust a number. */
  readonly caveats: string;
  /** How often the source publishes. Feeds the staleness policy. */
  readonly cadence: 'weekly' | 'monthly' | 'quarterly' | 'annual' | 'irregular' | 'on_request';
  /** Region the source's figures apply to. */
  readonly region: string;
  /**
   * Whether an automated connector exists. Sources without one are still listed
   * so a user can consult them manually and enter the figure.
   */
  readonly connector: 'implemented' | 'planned' | 'manual_only';
}

/**
 * The registry of sources the platform knows about for Pakistan.
 *
 * This file contains NO PRICES. It is a directory of where prices come from.
 * Prices enter the system only through a connector run on the user's machine or
 * through manual entry — see `repository.ts` for why that separation exists.
 */
export const PAKISTAN_SOURCES: readonly PriceSource[] = [
  {
    id: 'src_pbs_price_statistics' as SourceId,
    name: 'Pakistan Bureau of Statistics — Price Statistics',
    tier: 'LEVEL_1_OFFICIAL',
    url: 'https://www.pbs.gov.pk/price-statistics',
    covers:
      'Sensitive Price Indicator (weekly), Consumer and Wholesale Price Indices (monthly). ' +
      'Carries average retail prices for a basket that includes cement and, in the WPI series, ' +
      'building materials.',
    caveats:
      'National and city-average retail figures, not delivered-to-site trade prices. Published as ' +
      'PDF/Excel with a lag. Useful as an official anchor and for trend direction, not as a ' +
      'substitute for a supplier quotation on a specific quantity.',
    cadence: 'weekly',
    region: 'Pakistan (national and major cities)',
    connector: 'planned',
  },
  {
    id: 'src_cda_regulations' as SourceId,
    name: 'Capital Development Authority — Laws and Regulations',
    tier: 'LEVEL_1_OFFICIAL',
    url: 'https://cda.gov.pk/lawsAndRegulations',
    covers:
      'Islamabad building control regulations: land use, FAR, height, setbacks, parking and ' +
      'coverage requirements. Also CDA schedules of rates where published.',
    caveats:
      'Regulatory rather than commercial. Amendments are issued as separate notifications, so the ' +
      'consolidated document on the site may lag. Never treat a check against these rules as approval.',
    cadence: 'irregular',
    region: 'Islamabad',
    connector: 'manual_only',
  },
  {
    id: 'src_rda_building_control' as SourceId,
    name: 'Rawalpindi Development Authority — Land and Building Control',
    tier: 'LEVEL_1_OFFICIAL',
    url: 'https://rda.gop.pk/land-building-control',
    covers: 'Rawalpindi building control: approvals, bye-laws, setbacks, height and land-use rules.',
    caveats: 'Same as CDA: regulatory, amendment-prone, and not an approval.',
    cadence: 'irregular',
    region: 'Rawalpindi',
    connector: 'manual_only',
  },
  {
    id: 'src_fbr_property_valuation' as SourceId,
    name: 'FBR — Immovable Property Valuation (Islamabad)',
    tier: 'LEVEL_1_OFFICIAL',
    url: 'https://urdu.fbr.gov.pk/propertyValuation/17636',
    covers: 'Notified valuation rates for immovable property by sector, used for tax purposes.',
    caveats:
      'IMPORTANT: this is property valuation, not construction cost. The two are stored as ' +
      'separate datasets and must never be summed or substituted for one another. Listed here so ' +
      'the distinction is explicit rather than assumed.',
    cadence: 'annual',
    region: 'Islamabad',
    connector: 'manual_only',
  },
  {
    id: 'src_fbr_customs_tariff' as SourceId,
    name: 'FBR — Customs Tariff and Schedules',
    tier: 'LEVEL_1_OFFICIAL',
    url: 'https://www.fbr.gov.pk/',
    covers:
      'Customs duty, additional customs duty, regulatory duty, sales tax and withholding rates by ' +
      'PCT/HS code. The authoritative input to any landed-cost calculation.',
    caveats:
      'Rates are PCT-code specific and change with each Finance Act and with SROs issued in ' +
      'between. A landed cost computed from a remembered rate is worthless — the code and the ' +
      'schedule date must be recorded with the figure.',
    cadence: 'annual',
    region: 'Pakistan',
    connector: 'manual_only',
  },
  {
    id: 'src_zameen_cost_calculator' as SourceId,
    name: 'Zameen — Construction Cost Calculator',
    tier: 'LEVEL_2_MARKET',
    url: 'https://www.zameen.com/tools/construction-cost-calculator/',
    covers: 'Per-square-foot grey-structure and finishing benchmarks for major Pakistani cities.',
    caveats:
      'A benchmark, explicitly not an authoritative rate. Its methodology and update date are not ' +
      'published. Use to sanity-check a total, never as the source for a line item.',
    cadence: 'irregular',
    region: 'Pakistan (city level)',
    connector: 'planned',
  },
  {
    id: 'src_brick_pakistan' as SourceId,
    name: 'Brick Pakistan — Islamabad construction material rates',
    tier: 'LEVEL_2_MARKET',
    url: 'https://www.brickpakistan.com/materials/islamabad',
    covers: 'Market rates for cement, steel, bricks, sand, crush and finishing materials by city.',
    caveats:
      'Retail market listing. Brand and grade are not always stated, and a rate without a stated ' +
      'grade cannot be compared against a quotation that states one.',
    cadence: 'irregular',
    region: 'Islamabad / Rawalpindi',
    connector: 'planned',
  },
  {
    id: 'src_supplier_quotation' as SourceId,
    name: 'Supplier quotation (uploaded)',
    tier: 'LEVEL_3_SUPPLIER_QUOTE',
    url: '',
    covers: 'A quotation from a named supplier for a stated quantity, specification and validity period.',
    caveats:
      'Highest standing for this project, but only within its validity window and stated quantity. ' +
      'A quote for 500 sq ft does not price 5,000 sq ft.',
    cadence: 'on_request',
    region: 'As quoted',
    connector: 'implemented',
  },
  {
    id: 'src_manual_entry' as SourceId,
    name: 'Manual entry by user',
    tier: 'LEVEL_4_ESTIMATE',
    url: '',
    covers: 'A figure the user typed in, with whatever justification they recorded.',
    caveats:
      'Treated as an estimate unless the user attaches a quotation. Always shown as low confidence ' +
      'so it is never mistaken for a researched figure.',
    cadence: 'on_request',
    region: 'As entered',
    connector: 'implemented',
  },
];

export const CHINA_SOURCES: readonly PriceSource[] = [
  {
    id: 'src_alibaba' as SourceId,
    name: 'Alibaba — building materials',
    tier: 'LEVEL_2_MARKET',
    url: 'https://www.alibaba.com/showroom/building-materials.html',
    covers: 'Factory and trading-company listings with MOQ, specification and supplier metadata.',
    caveats:
      'Listed prices are ex-works indications, frequently a range, and frequently conditional on ' +
      'MOQ. A listing price is NOT a Pakistan cost — it must go through the landed-cost model ' +
      'before it can be compared with a local rate.',
    cadence: 'irregular',
    region: 'China (export)',
    connector: 'planned',
  },
];

export function allKnownSources(): readonly PriceSource[] {
  return [...PAKISTAN_SOURCES, ...CHINA_SOURCES];
}

export function findSource(id: SourceId): PriceSource | undefined {
  return allKnownSources().find((s) => s.id === id);
}
