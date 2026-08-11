/**
 * THEME ENGINE.
 *
 * Requirement 12: "Themes must be data-driven."
 *
 * A theme is a specification, not a renderer. It states what a design language
 * *is* — palette, materials, lighting character, signature moves — and the AI
 * design agents consult it as a constraint when they produce a design. That
 * separation is what allows a user to add a theme without touching code, and it
 * is what makes a theme reviewable: you can read "Satellite Company" and judge
 * whether it will produce the right building before generating anything.
 *
 * Themes carry material *preferences*, keyed by role rather than by product.
 * A theme never names a supplier or a price. Pricing is a separate concern that
 * varies by city and date; a theme that hard-coded a product would be wrong in
 * every market but one.
 */

import type { MaterialId, ThemeId } from '../model/ids.js';
import type { CeilingKind, FacadeSystem, LightingKind } from '../model/design.js';
import type { RoomUse } from '../model/architecture.js';

export type ThemeFamily =
  | 'general'
  | 'technology'
  | 'space_geospatial'
  | 'corporate'
  | 'hospitality'
  | 'healthcare'
  | 'education'
  | 'retail'
  | 'residential'
  | 'industrial';

export interface ColourPalette {
  readonly primary: string;
  readonly secondary: string;
  readonly accent: string;
  readonly neutralLight: string;
  readonly neutralDark: string;
  /** Where the accent is allowed to appear. Prevents accent-everywhere designs. */
  readonly accentUsage: string;
}

/** Material preference by role, so a theme survives catalogue changes. */
export interface MaterialPreferences {
  readonly primaryFloor: MaterialId;
  readonly secondaryFloor?: MaterialId;
  readonly circulationFloor?: MaterialId;
  readonly primaryWall: MaterialId;
  readonly featureWall?: MaterialId;
  readonly ceiling: MaterialId;
  readonly facade?: MaterialId;
}

export interface LightingCharacter {
  readonly primary: LightingKind;
  readonly feature?: LightingKind;
  readonly colourTemperatureK: number;
  readonly description: string;
}

/** A signature visual element — what makes the theme recognisable. */
export interface SignatureElement {
  readonly where: RoomUse | 'facade' | 'any';
  readonly element: string;
  readonly rationale: string;
}

export interface Theme {
  readonly id: ThemeId;
  readonly name: string;
  readonly family: ThemeFamily;
  /** One-line identity statement. Given to the AI verbatim as design intent. */
  readonly identity: string;
  readonly palette: ColourPalette;
  readonly materials: MaterialPreferences;
  readonly ceilingKind: CeilingKind;
  readonly lighting: LightingCharacter;
  readonly facadeSystem?: FacadeSystem;
  readonly signatureElements: readonly SignatureElement[];
  /** Furniture catalogue keys this theme prefers. */
  readonly furnitureStyle: string;
  readonly landscaping?: string;
  /** Written for the AI, describing what to avoid. Negative constraints matter. */
  readonly avoid: string;
}

const M = (id: string) => id as MaterialId;
const T = (id: string) => id as ThemeId;

