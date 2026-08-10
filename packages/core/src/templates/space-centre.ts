/**
 * A FOUR-STOREY SPACE CENTRE, AS A STARTING POINT.
 *
 * A complete worked building rather than a demo: four floors organised the way a
 * science centre actually is, with the room sizes a brief for one would carry.
 * It exists so the application opens onto something real — every quantity, every
 * finish and every regulatory figure computes from the first moment — and so
 * that there is a serious example to edit rather than a blank page.
 *
 * The organising idea is the one these buildings are always built on: **the
 * public rises through the building and the working parts sit behind and above
 * them.** Arrival and exhibition on the ground, galleries and the planetarium on
 * the first, research and mission control on the second, administration and the
 * auditorium on the third. Visitors and staff share the vertical core but their
 * floors are distinct, which is what lets the public half close at six o'clock
 * while the laboratories keep running.
 *
 * Dimensions are authored, not generated. Each band of rooms on a floor shares
 * one depth so the plate comes out as a clean rectangle without any room being
 * stretched to fit — the layout engine never alters a dimension, so a coherent
 * plan has to come from a coherent brief. Sizes are ordinary professional
 * practice for the room type: a 16 m planetarium is a mid-size dome, a 2.4 m
 * corridor is a public-building width, a 12 m structural span suits the flat
 * slab these buildings are usually framed in.
 *
 * It is a starting point, and it says so. Nothing here is a code compliance
 * claim: the regulation checker still reports `not_checkable` until real limits
 * are entered, exactly as it does for any other building.
 */

import type { PlateRoomSpec, PlateSpec } from '../layout/double-loaded.js';
import type { RegulatoryAuthority } from '../model/architecture.js';
import { createProject, type Project } from '../project.js';

const M = 1000; // metres to millimetres, for a brief that reads in metres

const room = (
  name: string,
  use: PlateRoomSpec['use'],
  widthM: number,
  depthM: number,
  extra: Partial<PlateRoomSpec> = {},
): PlateRoomSpec => ({ name, use, widthMm: widthM * M, depthMm: depthM * M, ...extra });

/**
 * Floor-to-floor heights.
 *
 * The lower two floors are tall because of what happens in them: an exhibition
 * hall hangs a launch vehicle and a planetarium needs the dome plus its
 * projection plenum above the ceiling line. The upper two are ordinary office
 * heights. Getting this wrong in either direction is expensive — over-height
 * floors carry facade and conditioning cost on every square metre.
 */
const HEIGHTS = [
  { clear: 6.0, floorToFloor: 7.2 }, // Ground: double-height exhibition
  { clear: 7.5, floorToFloor: 8.7 }, // First: planetarium dome
  { clear: 3.6, floorToFloor: 4.5 }, // Second: laboratories, deep services zone
  { clear: 3.3, floorToFloor: 4.2 }, // Third: administration
] as const;

/**
 * Band depths, floor by floor.
 *
 * Every room in a band shares its band's depth. That is what makes the plate a
 * clean rectangle without the layout engine stretching anything — and it is the
 * discipline a real plan is drawn to, because the structural grid does not move
 * from room to room.
 *
 * The depths shrink as the building rises, so each floor sits within the one
 * below it. A floor that oversails the one under it is a cantilever, and a
 * cantilever is a decision an engineer makes deliberately and prices, not
 * something a room schedule should cause by accident. Stepping back also opens
 * the upper floors to daylight and gives the massing a terraced profile.
 */
const BANDS = [
  { south: 14, north: 16 }, // Ground
  { south: 14, north: 16 }, // First — same envelope, the dome sits inside it
  { south: 12, north: 14 }, // Second — first setback
  { south: 11, north: 13 }, // Third — second setback
] as const;

/** Ground — arrival, orientation, and the main exhibition hall. */
const GROUND: readonly PlateRoomSpec[] = [
  room('Entrance Atrium', 'lobby', 20, BANDS[0].south, { band: 'south', doorCount: 3, windowCount: 6 }),
  room('Ticketing & Information', 'reception', 9, BANDS[0].south, { band: 'south' }),
  room('Museum Shop', 'retail', 11, BANDS[0].south, { band: 'south' }),
  room('Café', 'dining', 14, BANDS[0].south, { band: 'south' }),

  room('Main Exhibition Hall', 'exhibition', 26, BANDS[0].north, { band: 'north', doorCount: 3 }),
  room('Orientation Theatre', 'auditorium', 12, BANDS[0].north, { band: 'north' }),
  room('Cloakroom & Lockers', 'store', 6, BANDS[0].north, { band: 'north' }),
  room('Public Toilets', 'toilet', 8, BANDS[0].north, { band: 'north' }),
  room('Security & Building Control', 'control_room', 6, BANDS[0].north, { band: 'north' }),
];

/** First — the galleries and the dome. */
const FIRST: readonly PlateRoomSpec[] = [
  room('Space Science Gallery', 'exhibition', 20, BANDS[1].south, { band: 'south', doorCount: 2 }),
  room('Rocketry & Propulsion Gallery', 'exhibition', 17, BANDS[1].south, { band: 'south', doorCount: 2 }),
  room('Earth Observation Gallery', 'exhibition', 15, BANDS[1].south, { band: 'south' }),

  // 16 m is a mid-size dome — the range most science-centre planetaria sit in.
  // It fits the north band, so the dome is contained by the building envelope
  // rather than bulging out of it.
  room('Planetarium Dome', 'planetarium', 16, BANDS[1].north, { band: 'north', doorCount: 2 }),
  room('Projection & AV Plant', 'plant', 8, BANDS[1].north, { band: 'north' }),
  room('Education Workshop', 'training', 14, BANDS[1].north, { band: 'north' }),
  room('Discovery Lab', 'laboratory', 12, BANDS[1].north, { band: 'north' }),
  room('Gallery Toilets', 'toilet', 7, BANDS[1].north, { band: 'north' }),
];

