/**
 * IMPORT LANDED COST.
 *
 * Requirement 34: "Never present a factory price as the final Pakistan cost."
 *
 * The model is a strict cascade, because Pakistani import taxation compounds:
 * sales tax is charged on a value that already includes customs duty, and
 * income tax is charged on a value that already includes sales tax. Applying
 * them all to the CIF value — the intuitive but wrong approach — understates
 * the landed cost by a wide margin on high-duty goods.
 *
 * Cascade:
 *
 *   FOB           factory/ex-works price x quantity
 *   + freight     international freight
 *   + insurance
 *   = CIF         the assessable value customs works from
 *   + CD          customs duty            on CIF
 *   + ACD         additional customs duty on CIF
 *   + RD          regulatory duty         on CIF
 *   = DUTY-PAID VALUE
 *   + ST          sales tax               on duty-paid value
 *   + VAT         value-added/minimum ST  on duty-paid value
 *   = TAX-PAID VALUE
 *   + WHT         withholding income tax  on tax-paid value
 *   + port, clearing agent, inland freight, warehousing, installation
 *   = LANDED COST
 *
 * Every rate is an input, never a constant. Duty rates are PCT-code specific and
 * change with each Finance Act and with SROs issued between them; a rate baked
 * into this file would be wrong within months and wrong invisibly. The type
 * forces the caller to supply the rates together with the schedule they came
 * from and the date they were read.
 */

import type { Currency, ExchangeRate } from '../pricing/price.js';
import { convert } from '../pricing/price.js';

/**
 * Duty and tax rates for one PCT/HS code, as read from a specific schedule on a
 * specific date. All rates are fractions (0.20 = 20%).
 */
export interface DutySchedule {
  /** Pakistan Customs Tariff code the rates were read against. */
  readonly pctCode: string;
  readonly description: string;
  readonly customsDuty: number;
  readonly additionalCustomsDuty: number;
  readonly regulatoryDuty: number;
  readonly salesTax: number;
  /** Value-addition sales tax on commercial imports, where applicable. */
  readonly valueAdditionTax: number;
  /** Advance income tax under s.148. Filer and non-filer rates differ sharply. */
  readonly withholdingTax: number;
  /** Which schedule/SRO and edition these came from. */
  readonly sourceName: string;
  readonly sourceUrl: string;
  readonly readAt: string;
  /** True when the user could not verify a rate and accepted a provisional figure. */
  readonly provisional: boolean;
}

export interface FreightAndHandling {
  /** International freight for the shipment, in `currency`. */
  readonly internationalFreight: number;
  readonly insurance: number;
  readonly portCharges: number;
  readonly clearingAgentFee: number;
  readonly inlandFreight: number;
  readonly warehousing: number;
  readonly installation: number;
  readonly currency: Currency;
  readonly note?: string;
}

export interface ImportInput {
  readonly description: string;
  /** Ex-works unit price in the supplier's currency. */
  readonly unitPrice: number;
  readonly quantity: number;
  readonly currency: Currency;
  readonly minimumOrderQuantity?: number;
  readonly duty: DutySchedule;
  readonly handling: FreightAndHandling;
  readonly targetCurrency: Currency;
  readonly rates: readonly ExchangeRate[];
}

export interface LandedCostBreakdown {
  readonly currency: Currency;
  readonly fob: number;
  readonly internationalFreight: number;
  readonly insurance: number;
  readonly cif: number;
  readonly customsDuty: number;
  readonly additionalCustomsDuty: number;
  readonly regulatoryDuty: number;
  readonly dutyPaidValue: number;
  readonly salesTax: number;
  readonly valueAdditionTax: number;
  readonly taxPaidValue: number;
  readonly withholdingTax: number;
  readonly portCharges: number;
  readonly clearingAgentFee: number;
  readonly inlandFreight: number;
  readonly warehousing: number;
  readonly installation: number;
  readonly landedTotal: number;
  readonly landedUnitCost: number;
  /** Units actually bought once MOQ is applied. May exceed what the project needs. */
  readonly billedQuantity: number;
  /** Cost of units bought beyond requirement because of MOQ. */
  readonly moqOverhang: number;
  readonly provisional: boolean;
  readonly warnings: readonly string[];
  readonly exchangeRatesUsed: readonly ExchangeRate[];
}

