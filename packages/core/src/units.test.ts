import { describe, expect, it } from 'vitest';
import { formatLength, fromMm, parseLength, toMm } from './units.js';

describe('units', () => {
  it('converts feet to millimetres exactly', () => {
    // The whole dimensional-fidelity promise rests on this being exact.
    expect(toMm(15, 'ft')).toBe(4572);
    expect(toMm(20, 'ft')).toBe(6096);
    expect(toMm(1, 'in')).toBe(25.4);
  });

  it('round-trips a typed dimension without drift', () => {
    for (const ft of [8, 10, 12, 15, 20, 33.5, 100]) {
      expect(fromMm(toMm(ft, 'ft'), 'ft')).toBeCloseTo(ft, 10);
    }
  });

  it('parses the dimension formats a user actually types', () => {
    expect(parseLength('15')).toBe(4572); // default feet
    expect(parseLength('15ft')).toBe(4572);
    expect(parseLength("15'")).toBe(4572);
    expect(parseLength('4572mm')).toBe(4572);
    expect(parseLength('4.572m')).toBeCloseTo(4572, 6);
    expect(parseLength('12in')).toBe(304.8);
  });

  it('parses feet-and-inches', () => {
    expect(parseLength("15' 6\"")).toBeCloseTo(4572 + 152.4, 6);
    expect(parseLength("15'6\"")).toBeCloseTo(4724.4, 6);
  });

  it('returns null rather than guessing at unreadable input', () => {
    // Guessing here would silently corrupt the twin and every derived quantity.
    expect(parseLength('abc')).toBeNull();
    expect(parseLength('')).toBeNull();
    expect(parseLength('15 x 20')).toBeNull();
    expect(parseLength('15 furlongs')).toBeNull();
  });

  it('formats feet and inches to the nearest eighth', () => {
    expect(formatLength(4572, 'ft', { imperialInches: true })).toBe("15' 0\"");
    expect(formatLength(4724.4, 'ft', { imperialInches: true })).toBe("15' 6\"");
  });
});
