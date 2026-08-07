import { describe, expect, it } from 'vitest';
import { daylightHours, PAKISTAN_LOCATIONS, sunPosition } from './sun.js';

const ISB = PAKISTAN_LOCATIONS['Islamabad']!;

function at(y: number, m: number, d: number, h: number, min = 0): Date {
  const date = new Date(2000, 0, 1);
  date.setFullYear(y, m, d);
  date.setHours(h, min, 0, 0);
  return date;
}

describe('solar position', () => {
  it('puts the sun high at noon on the summer solstice in Islamabad', () => {
    // Islamabad is at 33.68°N; solar noon altitude on 21 June is about
    // 90 - 33.68 + 23.44 ≈ 79.8°.
    const p = sunPosition({ ...ISB, date: at(2026, 5, 21, 12, 0) });
    expect(p.isUp).toBe(true);
    expect(p.altitude).toBeGreaterThan(70);
    expect(p.altitude).toBeLessThan(82);
  });

  it('puts the sun much lower at noon on the winter solstice', () => {
    // About 90 - 33.68 - 23.44 ≈ 32.9°.
    const p = sunPosition({ ...ISB, date: at(2026, 11, 21, 12, 0) });
    expect(p.isUp).toBe(true);
    expect(p.altitude).toBeGreaterThan(27);
    expect(p.altitude).toBeLessThan(38);
  });

  it('reports the sun below the horizon at midnight', () => {
    const p = sunPosition({ ...ISB, date: at(2026, 5, 21, 0, 0) });
    expect(p.isUp).toBe(false);
    expect(p.altitude).toBeLessThan(0);
  });

  it('places the morning sun in the east and the afternoon sun in the west', () => {
    const morning = sunPosition({ ...ISB, date: at(2026, 5, 21, 8, 0) });
    const afternoon = sunPosition({ ...ISB, date: at(2026, 5, 21, 16, 0) });

    // Azimuth is clockwise from north: east is near 90, west near 270.
    expect(morning.azimuth).toBeGreaterThan(45);
    expect(morning.azimuth).toBeLessThan(120);
    expect(afternoon.azimuth).toBeGreaterThan(240);
    expect(afternoon.azimuth).toBeLessThan(315);
  });

  it('returns a unit direction vector pointing up while the sun is up', () => {
    const p = sunPosition({ ...ISB, date: at(2026, 5, 21, 10, 0) });
    const { x, y, z } = p.direction;
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 6);
    expect(z).toBeGreaterThan(0);
    // Mid-morning in the northern hemisphere: sun to the east and south.
    expect(x).toBeGreaterThan(0);
  });

  it('gives a longer day at the summer solstice than at the winter one', () => {
    const summer = daylightHours(ISB.latitude, ISB.longitude, ISB.utcOffsetHours, at(2026, 5, 21, 12));
    const winter = daylightHours(ISB.latitude, ISB.longitude, ISB.utcOffsetHours, at(2026, 11, 21, 12));

    expect(summer.hours).toBeGreaterThan(13.5);
    expect(summer.hours).toBeLessThan(15);
    expect(winter.hours).toBeGreaterThan(9);
    expect(winter.hours).toBeLessThan(10.5);
    expect(summer.hours).toBeGreaterThan(winter.hours);
  });

  it('agrees with sunPosition about when the sun is up', () => {
    // The scan and the position function must not be able to disagree.
    const day = daylightHours(ISB.latitude, ISB.longitude, ISB.utcOffsetHours, at(2026, 2, 21, 12));
    expect(day.sunrise).not.toBeNull();
    expect(day.sunset).not.toBeNull();

    const justAfterSunrise = new Date(day.sunrise!.getTime() + 120_000);
    const justBeforeSunset = new Date(day.sunset!.getTime() - 120_000);

    expect(sunPosition({ ...ISB, date: justAfterSunrise }).isUp).toBe(true);
    expect(sunPosition({ ...ISB, date: justBeforeSunset }).isUp).toBe(true);
  });
});
