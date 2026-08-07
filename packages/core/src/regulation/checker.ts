/**
 * BUILDING REGULATION CHECKER.
 *
 * Requirement 48, with its own explicit limit: "Do NOT claim legal approval.
 * Instead: Potential Regulation Issue — Needs Architect/Engineer Verification."
 *
 * Everything this module returns is an *observation*, not a determination. That
 * distinction is load-bearing and is reflected in the types: there is no `pass`
 * verdict anywhere. A check either raises an observation or stays silent, and
 * silence means "nothing detected against the parameters on file", not
 * "compliant".
 *
 * The parameters themselves are user-supplied. CDA and RDA publish bye-laws that
 * vary by sector, plot category, land use and zone, and are amended by
 * notification between consolidated editions. A rate set hard-coded here would
 * be wrong for most plots and wrong invisibly. So the checker ships with the
 * *shape* of the rules and requires the user to enter the figures that apply to
 * their plot, recording where they got them.
 */

import { polygonArea } from '../geometry.js';
import type { ArchitectureLayer, RegulatoryAuthority } from '../model/architecture.js';
import { fromMm2 } from '../units.js';

export type ObservationSeverity =
  /** Exceeds a limit the user entered. Almost certainly a problem. */
  | 'exceeds_limit'
  /** Close enough to a limit that measurement differences could cross it. */
  | 'near_limit'
  /** Cannot be checked because a parameter is missing. */
  | 'not_checkable';

export interface RegulationObservation {
  readonly code: string;
  readonly title: string;
  readonly severity: ObservationSeverity;
  readonly message: string;
  /** Measured value and the limit, so the user can verify the arithmetic. */
  readonly measured?: number;
  readonly limit?: number;
  readonly unit?: string;
  /** Which authority's parameter this was checked against. */
  readonly authority: RegulatoryAuthority;
  /** Where the user said the parameter came from. */
  readonly parameterSource?: string;
}

/**
 * Plot parameters, entered by the user from the applicable bye-laws.
 *
 * Every field is optional. A missing field produces a `not_checkable`
 * observation naming what is needed, which is more useful than a checker that
 * silently skips half its rules.
 */
export interface PlanningParameters {
  readonly authority: RegulatoryAuthority;
  /** Where these figures came from — a bye-law clause, a sector schedule, a letter. */
  readonly source?: string;
  readonly recordedAt?: string;

  /** Floor Area Ratio: total covered area ÷ plot area. */
  readonly maxFar?: number;
  /** Ground coverage as a fraction of plot area. */
  readonly maxGroundCoverage?: number;
  readonly maxHeightMm?: number;
  readonly maxFloors?: number;

  readonly frontSetbackMm?: number;
  readonly rearSetbackMm?: number;
  readonly sideSetbackMm?: number;

  /** Parking bays required per unit of covered area. */
  readonly parkingBaysPerSqft?: number;
  /** Bays actually provided, entered by the user. */
  readonly parkingBaysProvided?: number;

  readonly permittedUse?: string;
}

export interface RegulationReport {
  readonly observations: readonly RegulationObservation[];
  readonly metrics: BuildingMetrics;
  /** Always present, always shown. */
  readonly disclaimer: string;
  readonly authority: RegulatoryAuthority;
  readonly parameterSource: string;
}

export interface BuildingMetrics {
  readonly plotAreaSqft: number;
  readonly groundCoverageSqft: number;
  readonly groundCoverageRatio: number | null;
  readonly totalCoveredAreaSqft: number;
  readonly far: number | null;
  readonly floorCount: number;
  readonly buildingHeightMm: number;
}

export const REGULATION_DISCLAIMER =
  'These are observations against parameters you entered, not a compliance determination. ' +
  'This application does not and cannot grant, imply or verify regulatory approval. ' +
  'CDA and RDA bye-laws vary by sector, plot category, land use and zone, and are amended by ' +
  'notification. Every observation here — and every silence — must be verified by a qualified ' +
  'architect or engineer against the current bye-laws for your specific plot before you rely on it.';

/** Where the parameter figures should be sourced from, shown in the UI. */
export const PARAMETER_SOURCES: Record<RegulatoryAuthority, { name: string; url: string }> = {
  CDA: {
    name: 'Capital Development Authority — Laws and Regulations',
    url: 'https://cda.gov.pk/lawsAndRegulations',
  },
  RDA: {
    name: 'Rawalpindi Development Authority — Land and Building Control',
    url: 'https://rda.gop.pk/land-building-control',
  },
  OTHER_PK: {
    name: 'The development authority with jurisdiction over your plot',
    url: '',
  },
  INTERNATIONAL: {
    name: 'The local planning authority',
    url: '',
  },
};

