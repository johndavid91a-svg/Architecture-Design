/**
 * Solar position.
 *
 * Requirement 23: "Show sunlight at 10 AM on June 21."
 *
 * Implements the NOAA solar position algorithm, which is accurate to well under
 * a degree for any date within a few centuries of now — far beyond what a
 * shadow study needs, and cheap enough to run every frame if the user drags a
 * time slider.
 *
 * Written out rather than pulled from a library because it is roughly eighty
 * lines of arithmetic with no edge cases, and because a wrong sun position is
 * the kind of error that looks plausible: shadows fall somewhere, just not
 * where they would on site.
 *
 * All angles are degrees at the interface and radians internally.
 */

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export interface SunPosition {
  /** Degrees above the horizon. Negative means the sun is down. */
  readonly altitude: number;
  /** Degrees clockwise from true north. */
  readonly azimuth: number;
  /** False when the sun is below the horizon; callers should stop shading. */
  readonly isUp: boolean;
  /** Unit vector in the plan coordinate frame: +X east, +Y north, +Z up. */
  readonly direction: { readonly x: number; readonly y: number; readonly z: number };
}

export interface SunQuery {
  readonly latitude: number;
  readonly longitude: number;
  /** Local date and time as entered by the user. */
  readonly date: Date;
  /** Offset from UTC in hours, e.g. +5 for Pakistan Standard Time. */
  readonly utcOffsetHours: number;
}

/** Julian day from a UTC date. */
function julianDay(utc: Date): number {
  return utc.getTime() / 86_400_000 + 2440587.5;
}

export function sunPosition(query: SunQuery): SunPosition {
  // Interpret the entered wall-clock time in the stated offset.
  const utcMillis = query.date.getTime() - query.utcOffsetHours * 3_600_000;
  const jd = julianDay(new Date(utcMillis));

  // Julian centuries since J2000.0
  const t = (jd - 2451545) / 36525;

  const meanLongitude = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const meanAnomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);

  const centre =
    Math.sin(rad(meanAnomaly)) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(rad(2 * meanAnomaly)) * (0.019993 - 0.000101 * t) +
    Math.sin(rad(3 * meanAnomaly)) * 0.000289;

  const trueLongitude = meanLongitude + centre;
  const omega = 125.04 - 1934.136 * t;
  const apparentLongitude = trueLongitude - 0.00569 - 0.00478 * Math.sin(rad(omega));

  const meanObliquity =
    23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * Math.cos(rad(omega));

  const declination = deg(
    Math.asin(Math.sin(rad(obliquity)) * Math.sin(rad(apparentLongitude))),
  );

  // Equation of time, in minutes.
  const y = Math.tan(rad(obliquity / 2)) ** 2;
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const equationOfTime =
    4 *
    deg(
      y * Math.sin(2 * rad(meanLongitude)) -
        2 * eccentricity * Math.sin(rad(meanAnomaly)) +
        4 * eccentricity * y * Math.sin(rad(meanAnomaly)) * Math.cos(2 * rad(meanLongitude)) -
        0.5 * y * y * Math.sin(4 * rad(meanLongitude)) -
        1.25 * eccentricity * eccentricity * Math.sin(2 * rad(meanAnomaly)),
    );

  const localMinutes =
    query.date.getHours() * 60 + query.date.getMinutes() + query.date.getSeconds() / 60;
  const trueSolarTime =
    (localMinutes + equationOfTime + 4 * query.longitude - 60 * query.utcOffsetHours + 1440) % 1440;

  const hourAngle = trueSolarTime / 4 < 0 ? trueSolarTime / 4 + 180 : trueSolarTime / 4 - 180;

  const zenith = deg(
    Math.acos(
      Math.sin(rad(query.latitude)) * Math.sin(rad(declination)) +
        Math.cos(rad(query.latitude)) * Math.cos(rad(declination)) * Math.cos(rad(hourAngle)),
    ),
  );

  const altitude = 90 - zenith;

  // Azimuth from the zenith and declination, resolved into 0–360 from north.
  let azimuth: number;
  const denominator = Math.cos(rad(query.latitude)) * Math.sin(rad(zenith));
  if (Math.abs(denominator) > 1e-9) {
    let value =
      (Math.sin(rad(query.latitude)) * Math.cos(rad(zenith)) - Math.sin(rad(declination))) /
      denominator;
    value = Math.max(-1, Math.min(1, value));
    azimuth = deg(Math.acos(value));
    azimuth = hourAngle > 0 ? (azimuth + 180) % 360 : (540 - azimuth) % 360;
  } else {
    azimuth = query.latitude > 0 ? 180 : 0;
  }

  // Plan frame: +X east, +Y north. Azimuth is clockwise from north.
  const altRad = rad(altitude);
  const aziRad = rad(azimuth);
  const horizontal = Math.cos(altRad);

  return {
    altitude,
    azimuth,
    isUp: altitude > 0,
    direction: {
      x: horizontal * Math.sin(aziRad),
      y: horizontal * Math.cos(aziRad),
      z: Math.sin(altRad),
    },
  };
}

/** Islamabad and Rawalpindi share a location closely enough for shadow studies. */
export const PAKISTAN_LOCATIONS: Record<string, { latitude: number; longitude: number; utcOffsetHours: number }> = {
  Islamabad: { latitude: 33.6844, longitude: 73.0479, utcOffsetHours: 5 },
  Rawalpindi: { latitude: 33.5651, longitude: 73.0169, utcOffsetHours: 5 },
  Lahore: { latitude: 31.5204, longitude: 74.3587, utcOffsetHours: 5 },
  Karachi: { latitude: 24.8607, longitude: 67.0011, utcOffsetHours: 5 },
  Peshawar: { latitude: 34.0151, longitude: 71.5249, utcOffsetHours: 5 },
  Quetta: { latitude: 30.1798, longitude: 66.975, utcOffsetHours: 5 },
};

/** Dates worth checking a design against. */
export const KEY_DATES: ReadonlyArray<{ label: string; month: number; day: number }> = [
  { label: 'Summer solstice (21 June)', month: 5, day: 21 },
  { label: 'Winter solstice (21 December)', month: 11, day: 21 },
  { label: 'Spring equinox (21 March)', month: 2, day: 21 },
  { label: 'Autumn equinox (21 September)', month: 8, day: 21 },
];

/**
 * Sunrise and sunset, by scanning at one-minute resolution.
 *
 * A closed-form solution exists and is more elegant. Scanning is used because it
 * cannot disagree with `sunPosition` — the two would have to be kept consistent
 * through every future change, and a sunrise time that contradicts the rendered
 * shadow is worse than a slightly slower calculation that cannot.
 */
export function daylightHours(
  latitude: number,
  longitude: number,
  utcOffsetHours: number,
  date: Date,
): { sunrise: Date | null; sunset: Date | null; hours: number } {
  let sunrise: Date | null = null;
  let sunset: Date | null = null;
  let previousUp = false;

  for (let minute = 0; minute <= 1440; minute++) {
    const probe = new Date(date);
    probe.setHours(0, minute, 0, 0);
    const up = sunPosition({ latitude, longitude, date: probe, utcOffsetHours }).isUp;
    if (up && !previousUp && sunrise === null) sunrise = new Date(probe);
    if (!up && previousUp && sunset === null && sunrise !== null) sunset = new Date(probe);
    previousUp = up;
  }

  const hours =
    sunrise && sunset ? (sunset.getTime() - sunrise.getTime()) / 3_600_000 : previousUp ? 24 : 0;

  return { sunrise, sunset, hours };
}
