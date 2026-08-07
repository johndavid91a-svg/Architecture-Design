/**
 * BILL OF QUANTITIES.
 *
 * Requirement 27 fixes the columns. The one addition made here is that unpriced
 * lines are rendered as rows with an explicit gap notice rather than being
 * dropped — a BOQ that quietly omits what could not be priced misrepresents the
 * project, and the omission is invisible precisely where it matters most.
 */

import type { EstimateResult, EstimateLine } from '../estimate/estimate.js';
import type { Currency } from '../pricing/price.js';

export interface BoqRow {
  readonly item: string;
  readonly description: string;
  readonly unit: string;
  readonly quantity: string;
  readonly materialRate: string;
  readonly labourRate: string;
  readonly materialCost: string;
  readonly labourCost: string;
  readonly transport: string;
  readonly subtotal: string;
  readonly source: string;
  readonly priceDate: string;
  readonly confidence: string;
}

export const BOQ_COLUMNS: readonly (keyof BoqRow)[] = [
  'item',
  'description',
  'unit',
  'quantity',
  'materialRate',
  'labourRate',
  'materialCost',
  'labourCost',
  'transport',
  'subtotal',
  'source',
  'priceDate',
  'confidence',
];

export const BOQ_HEADERS: Readonly<Record<keyof BoqRow, string>> = {
  item: 'Item',
  description: 'Description',
  unit: 'Unit',
  quantity: 'Quantity',
  materialRate: 'Material Rate',
  labourRate: 'Labour Rate',
  materialCost: 'Material Cost',
  labourCost: 'Labour Cost',
  transport: 'Transport',
  subtotal: 'Subtotal',
  source: 'Source',
  priceDate: 'Price Date',
  confidence: 'Confidence',
};

const num = (v: number | undefined, digits = 2): string =>
  v === undefined ? '' : v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

function labourRateSummary(line: EstimateLine): string {
  const priced = line.labourBreakdown.filter((c) => c.rate !== undefined);
  if (priced.length === 0) return line.labourBreakdown.length > 0 ? 'UNPRICED' : '';
  const days = priced.reduce((s, c) => s + c.workerDays, 0);
  const cost = priced.reduce((s, c) => s + (c.cost ?? 0), 0);
  return days > 0 ? `${num(cost / days, 0)}/day avg` : '';
}

export function buildBoq(result: EstimateResult): BoqRow[] {
  return result.lines.map((line, index) => {
    if (line.unpriced) {
      return {
        item: String(index + 1),
        description: line.description,
        unit: line.unit,
        quantity: line.netQuantity > 0 ? num(line.procurementQuantity) : 'TBC',
        materialRate: 'UNPRICED',
        labourRate: line.unpriced.what === 'material' ? labourRateSummary(line) : 'UNPRICED',
        materialCost: '—',
        labourCost: '—',
        transport: '—',
        subtotal: 'EXCLUDED FROM TOTAL',
        source: '—',
        priceDate: '—',
        confidence: `GAP: ${line.unpriced.remedy}`,
      };
    }
    return {
      item: String(index + 1),
      description: line.description,
      unit: line.unit,
      quantity: num(line.procurementQuantity),
      materialRate: num(line.materialRate),
      labourRate: labourRateSummary(line),
      materialCost: num(line.materialCost),
      labourCost: num(line.labourCost),
      transport: num(line.transport),
      subtotal: num(line.subtotal),
      source: line.materialSourceName ?? '',
      priceDate: line.materialPriceDate ?? '',
      confidence: line.materialConfidence ?? '',
    };
  });
}

function csvEscape(value: string): string {
  // A leading =, +, - or @ makes a spreadsheet treat the cell as a formula.
  // BOQ cells carry user- and source-derived text, so they are neutralised.
  const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function boqToCsv(rows: readonly BoqRow[], result: EstimateResult): string {
  const lines: string[] = [];
  lines.push(BOQ_COLUMNS.map((c) => csvEscape(BOQ_HEADERS[c])).join(','));
  for (const row of rows) {
    lines.push(BOQ_COLUMNS.map((c) => csvEscape(row[c])).join(','));
  }

  lines.push('');
  lines.push(csvEscape(`Currency,${result.currency}`));
  lines.push(`${csvEscape('Material cost')},${csvEscape(num(result.materialCost))}`);
  lines.push(`${csvEscape('Labour cost')},${csvEscape(num(result.labourCost))}`);
  lines.push(`${csvEscape('Transport')},${csvEscape(num(result.transportCost))}`);
  lines.push(`${csvEscape('Equipment')},${csvEscape(num(result.equipmentCost))}`);
  lines.push(`${csvEscape('Subtotal')},${csvEscape(num(result.subtotal))}`);
  lines.push(`${csvEscape('Contingency')},${csvEscape(num(result.contingencyAmount))}`);
  lines.push(`${csvEscape('TOTAL')},${csvEscape(num(result.total))}`);
  lines.push('');
  lines.push(
    `${csvEscape('Completeness')},${csvEscape(
      `${result.pricedLineCount} of ${result.lines.length} lines priced (${(result.completeness * 100).toFixed(1)}%)`,
    )}`,
  );
  if (!result.complete) {
    lines.push(
      `${csvEscape('WARNING')},${csvEscape(
        `${result.unpricedLineCount} line(s) unpriced and excluded. The true cost is higher than the total shown.`,
      )}`,
    );
  }
  lines.push('');
  lines.push(csvEscape('Assumptions'));
  for (const a of result.assumptions) lines.push(csvEscape(a));

  return lines.join('\r\n');
}

/** The professional-review notice. Requirement 67. Must appear on every export. */
export const PROFESSIONAL_REVIEW_NOTICE = [
  'This document is a design and estimation aid produced from a digital model. It is not a',
  'certified quantity survey, structural design, MEP design, fire-safety assessment or',
  'regulatory approval, and it does not replace a licensed architect, structural engineer,',
  'MEP engineer or quantity surveyor.',
  '',
  'Quantities are derived from the model geometry and stated assumptions. Prices carry the',
  'source, date and confidence shown against each line; verify them before committing funds.',
  'Any regulatory observation is an indication only and confers no approval.',
].join('\n');

export interface EstimateReportSections {
  readonly currency: Currency;
  readonly totalStatement: string;
  readonly completeness: string;
  readonly assumptions: readonly string[];
  readonly notice: string;
}

export function reportSections(result: EstimateResult, caveat: string): EstimateReportSections {
  return {
    currency: result.currency,
    totalStatement: result.complete
      ? `${num(result.total)} ${result.currency}`
      : `at least ${num(result.total)} ${result.currency}`,
    completeness: caveat,
    assumptions: result.assumptions,
    notice: PROFESSIONAL_REVIEW_NOTICE,
  };
}