/** Second — the working floor: research, instruments, mission control. */
const SECOND: readonly PlateRoomSpec[] = [
  room('Mission Control Simulator', 'control_room', 18, BANDS[2].south, { band: 'south', doorCount: 2 }),
  room('Astronaut Training Bay', 'training', 16, BANDS[2].south, { band: 'south' }),
  room('Telemetry & Data Centre', 'server_room', 10, BANDS[2].south, { band: 'south' }),
  room('Staff Toilets', 'toilet', 7, BANDS[2].south, { band: 'south' }),

  room('Research Laboratory', 'laboratory', 15, BANDS[2].north, { band: 'north', doorCount: 2 }),
  room('Instrument Cleanroom', 'laboratory', 11, BANDS[2].north, { band: 'north' }),
  room('Materials Laboratory', 'laboratory', 12, BANDS[2].north, { band: 'north' }),
  room('Meeting Room', 'meeting', 8, BANDS[2].north, { band: 'north' }),
  room('Laboratory Store', 'store', 6, BANDS[2].north, { band: 'north' }),
];

/** Third — administration, the lecture theatre, and the observatory. */
const THIRD: readonly PlateRoomSpec[] = [
  room('Auditorium', 'auditorium', 20, BANDS[3].south, { band: 'south', doorCount: 3 }),
  room('Conference Room', 'conference', 10, BANDS[3].south, { band: 'south' }),
  room('Library & Archive', 'library', 12, BANDS[3].south, { band: 'south' }),
  room('Staff Lounge', 'lounge', 9, BANDS[3].south, { band: 'south' }),

  room('Observatory Deck', 'observatory', 13, BANDS[3].north, { band: 'north', windowCount: 6 }),
  room('Open Plan Offices', 'open_office', 17, BANDS[3].north, { band: 'north', doorCount: 2 }),
  room("Director's Suite", 'executive_office', 9, BANDS[3].north, { band: 'north' }),
  room('Plant Room', 'plant', 7, BANDS[3].north, { band: 'north' }),
  room('Toilets', 'toilet', 6, BANDS[3].north, { band: 'north' }),
];

const PROGRAMME: ReadonlyArray<{
  readonly name: string;
  readonly purpose: string;
  readonly rooms: readonly PlateRoomSpec[];
}> = [
  {
    name: 'Ground Floor',
    purpose: 'Arrival, ticketing, retail and the main exhibition hall',
    rooms: GROUND,
  },
  {
    name: 'First Floor',
    purpose: 'Galleries, the planetarium dome and education spaces',
    rooms: FIRST,
  },
  {
    name: 'Second Floor',
    purpose: 'Mission control, laboratories and the data centre',
    rooms: SECOND,
  },
  {
    name: 'Third Floor',
    purpose: 'Auditorium, observatory deck and administration',
    rooms: THIRD,
  },
];

/**
 * The plot.
 *
 * 90 x 60 m, which leaves a generous margin around a plate roughly 66 x 40 m —
 * room for the arrival forecourt and the service yard a building taking coach
 * parties needs. Coverage lands near 45%, which is the sort of figure a civic
 * site is planned to; the checker still will not call that compliant without
 * the real limit, and should not.
 */
export const SPACE_CENTRE_PLOT = { widthMm: 90 * M, depthMm: 60 * M };

/** The four floor plates, ready for `buildDoubleLoadedFloor`. */
export function spaceCentreFloors(): PlateSpec[] {
  return PROGRAMME.map((floor, level) => {
    const height = HEIGHTS[level]!;
    return {
      name: floor.name,
      level,
      clearHeightMm: height.clear * M,
      floorToFloorMm: height.floorToFloor * M,
      purpose: floor.purpose,
      // Public buildings run wider corridors than offices; this is the width
      // that takes two-way visitor flow past a stopped wheelchair.
      corridorWidthMm: 2400,
      corridorName: level === 0 ? 'Main Concourse' : 'Corridor',
      rooms: floor.rooms,
    };
  });
}

/** A one-line description of each floor, for the template picker. */
export const SPACE_CENTRE_SUMMARY = PROGRAMME.map((f) => ({
  name: f.name,
  purpose: f.purpose,
  roomCount: f.rooms.length,
}));

/**
 * The whole building, as an ordinary project.
 *
 * Nothing about the result is special-cased: it is the same `Project` the manual
 * route and the drawing importer produce, so every editing operation, every
 * quantity and every check applies to it unchanged. The template chooses the
 * brief; it does not get a private path through the model.
 */
export function createSpaceCentre(
  options: { name?: string; city?: string; authority?: RegulatoryAuthority },
  now: string,
): Project {
  return createProject(
    {
      name: options.name ?? 'National Space Centre',
      buildingType: 'education',
      location: {
        city: options.city ?? 'Islamabad',
        country: 'Pakistan',
        authority: options.authority ?? 'CDA',
      },
      displayUnit: 'ft',
      plotWidthMm: SPACE_CENTRE_PLOT.widthMm,
      plotDepthMm: SPACE_CENTRE_PLOT.depthMm,
      // A four-storey public building needs both, and a second stair would be
      // the next thing a fire engineer asks for.
      cores: ['stair', 'lift'],
      floors: [],
      plates: spaceCentreFloors(),
    },
    now,
  );
}
