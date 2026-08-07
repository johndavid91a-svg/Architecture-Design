/**
 * Price list and quotation import.
 *
 * The practical way prices actually get into the system: a supplier sends a
 * price list or a quotation, and the user imports it rather than typing thirty
 * rows.
 *
 * The whole module is built around one property — **extraction is a proposal**.
 * Every parsed row comes back as a candidate with whatever problems were found,
 * and nothing becomes a price record until the user confirms it. An OCR or
 * delimiter misread of a decimal point is a 10× error in a figure someone will
 * act on, and it is completely invisible once it is a number in a table.
 */

import type { MaterialId, SourceId } from '../model/ids.js';
import { BASE_MATERIALS } from '../catalogue/materials.js';
import type { Currency, PriceUnit } from './price.js';

export interface ImportedRow {
  /** 1-based row number in the source file, for error reporting. */
  readonly row: number;
  readonly rawDescription: string;
  /** Best-guess material match, or null when nothing matched confidently. */
  readonly materialId: MaterialId | null;
  readonly matchConfidence: number;
  readonly amount: number | null;
  readonly currency: Currency;
  readonly unit: PriceUnit | null;
  readonly specification?: string;
  readonly supplier?: string;
  /** Problems that must be resolved before this row can be accepted. */
  readonly problems: readonly string[];
  /** True when the row is complete enough to become a price record. */
  readonly importable: boolean;
}

export interface ImportResult {
  readonly rows: readonly ImportedRow[];
  readonly importableCount: number;
  readonly problemCount: number;
  readonly headers: readonly string[];
  readonly warnings: readonly string[];
}

const UNIT_ALIASES: Record<string, PriceUnit> = {
  sqft: 'sqft',
  'sq ft': 'sqft',
  'sq.ft': 'sqft',
  sft: 'sqft',
  'square foot': 'sqft',
  'square feet': 'sqft',
  sqm: 'sqm',
  'sq m': 'sqm',
  'm2': 'sqm',
  each: 'each',
  no: 'each',
  nos: 'each',
  unit: 'each',
  pcs: 'each',
  piece: 'each',
  rft: 'rft',
  'r ft': 'rft',
  'running foot': 'rft',
  rm: 'rm',
  cft: 'cft',
  'cu ft': 'cft',
  cum: 'cum',
  'm3': 'cum',
  bag: 'bag_50kg',
  'bag_50kg': 'bag_50kg',
  '50kg bag': 'bag_50kg',
  kg: 'kg',
  tonne: 'tonne',
  ton: 'tonne',
  thousand: 'thousand',
  '1000': 'thousand',
  litre: 'litre',
  liter: 'litre',
  ltr: 'litre',
  day: 'day',
  hour: 'hour',
};

/**
 * Split a CSV line, honouring quotes and doubled quotes.
 *
 * Written out rather than pulled in, because supplier price lists are reliably
 * malformed — trailing commas, unquoted commas inside descriptions, mixed line
 * endings — and a strict parser that throws on the first bad row is useless
 * here. This one degrades: a bad row becomes a row with problems.
 */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Parse a number the way it appears on a South Asian price list.
 *
 * Handles thousands separators, currency prefixes, and the lakh/crore notation
 * that appears on some quotations. Returns null rather than a partial reading:
 * "1,2 50" is not 1250, it is a row that needs a human.
 */