export const THEMES: readonly Theme[] = [
  {
    id: T('theme_modern_corporate'),
    name: 'Modern Corporate',
    family: 'corporate',
    identity: 'Restrained, legible, built to look competent rather than expensive.',
    palette: {
      primary: '#1f2933',
      secondary: '#e4e7eb',
      accent: '#0b6bcb',
      neutralLight: '#f5f7fa',
      neutralDark: '#323f4b',
      accentUsage: 'Wayfinding, seating upholstery and one feature wall per floor. Never on large surfaces.',
    },
    materials: {
      primaryFloor: M('mat_tile_porcelain'),
      circulationFloor: M('mat_tile_porcelain'),
      secondaryFloor: M('mat_carpet_tile'),
      primaryWall: M('mat_paint_emulsion'),
      ceiling: M('mat_grid_ceiling'),
      facade: M('mat_acp_panel'),
    },
    ceilingKind: 'grid_tile',
    lighting: {
      primary: 'recessed_downlight',
      feature: 'linear_led',
      colourTemperatureK: 4000,
      description: 'Even, low-glare ambient light with linear accents over circulation.',
    },
    facadeSystem: 'aluminium_composite',
    signatureElements: [
      {
        where: 'reception',
        element: 'Full-height backlit brand wall behind the reception desk',
        rationale: 'Gives the entrance a single focal point without needing expensive materials.',
      },
    ],
    furnitureStyle: 'contemporary.office',
    avoid: 'Ornament, gloss finishes, more than one accent colour, and visible cable management.',
  },
  {
    id: T('theme_satellite_company'),
    name: 'Satellite Company',
    family: 'space_geospatial',
    identity:
      'A ground-segment facility for a satellite operator: instrument-grade, quietly technical, ' +
      'organised around visible data rather than decoration.',
    palette: {
      primary: '#0b1220',
      secondary: '#c8d3e0',
      accent: '#28c6d8',
      neutralLight: '#eef2f7',
      neutralDark: '#151d2b',
      accentUsage: 'Screen bezels, edge lighting, orbital graphics and wayfinding only. Never as a wall colour.',
    },
    materials: {
      primaryFloor: M('mat_tile_porcelain'),
      circulationFloor: M('mat_tile_porcelain'),
      secondaryFloor: M('mat_carpet_tile'),
      primaryWall: M('mat_paint_emulsion'),
      featureWall: M('mat_acp_panel'),
      ceiling: M('mat_gypsum_ceiling'),
      facade: M('mat_acp_panel'),
    },
    ceilingKind: 'gypsum_coffered',
    lighting: {
      primary: 'linear_led',
      feature: 'cove',
      colourTemperatureK: 4500,
      description:
        'Cool linear light with concealed cove washes. Deliberately low ambient level so screens read ' +
        'as the brightest surface in the room.',
    },
    facadeSystem: 'aluminium_composite',
    signatureElements: [
      {
        where: 'reception',
        element: 'Large Earth visualisation, live or near-live, as the entrance focal wall',
        rationale:
          'States what the company does before anyone speaks. The single highest-value element in the theme.',
      },
      {
        where: 'conference',
        element: 'Satellite imagery wall with a ground-track graphic',
        rationale: 'Turns a meeting room into a demonstration space at no extra construction cost.',
      },
      {
        where: 'laboratory',
        element: 'Glazed partition to the corridor so the technical floor is visible from circulation',
        rationale: 'Visitors read capability from seeing work happen, not from finishes.',
      },
      {
        where: 'facade',
        element: 'Horizontal aluminium banding with a recessed illuminated reveal at parapet level',
        rationale: 'Reads as instrumentation rather than as ornament, and lights the building at night cheaply.',
      },
    ],
    furnitureStyle: 'technical.workstation',
    landscaping: 'Low planting, gravel and directional lighting. Nothing that obstructs sightlines to the façade.',
    avoid:
      'Literal rocket and planet imagery, chrome, blue LED strip used as decoration, and any finish that ' +
      'reflects screens.',
  },
  {
    id: T('theme_gis_company'),
    name: 'GIS / Geospatial Technology',
    family: 'space_geospatial',
    identity:
      'A mapping and analysis practice: layered, precise, organised around large-format display of ' +
      'spatial data.',
    palette: {
      primary: '#12211c',
      secondary: '#d5ded4',
      accent: '#3fa66b',
      neutralLight: '#f2f5f0',
      neutralDark: '#1d3029',
      accentUsage: 'Contour and grid graphics, wayfinding, and planting. Never on ceilings.',
    },
    materials: {
      primaryFloor: M('mat_tile_porcelain'),
      secondaryFloor: M('mat_carpet_tile'),
      primaryWall: M('mat_paint_emulsion'),
      featureWall: M('mat_stone_cladding'),
      ceiling: M('mat_gypsum_ceiling'),
      facade: M('mat_stone_cladding'),
    },
    ceilingKind: 'gypsum_flat',
    lighting: {
      primary: 'linear_led',
      feature: 'wall_washer',
      colourTemperatureK: 4000,
      description: 'High vertical illuminance for wall-mounted map display; even, shadow-free plotting areas.',
    },
    facadeSystem: 'mixed',
    signatureElements: [
      {
        where: 'reception',
        element: 'Contour-relief feature wall in stone, lit from above',
        rationale: 'Expresses terrain as a physical object rather than as a printed graphic.',
      },
      {
        where: 'laboratory',
        element: 'Continuous large-format display wall with a plotting bench beneath',
        rationale: 'GIS work is reviewed at large format; the room should be built for that.',
      },
    ],
    furnitureStyle: 'technical.workstation',
    landscaping: 'Native, drought-tolerant planting arranged in visible bands.',
    avoid: 'Globe motifs, generic map wallpaper, and dark floors that hide the layered palette.',
  },
  {
    id: T('theme_luxury_executive'),
    name: 'Luxury Executive',
    family: 'general',
    identity: 'Materially rich and quiet: stone, timber and warm light, with restraint in the detailing.',
    palette: {
      primary: '#2b2622',
      secondary: '#cbbfa8',
      accent: '#8a6a3b',
      neutralLight: '#f3efe7',
      neutralDark: '#3d352d',
      accentUsage: 'Metalwork, handles, inlays and lighting trim.',
    },
    materials: {
      primaryFloor: M('mat_marble'),
      secondaryFloor: M('mat_carpet_tile'),
      primaryWall: M('mat_paint_emulsion'),
      featureWall: M('mat_stone_cladding'),
      ceiling: M('mat_gypsum_ceiling'),
      facade: M('mat_stone_cladding'),
    },
    ceilingKind: 'gypsum_coffered',
    lighting: {
      primary: 'recessed_downlight',
      feature: 'cove',
      colourTemperatureK: 3000,
      description: 'Warm, layered light with concealed sources. No visible lamps in the field of view.',
    },
    facadeSystem: 'stone_cladding',
    signatureElements: [
      {
        where: 'executive_office',
        element: 'Book-matched stone behind the desk, with a concealed cove wash above',
        rationale: 'Concentrates the material budget on the one wall that appears in every photograph and call.',
      },
    ],
    furnitureStyle: 'executive.timber',
    avoid: 'Gold-effect plating, high-gloss marble, and pattern on more than one surface per room.',
  },
  {
    id: T('theme_minimal_technology'),
    name: 'Minimal Technology',
    family: 'technology',
    identity: 'Software-company plain: white, daylight-led, cheap to build and easy to reconfigure.',
    palette: {
      primary: '#22262b',
      secondary: '#eceef1',
      accent: '#f06a3a',
      neutralLight: '#ffffff',
      neutralDark: '#3a4048',
      accentUsage: 'Soft furnishings and wayfinding only.',
    },
    materials: {
      primaryFloor: M('mat_carpet_tile'),
      circulationFloor: M('mat_tile_porcelain'),
      primaryWall: M('mat_paint_emulsion'),
      ceiling: M('mat_grid_ceiling'),
      facade: M('mat_acp_panel'),
    },
    ceilingKind: 'exposed',
    lighting: {
      primary: 'linear_led',
      colourTemperatureK: 4000,
      description: 'Suspended linear runs on an exposed soffit. Deliberately utilitarian.',
    },
    facadeSystem: 'curtain_wall',
    signatureElements: [
      {
        where: 'open_office',
        element: 'Exposed services painted a single dark colour above suspended linear lighting',
        rationale: 'Removes the ceiling cost entirely and buys back clear height.',
      },
    ],
    furnitureStyle: 'contemporary.office',
    avoid: 'False ceilings in open areas, feature walls, and any applied decoration.',
  },
  /*
   * Two substitutions worth stating, because the catalogue cannot express the
   * intent literally and a silent near-miss would be read later as a mistake:
   *
   *  - The floor wants dark timber or a dark stone tile. There is no timber
   *    flooring material; `mat_granite` (#4a4a4e) is the only genuinely dark
   *    floor in the catalogue and is used for it. Reaching for `mat_door_flush`
   *    to get the timber colour would put "Flush door with frame" into the
   *    takeoff measured in `each`, which is how a finish choice corrupts a BOQ.
   *  - The deep feature colour wants a dark paint. Paint is one material with
   *    one appearance, so a "deep colour" cannot be asked for by id at all;
   *    `mat_brick_common` (#9c5a3c) carries the warmth honestly as a material
   *    rather than pretending emulsion can be two colours at once.
   *
   * No façade and no landscaping: this theme describes an interior, and a
   * basement lounge has neither. `designFromTheme` falls back to plaster_paint
   * if it is ever applied to a whole building.
   */
  {
    id: T('theme_recreation_lounge'),
    name: 'Recreation Lounge',
    family: 'hospitality',
    identity:
      'A below-ground games and tea lounge: dark underfoot, warm above, lit low and locally so the ' +
      'room reads as an evening rather than as a working day.',
    palette: {
      primary: '#241d18',
      secondary: '#c9ae86',
      accent: '#2f5d4a',
      neutralLight: '#f1eadd',
      neutralDark: '#2e251d',
      accentUsage: 'Baize, upholstery, the counter front and one wall per games room. Never on floors or ceilings.',
    },
    materials: {
      // Circulation is left to inherit the primary floor: one unbroken dark
      // surface is the point, and a lighter lobby would announce the exit.
      primaryFloor: M('mat_granite'),
      secondaryFloor: M('mat_carpet_tile'),
      primaryWall: M('mat_paint_emulsion'),
      featureWall: M('mat_brick_common'),
      ceiling: M('mat_gypsum_ceiling'),
    },
    // Flat, not coffered: a coffer books a 450 mm drop, and a basement at
    // 2515 mm clear cannot afford it. Not checked against local bye-laws.
    ceilingKind: 'gypsum_flat',
    lighting: {
      primary: 'cove',
      feature: 'linear_led',
      colourTemperatureK: 2700,
      description:
        'Warm indirect light from a perimeter cove, with linear runs picking out the play areas. The ' +
        'ambient level is deliberately low, and nothing overhead reads as a grid.',
    },
    signatureElements: [
      {
        where: 'lounge',
        element: 'A low pendant dropped over the games table, with dark surfaces on every side of it',
        rationale:
          'Pulls the light down onto the table and leaves the rest of the floor in shadow, which is what ' +
          'makes a games room feel like one rather than like a hall with a table in it.',
      },
      {
        where: 'retail',
        element: 'Timber-fronted tea counter with warm backlit shelving above',
        rationale:
          'The counter becomes the only lit object on that side of the floor, so it does the work of a ' +
          'sign without anyone having to hang one.',
      },
      {
        where: 'any',
        element: 'Planting massed in one corner rather than dotted along the perimeter',
        rationale:
          'Grouped greenery reads as somewhere to sit near; evenly spaced planters read as an office ' +
          'corridor, which is the exact impression this theme exists to avoid.',
      },
    ],
    // `lounge.recreation` claims the games and counter items and also the soft
    // seating, the planting and the screen, which the signature elements above
    // ask for by name. Whatever this string is changed to must match at least
    // one catalogue item: a style key that matches nothing does not fail, it
    // falls back to the whole catalogue and quietly offers the AI office desks.
    furnitureStyle: 'lounge.recreation',
    avoid:
      'Grid ceilings, cool white light, pale porcelain floors, neon strip used as decoration, sports-bar ' +
      'signage, and printed graphics of any kind.',
  },
];