export function computeMetrics(arch: ArchitectureLayer): BuildingMetrics {
  const plotAreaMm2 = polygonArea(arch.site.plotBoundary);
  const plotAreaSqft = fromMm2(plotAreaMm2, 'ft2');

  const buildings = arch.site.buildings;
  const groundCoverageMm2 = buildings.reduce((sum, b) => sum + polygonArea(b.footprint), 0);
  const groundCoverageSqft = fromMm2(groundCoverageMm2, 'ft2');

  const allFloors = buildings.flatMap((b) => b.floors);
  const totalCoveredMm2 = allFloors.reduce(
    (sum, floor) => sum + floor.rooms.reduce((s, r) => s + polygonArea(r.boundary), 0),
    0,
  );
  const totalCoveredAreaSqft = fromMm2(totalCoveredMm2, 'ft2');

  // Height measured from the lowest floor's elevation to the top of the
  // highest, which is the convention most bye-laws use for a flat roof.
  const elevations = allFloors.map((f) => f.elevation);
  const lowest = elevations.length > 0 ? Math.min(...elevations) : 0;
  const topFloor = allFloors.reduce(
    (top, f) => (f.elevation > top.elevation ? f : top),
    allFloors[0] ?? { elevation: 0, floorToFloor: 0 },
  );
  const buildingHeightMm = topFloor.elevation + topFloor.floorToFloor - lowest;

  return {
    plotAreaSqft,
    groundCoverageSqft,
    groundCoverageRatio: plotAreaSqft > 0 ? groundCoverageSqft / plotAreaSqft : null,
    totalCoveredAreaSqft,
    far: plotAreaSqft > 0 ? totalCoveredAreaSqft / plotAreaSqft : null,
    floorCount: allFloors.length,
    buildingHeightMm,
  };
}

/** Fraction of a limit above which we warn rather than stay silent. */
const NEAR_LIMIT_FRACTION = 0.95;