export function parseAmount(raw: string): number | null {
  const withoutCurrency = raw.replace(/(pkr|rs\.?|rupees|usd|\$|cny|¥|€|£)/gi, '').trim();
  if (withoutCurrency === '') return null;

  // Internal whitespace is a red flag, not something to strip. "1,2 50" is not
  // 1250 — it is a cell that needs a human. Removing the space would turn a
  // damaged figure into a confident wrong one.
  if (/\s/.test(withoutCurrency)) return null;

  if (withoutCurrency.includes(',')) {
    // Commas are only acceptable as well-formed thousands separators. "1,2" is
    // not 12, and guessing which it meant is how a decimal point moves.
    if (!/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(withoutCurrency)) return null;
  } else if (!/^\d+(\.\d+)?$/.test(withoutCurrency)) {
    return null;
  }

  const value = Number(withoutCurrency.replace(/,/g, ''));
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function parseUnit(raw: string): PriceUnit | null {
  const key = raw.toLowerCase().replace(/^per\s+/, '').replace(/\.$/, '').trim();
  return UNIT_ALIASES[key] ?? null;
}

/**
 * Match a free-text description to a catalogue material.
 *
 * Token overlap scoring, deliberately conservative: a weak match returns null
 * so the row lands in front of the user rather than being silently attached to
 * the wrong material. Pricing "marble" as "carpet tile" because both contain
 * the letter sequence is the failure mode being avoided.
 */
export function matchMaterial(description: string): { materialId: MaterialId | null; confidence: number } {
  const text = description.toLowerCase();
  const words = new Set(text.split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  if (words.size === 0) return { materialId: null, confidence: 0 };

  let best: { id: MaterialId; score: number } | null = null;

  for (const material of BASE_MATERIALS) {
    const nameWords = material.name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    if (nameWords.length === 0) continue;

    let hits = 0;
    for (const word of nameWords) {
      if (words.has(word) || text.includes(word)) hits++;
    }
    const score = hits / nameWords.length;
    if (score > 0 && (best === null || score > best.score)) {
      best = { id: material.id, score };
    }
  }

  // Below two-thirds of the material's own name words, treat it as no match.
  if (!best || best.score < 0.66) return { materialId: null, confidence: best?.score ?? 0 };
  return { materialId: best.id, confidence: best.score };
}

export interface ColumnMapping {
  readonly description: number;
  readonly amount: number;
  readonly unit?: number;
  readonly specification?: number;
  readonly supplier?: number;
}

/** Guess which column is which from the header row. */
export function inferColumns(headers: readonly string[]): ColumnMapping | null {
  const find = (patterns: RegExp[]) =>
    headers.findIndex((h) => patterns.some((p) => p.test(h.toLowerCase())));

  const description = find([/desc/, /item/, /material/, /product/, /particular/]);
  const amount = find([/rate/, /price/, /amount/, /cost/]);
  if (description < 0 || amount < 0) return null;

  const unit = find([/^unit$/, /\bunit\b/, /uom/, /per/]);
  const specification = find([/spec/, /brand/, /grade/, /make/]);
  const supplier = find([/supplier/, /vendor/, /company/]);

  return {
    description,
    amount,
    unit: unit >= 0 ? unit : undefined,
    specification: specification >= 0 ? specification : undefined,
    supplier: supplier >= 0 ? supplier : undefined,
  };
}

export function importPriceCsv(
  text: string,
  options: { currency?: Currency; defaultSupplier?: string; mapping?: ColumnMapping } = {},
): ImportResult {
  const warnings: string[] = [];
  const lines = text
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));

  if (lines.length === 0) {
    return { rows: [], importableCount: 0, problemCount: 0, headers: [], warnings: ['The file is empty.'] };
  }

  const headers = splitCsvLine(lines[0]!);
  const mapping = options.mapping ?? inferColumns(headers);

  if (!mapping) {
    return {
      rows: [],
      importableCount: 0,
      problemCount: 0,
      headers,
      warnings: [
        'Could not identify a description column and a rate column from the header row. ' +
          `Headers found: ${headers.join(', ')}. Map the columns manually.`,
      ],
    };
  }

  const currency = options.currency ?? 'PKR';
  const rows: ImportedRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = splitCsvLine(lines[i]!);
    const problems: string[] = [];

    const rawDescription = fields[mapping.description] ?? '';
    if (rawDescription === '') problems.push('No description.');

    const amount = parseAmount(fields[mapping.amount] ?? '');
    if (amount === null) {
      problems.push(`Could not read a rate from "${fields[mapping.amount] ?? ''}".`);
    }

    const unitRaw = mapping.unit !== undefined ? (fields[mapping.unit] ?? '') : '';
    const unit = unitRaw ? parseUnit(unitRaw) : null;
    if (unitRaw && unit === null) {
      problems.push(`Unrecognised unit "${unitRaw}".`);
    } else if (!unitRaw) {
      problems.push('No unit column — set the unit before importing.');
    }

    const match = matchMaterial(rawDescription);
    if (match.materialId === null) {
      problems.push('No confident material match. Choose one manually.');
    }

    rows.push({
      row: i + 1,
      rawDescription,
      materialId: match.materialId,
      matchConfidence: match.confidence,
      amount,
      currency,
      unit,
      specification: mapping.specification !== undefined ? fields[mapping.specification] : undefined,
      supplier:
        (mapping.supplier !== undefined ? fields[mapping.supplier] : undefined) ||
        options.defaultSupplier,
      problems,
      importable: problems.length === 0,
    });
  }

  const importableCount = rows.filter((r) => r.importable).length;
  if (importableCount < rows.length) {
    warnings.push(
      `${rows.length - importableCount} of ${rows.length} rows need attention before they can be imported. ` +
        `Nothing is imported until you confirm it.`,
    );
  }

  return {
    rows,
    importableCount,
    problemCount: rows.length - importableCount,
    headers,
    warnings,
  };
}

/** A template the user can hand to a supplier, so the next list imports cleanly. */
export function priceListTemplate(): string {
  return [
    'Description,Brand/Grade,Unit,Rate,Supplier',
    'Porcelain floor tile 600x600,Example Brand A,sqft,,',
    'Marble slab flooring,Example Brand B,sqft,,',
    'Ordinary Portland cement,Example Brand C,bag,,',
    'Deformed steel bar Grade 60,Example Brand D,kg,,',
    '',
    '# Fill in the Rate column. Leave a row blank to skip it.',
    '# Units accepted: sqft, sqm, each, rft, cft, cum, bag, kg, tonne, thousand, litre.',
  ].join('\r\n');
}

export const QUOTATION_SOURCE_ID = 'src_supplier_quotation' as SourceId;