const THEME_INDEX = new Map(THEMES.map((t) => [t.id, t]));

export function findTheme(id: ThemeId): Theme | undefined {
  return THEME_INDEX.get(id);
}

export function themesByFamily(family: ThemeFamily): readonly Theme[] {
  return THEMES.filter((t) => t.family === family);
}

/**
 * Render a theme as a design brief for an AI agent.
 *
 * Themes are given to the model as prose rather than as JSON because the negative
 * constraints ("avoid") carry most of the value, and models follow prohibitions
 * stated in sentences far more reliably than prohibitions encoded as fields.
 */
export function themeToBrief(theme: Theme): string {
  const signatures = theme.signatureElements
    .map((s) => `  - In ${s.where}: ${s.element}. Reason: ${s.rationale}`)
    .join('\n');
  return [
    `THEME: ${theme.name}`,
    `Identity: ${theme.identity}`,
    '',
    `Palette: primary ${theme.palette.primary}, secondary ${theme.palette.secondary}, accent ${theme.palette.accent}.`,
    `Accent discipline: ${theme.palette.accentUsage}`,
    '',
    `Lighting: ${theme.lighting.description} Colour temperature ${theme.lighting.colourTemperatureK}K.`,
    `Ceiling approach: ${theme.ceilingKind}.`,
    theme.facadeSystem ? `Façade system: ${theme.facadeSystem}.` : '',
    '',
    'Signature elements:',
    signatures,
    '',
    `Furniture style key: ${theme.furnitureStyle}`,
    theme.landscaping ? `Landscaping: ${theme.landscaping}` : '',
    '',
    `AVOID: ${theme.avoid}`,
  ]
    .filter(Boolean)
    .join('\n');
}
