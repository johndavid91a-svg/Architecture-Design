/**
 * Unit system.
 *
 * Non-negotiable requirement #1 is that real architectural dimensions survive
 * every operation. That is a storage problem before it is a UI problem, so the
 * whole system keeps exactly one canonical internal unit and converts only at
 * the edges.
 *
 * Canonical length unit: MILLIMETRE.
 *
 * Millimetres are chosen over feet or metres because every dimension the
 * platform ingests — imperial drawings, metric drawings, IFC (metres), DXF
 * (unitless with a header hint) — lands on a whole or near-whole number of
 * millimetres. 15 ft is exactly 4572 mm. Storing that as 15.0 ft and later
 * converting through metres is what produces the classic "14.999999999998 ft"
 * that makes a quantity takeoff look untrustworthy.
 */

/** A length in millimetres. The canonical internal representation. */
export type Millimetres = number;
/** An area in square millimetres. */
export type SquareMillimetres = number;
/** A volume in cubic millimetres. */
export type CubicMillimetres = number;

export type LengthUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';
export type AreaUnit = 'mm2' | 'm2' | 'ft2';
export type VolumeUnit = 'mm3' | 'm3' | 'ft3';

/**
 * Exact conversion factors to millimetres.
 *
 * The imperial factors are exact by definition of the international inch
 * (25.4 mm exactly, per the 1959 agreement), not approximations.
 */
const MM_PER: Record<LengthUnit, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  ft: 304.8,
};

/**
 * Quantise a canonical value to the nearest nanometre.
 *
 * `12 * 25.4` evaluates to 304.79999999999995 in IEEE-754, and that noise would
 * otherwise reach the geometry fingerprint, the takeoff derivations and the
 * dimension strings the user reads back. A nanometre is fourteen orders of
 * magnitude below any construction tolerance, so rounding there destroys the
 * artefact without touching the measurement.
 */
function quantise(mm: number): Millimetres {
  return Math.round(mm * 1e6) / 1e6;
}

/** Convert a length in `unit` into canonical millimetres. */
export function toMm(value: number, unit: LengthUnit): Millimetres {
  return quantise(value * MM_PER[unit]);
}

/** Convert canonical millimetres into `unit`. */
export function fromMm(mm: Millimetres, unit: LengthUnit): number {
  return mm / MM_PER[unit];
}

const MM2_PER: Record<AreaUnit, number> = {
  mm2: 1,
  m2: 1_000_000,
  ft2: 304.8 * 304.8, // 92_903.04 exactly
};

export function toMm2(value: number, unit: AreaUnit): SquareMillimetres {
  return value * MM2_PER[unit];
}

export function fromMm2(mm2: SquareMillimetres, unit: AreaUnit): number {
  return mm2 / MM2_PER[unit];
}

const MM3_PER: Record<VolumeUnit, number> = {
  mm3: 1,
  m3: 1_000_000_000,
  ft3: 304.8 ** 3,
};

export function toMm3(value: number, unit: VolumeUnit): CubicMillimetres {
  return value * MM3_PER[unit];
}

export function fromMm3(mm3: CubicMillimetres, unit: VolumeUnit): number {
  return mm3 / MM3_PER[unit];
}

/**
 * Parse a dimension the way a person types it on a Pakistani or US drawing.
 *
 * Accepts, case-insensitively:
 *   `15`            → assumes `defaultUnit`
 *   `15ft` `15'`    → feet
 *   `15' 6"`        → feet and inches
 *   `4572mm` `4.5m` `450cm`
 *   `15 x 20`       → rejected here; callers split on `x` first
 *
 * Returns `null` rather than guessing when the input cannot be read. A silent
 * wrong guess about a dimension corrupts the twin and every quantity derived
 * from it, so ambiguity must surface to the user as a verification prompt.
 */
export function parseLength(input: string, defaultUnit: LengthUnit = 'ft'): Millimetres | null {
  const raw = input.trim().toLowerCase();
  if (raw === '') return null;

  // Feet-and-inches: 15' 6", 15'6", 15 ft 6 in
  const feetInches = raw.match(/^(-?\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*(\d+(?:\.\d+)?)\s*(?:"|in|inch(?:es)?)?$/);
  if (feetInches) {
    const ft = Number(feetInches[1]);
    const inch = Number(feetInches[2]);
    if (!Number.isFinite(ft) || !Number.isFinite(inch)) return null;
    const sign = ft < 0 ? -1 : 1;
    return quantise(sign * (Math.abs(ft) * MM_PER.ft + inch * MM_PER.in));
  }

  const single = raw.match(/^(-?\d+(?:\.\d+)?)\s*(mm|cm|m|in|ft|'|"|feet|inch(?:es)?|metre?s?|meters?)?$/);
  if (!single) return null;
  const value = Number(single[1]);
  if (!Number.isFinite(value)) return null;

  const suffix = single[2];
  if (suffix === undefined) return toMm(value, defaultUnit);

  switch (suffix) {
    case 'mm':
      return toMm(value, 'mm');
    case 'cm':
      return toMm(value, 'cm');
    case 'm':
    case 'metre':
    case 'metres':
    case 'meter':
    case 'meters':
      return toMm(value, 'm');
    case 'in':
    case 'inch':
    case 'inches':
    case '"':
      return toMm(value, 'in');
    case 'ft':
    case 'feet':
    case "'":
      return toMm(value, 'ft');
    default:
      return null;
  }
}

/**
 * Format a length for display. Feet-and-inches formatting rounds to the nearest
 * eighth of an inch, which is the practical tolerance on site; anything finer
 * implies a precision the drawing does not have.
 */
export function formatLength(mm: Millimetres, unit: LengthUnit, opts: { imperialInches?: boolean } = {}): string {
  if (unit === 'ft' && opts.imperialInches) {
    const totalInches = mm / MM_PER.in;
    const sign = totalInches < 0 ? '-' : '';
    const abs = Math.abs(totalInches);
    const eighths = Math.round(abs * 8);
    const feet = Math.floor(eighths / 96);
    const remEighths = eighths - feet * 96;
    const inches = Math.floor(remEighths / 8);
    const frac = remEighths - inches * 8;
    // Reduce the fraction to lowest terms. A drawing that says 11 2/8" instead
    // of 11 1/4" reads as machine output rather than a dimension, and on a
    // dimension string that is exactly the wrong impression to give.
    let numerator = frac;
    let denominator = 8;
    while (numerator !== 0 && numerator % 2 === 0) {
      numerator /= 2;
      denominator /= 2;
    }
    const fracStr = frac === 0 ? '' : ` ${numerator}/${denominator}`;
    return `${sign}${feet}' ${inches}${fracStr}"`;
  }
  const v = fromMm(mm, unit);
  const decimals = unit === 'mm' ? 0 : unit === 'cm' ? 1 : 2;
  return `${v.toFixed(decimals)} ${unit}`;
}

/** Round-trip helper used by tests and by drawing import verification. */
export function approxEqual(a: number, b: number, toleranceMm = 0.5): boolean {
  return Math.abs(a - b) <= toleranceMm;
}