export function checkRegulations(
  arch: ArchitectureLayer,
  params: PlanningParameters,
): RegulationReport {
  const metrics = computeMetrics(arch);
  const observations: RegulationObservation[] = [];
  const authority = params.authority;
  const source = params.source ?? PARAMETER_SOURCES[authority].name;

  const observe = (o: Omit<RegulationObservation, 'authority' | 'parameterSource'>) =>
    observations.push({ ...o, authority, parameterSource: params.source });

  const compare = (
    code: string,
    title: string,
    measured: number | null,
    limit: number | undefined,
    unit: string,
    missingHint: string,
    format: (v: number) => string = (v) => v.toFixed(2),
  ) => {
    if (limit === undefined) {
      observe({
        code,
        title,
        severity: 'not_checkable',
        message: `Cannot check ${title.toLowerCase()}: ${missingHint}`,
      });
      return;
    }
    if (measured === null) {
      observe({
        code,
        title,
        severity: 'not_checkable',
        message: `Cannot check ${title.toLowerCase()}: the model does not carry the required geometry.`,
      });
      return;
    }
    if (measured > limit) {
      observe({
        code,
        title,
        severity: 'exceeds_limit',
        message:
          `${title} is ${format(measured)} ${unit} against a limit of ${format(limit)} ${unit} — ` +
          `over by ${format(measured - limit)} ${unit}.`,
        measured,
        limit,
        unit,
      });
    } else if (measured > limit * NEAR_LIMIT_FRACTION) {
      observe({
        code,
        title,
        severity: 'near_limit',
        message:
          `${title} is ${format(measured)} ${unit}, within 5% of the ${format(limit)} ${unit} limit. ` +
          `Small measurement differences could put this over.`,
        measured,
        limit,
        unit,
      });
    }
  };

  compare(
    'FAR',
    'Floor Area Ratio',
    metrics.far,
    params.maxFar,
    '',
    'no maximum FAR has been entered for this plot.',
  );

  compare(
    'COVERAGE',
    'Ground coverage',
    metrics.groundCoverageRatio,
    params.maxGroundCoverage,
    '',
    'no maximum ground coverage has been entered for this plot.',
    (v) => `${(v * 100).toFixed(1)}%`,
  );

  compare(
    'HEIGHT',
    'Building height',
    metrics.buildingHeightMm,
    params.maxHeightMm,
    'ft',
    'no maximum height has been entered for this plot.',
    (v) => (v / 304.8).toFixed(2),
  );

  compare(
    'FLOORS',
    'Number of floors',
    metrics.floorCount,
    params.maxFloors,
    '',
    'no floor limit has been entered for this plot.',
    (v) => v.toFixed(0),
  );

  // ---- Setbacks --------------------------------------------------------
  // Measured as the gap between the plot boundary's bounding box and the
  // building footprint's. This is only valid for a rectangular plot with an
  // orthogonal building, which is stated rather than assumed.
  if (
    params.frontSetbackMm !== undefined ||
    params.rearSetbackMm !== undefined ||
    params.sideSetbackMm !== undefined
  ) {
    const plot = boundsOfPolygon(arch.site.plotBoundary);
    const footprints = arch.site.buildings.map((b) => boundsOfPolygon(b.footprint));

    if (plot && footprints.length > 0 && footprints.every(Boolean)) {
      const building = footprints.reduce((acc, f) => ({
        minX: Math.min(acc!.minX, f!.minX),
        minY: Math.min(acc!.minY, f!.minY),
        maxX: Math.max(acc!.maxX, f!.maxX),
        maxY: Math.max(acc!.maxY, f!.maxY),
      }))!;

      const front = building.minY - plot.minY;
      const rear = plot.maxY - building.maxY;
      const sideLeft = building.minX - plot.minX;
      const sideRight = plot.maxX - building.maxX;

      const checkSetback = (code: string, title: string, actual: number, required?: number) => {
        if (required === undefined) return;
        if (actual < required) {
          observe({
            code,
            title,
            severity: 'exceeds_limit',
            message:
              `${title} is ${(actual / 304.8).toFixed(2)} ft against a required ` +
              `${(required / 304.8).toFixed(2)} ft — short by ${((required - actual) / 304.8).toFixed(2)} ft.`,
            measured: actual,
            limit: required,
            unit: 'ft',
          });
        }
      };

      checkSetback('SETBACK_FRONT', 'Front setback', front, params.frontSetbackMm);
      checkSetback('SETBACK_REAR', 'Rear setback', rear, params.rearSetbackMm);
      checkSetback('SETBACK_SIDE_L', 'Left side setback', sideLeft, params.sideSetbackMm);
      checkSetback('SETBACK_SIDE_R', 'Right side setback', sideRight, params.sideSetbackMm);
    } else {
      observe({
        code: 'SETBACK',
        title: 'Setbacks',
        severity: 'not_checkable',
        message: 'Cannot check setbacks: the plot boundary or the building footprint is missing.',
      });
    }
  } else {
    observe({
      code: 'SETBACK',
      title: 'Setbacks',
      severity: 'not_checkable',
      message: 'Cannot check setbacks: no setback requirements have been entered for this plot.',
    });
  }

  // ---- Parking ---------------------------------------------------------
  if (params.parkingBaysPerSqft !== undefined) {
    const required = Math.ceil(metrics.totalCoveredAreaSqft * params.parkingBaysPerSqft);
    const provided = params.parkingBaysProvided;
    if (provided === undefined) {
      observe({
        code: 'PARKING',
        title: 'Parking',
        severity: 'not_checkable',
        message:
          `${required} bay(s) would be required for ${metrics.totalCoveredAreaSqft.toFixed(0)} sq ft of ` +
          `covered area, but the number provided has not been entered.`,
        measured: required,
        unit: 'bays',
      });
    } else if (provided < required) {
      observe({
        code: 'PARKING',
        title: 'Parking',
        severity: 'exceeds_limit',
        message: `${provided} bay(s) provided against ${required} required — short by ${required - provided}.`,
        measured: provided,
        limit: required,
        unit: 'bays',
      });
    }
  } else {
    observe({
      code: 'PARKING',
      title: 'Parking',
      severity: 'not_checkable',
      message: 'Cannot check parking: no parking requirement has been entered for this plot.',
    });
  }

  return {
    observations,
    metrics,
    disclaimer: REGULATION_DISCLAIMER,
    authority,
    parameterSource: source,
  };
}

function boundsOfPolygon(points: readonly { x: number; y: number }[]) {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}