export type LandedCostOutcome =
  | { readonly ok: true; readonly breakdown: LandedCostBreakdown }
  | { readonly ok: false; readonly reason: 'no_exchange_rate'; readonly detail: string };

export function computeLandedCost(input: ImportInput): LandedCostOutcome {
  const warnings: string[] = [];
  const ratesUsed: ExchangeRate[] = [];

  const toTarget = (amount: number, from: Currency): number | null => {
    const r = convert(amount, from, input.targetCurrency, input.rates);
    if (!r.ok) return null;
    if (r.rate.sourceName !== 'identity' && !ratesUsed.some((x) => x.from === r.rate.from && x.to === r.rate.to)) {
      ratesUsed.push(r.rate);
    }
    return r.amount;
  };

  // MOQ: you buy what the factory will sell, not what the drawing needs.
  const billedQuantity =
    input.minimumOrderQuantity && input.quantity < input.minimumOrderQuantity
      ? input.minimumOrderQuantity
      : input.quantity;
  if (billedQuantity > input.quantity) {
    warnings.push(
      `Minimum order quantity of ${input.minimumOrderQuantity} exceeds the required ` +
        `${input.quantity}. Cost is calculated on ${billedQuantity} units; the surplus is carried ` +
        `as MOQ overhang.`,
    );
  }

  const fobSupplier = input.unitPrice * billedQuantity;
  const fob = toTarget(fobSupplier, input.currency);
  if (fob === null) {
    return {
      ok: false,
      reason: 'no_exchange_rate',
      detail: `No dated exchange rate on file for ${input.currency} to ${input.targetCurrency}.`,
    };
  }

  const freight = toTarget(input.handling.internationalFreight, input.handling.currency);
  const insurance = toTarget(input.handling.insurance, input.handling.currency);
  const port = toTarget(input.handling.portCharges, input.handling.currency);
  const clearing = toTarget(input.handling.clearingAgentFee, input.handling.currency);
  const inland = toTarget(input.handling.inlandFreight, input.handling.currency);
  const warehousing = toTarget(input.handling.warehousing, input.handling.currency);
  const installation = toTarget(input.handling.installation, input.handling.currency);

  if (
    freight === null ||
    insurance === null ||
    port === null ||
    clearing === null ||
    inland === null ||
    warehousing === null ||
    installation === null
  ) {
    return {
      ok: false,
      reason: 'no_exchange_rate',
      detail: `No dated exchange rate on file for ${input.handling.currency} to ${input.targetCurrency}.`,
    };
  }

  const cif = fob + freight + insurance;

  const customsDuty = cif * input.duty.customsDuty;
  const additionalCustomsDuty = cif * input.duty.additionalCustomsDuty;
  const regulatoryDuty = cif * input.duty.regulatoryDuty;
  const dutyPaidValue = cif + customsDuty + additionalCustomsDuty + regulatoryDuty;

  const salesTax = dutyPaidValue * input.duty.salesTax;
  const valueAdditionTax = dutyPaidValue * input.duty.valueAdditionTax;
  const taxPaidValue = dutyPaidValue + salesTax + valueAdditionTax;

  const withholdingTax = taxPaidValue * input.duty.withholdingTax;

  const landedTotal =
    taxPaidValue + withholdingTax + port + clearing + inland + warehousing + installation;

  if (input.duty.provisional) {
    warnings.push(
      'PROVISIONAL: one or more duty or tax rates could not be verified against the current ' +
        'schedule. Confirm the PCT code and rates with a clearing agent before committing.',
    );
  }

  const readAge = daysSince(input.duty.readAt);
  if (readAge !== null && readAge > 120) {
    warnings.push(
      `The duty schedule was read ${Math.round(readAge)} days ago. Rates change with each Finance ` +
        `Act and with SROs issued in between; re-check before relying on this figure.`,
    );
  }

  const landedUnitCost = billedQuantity > 0 ? landedTotal / billedQuantity : 0;
  const moqOverhang = (billedQuantity - input.quantity) * landedUnitCost;

  return {
    ok: true,
    breakdown: {
      currency: input.targetCurrency,
      fob,
      internationalFreight: freight,
      insurance,
      cif,
      customsDuty,
      additionalCustomsDuty,
      regulatoryDuty,
      dutyPaidValue,
      salesTax,
      valueAdditionTax,
      taxPaidValue,
      withholdingTax,
      portCharges: port,
      clearingAgentFee: clearing,
      inlandFreight: inland,
      warehousing,
      installation,
      landedTotal,
      landedUnitCost,
      billedQuantity,
      moqOverhang,
      provisional: input.duty.provisional,
      warnings,
      exchangeRatesUsed: ratesUsed,
    },
  };
}

function daysSince(iso: string): number | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 86_400_000;
}

/**
 * Local versus imported comparison.
 *
 * Requirement 33: "Do not assume China is automatically cheaper." The verdict is
 * computed, and when local wins the result says so in as many words rather than
 * quietly presenting the import option anyway.
 */
export interface SourcingComparison {
  readonly description: string;
  readonly localTotal: number | null;
  readonly importedTotal: number | null;
  readonly currency: Currency;
  readonly verdict: 'local_cheaper' | 'imported_cheaper' | 'comparable' | 'insufficient_data';
  readonly differenceAmount: number | null;
  readonly differenceFraction: number | null;
  readonly statement: string;
  readonly nonPriceFactors: readonly string[];
}

export function compareSourcing(params: {
  description: string;
  localTotal: number | null;
  importedTotal: number | null;
  currency: Currency;
  importLeadTimeDays?: number;
  localLeadTimeDays?: number;
  importProvisional?: boolean;
  /** Fractional band within which the two are treated as equivalent. */
  comparableBand?: number;
}): SourcingComparison {
  const band = params.comparableBand ?? 0.05;
  const nonPriceFactors: string[] = [];

  if (params.importLeadTimeDays !== undefined) {
    nonPriceFactors.push(
      `Imported lead time about ${params.importLeadTimeDays} days` +
        (params.localLeadTimeDays !== undefined
          ? ` against about ${params.localLeadTimeDays} days locally.`
          : '.'),
    );
  }
  if (params.importProvisional) {
    nonPriceFactors.push(
      'The imported figure rests on provisional duty rates and could move once the PCT code is confirmed.',
    );
  }
  nonPriceFactors.push(
    'Imported material carries replacement risk: a damaged or short-shipped batch cannot be topped up locally.',
  );

  if (params.localTotal === null || params.importedTotal === null) {
    return {
      description: params.description,
      localTotal: params.localTotal,
      importedTotal: params.importedTotal,
      currency: params.currency,
      verdict: 'insufficient_data',
      differenceAmount: null,
      differenceFraction: null,
      statement:
        params.localTotal === null && params.importedTotal === null
          ? 'Neither option is priced. No comparison is possible.'
          : params.localTotal === null
            ? 'No local price on file. Enter a local quotation before comparing.'
            : 'No imported landed cost on file. Complete the landed-cost inputs before comparing.',
      nonPriceFactors,
    };
  }

  const diff = params.localTotal - params.importedTotal;
  const base = Math.max(params.localTotal, params.importedTotal);
  const frac = base === 0 ? 0 : Math.abs(diff) / base;

  if (frac <= band) {
    return {
      description: params.description,
      localTotal: params.localTotal,
      importedTotal: params.importedTotal,
      currency: params.currency,
      verdict: 'comparable',
      differenceAmount: diff,
      differenceFraction: frac,
      statement:
        `Landed costs are within ${(band * 100).toFixed(0)}% of each other. On price alone there is ` +
        `no case for importing; decide on lead time, quality and replacement risk.`,
      nonPriceFactors,
    };
  }

  if (diff > 0) {
    return {
      description: params.description,
      localTotal: params.localTotal,
      importedTotal: params.importedTotal,
      currency: params.currency,
      verdict: 'imported_cheaper',
      differenceAmount: diff,
      differenceFraction: frac,
      statement: `Importing saves ${diff.toFixed(0)} ${params.currency} (${(frac * 100).toFixed(1)}%) after all duties, taxes and handling.`,
      nonPriceFactors,
    };
  }

  return {
    description: params.description,
    localTotal: params.localTotal,
    importedTotal: params.importedTotal,
    currency: params.currency,
    verdict: 'local_cheaper',
    differenceAmount: diff,
    differenceFraction: frac,
    statement:
      `Local sourcing is cheaper by ${Math.abs(diff).toFixed(0)} ${params.currency} ` +
      `(${(frac * 100).toFixed(1)}%) once freight, duty, tax and clearing are included.`,
    nonPriceFactors,
  };
}
