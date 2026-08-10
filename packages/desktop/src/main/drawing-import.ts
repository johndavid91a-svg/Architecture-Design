/**
 * Drawing import, in the main process.
 *
 * Parsing runs here rather than in the renderer for two reasons. An uploaded
 * drawing is untrusted input — a PDF is a scripting-capable container and an
 * IFC is a several-hundred-megabyte text format — and none of that should be
 * parsed by code the renderer can reach. And web-ifc needs its WebAssembly from
 * the filesystem, which a sandboxed renderer under a strict CSP cannot load.
 *
 * The renderer receives candidates and issues: plain data, already validated,
 * with nothing executable in it.
 */

import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import type { CandidateFloor, ImportIssue, ImportStats, UnitResolution } from '@adp/core';

export type DrawingFormat = 'pdf' | 'dxf' | 'ifc';

export interface DrawingImportPayload {
  readonly ok: boolean;
  readonly format: DrawingFormat;
  readonly filename: string;
  readonly floors: readonly CandidateFloor[];
  readonly units: UnitResolution | null;
  readonly issues: readonly ImportIssue[];
  readonly stats: ImportStats | null;
  readonly schema?: string;
  /** Set when a PDF needs a scale before anything can be measured from it. */
  readonly needsCalibration?: boolean;
  readonly pageCount?: number;
}

const require = createRequire(import.meta.url);

/**
 * Where web-ifc keeps its WebAssembly. Only the main process can resolve it.
 *
 * Resolved through the `.wasm` file rather than through `package.json`, because
 * web-ifc publishes an `exports` map and `./package.json` is not in it: asking
 * for it throws ERR_PACKAGE_PATH_NOT_EXPORTED, and IFC import fails on the first
 * file the user opens. The wasm itself *is* exported, and it is the thing we
 * actually want the directory of.
 */
function webIfcDirectory(): string {
  return join(dirname(require.resolve('web-ifc/web-ifc.wasm')), '/');
}

const MAX_BYTES = 200_000_000;

export async function importDrawingFile(path: string): Promise<DrawingImportPayload> {
  // Take the extension from the file name, not the whole path: a directory
  // component may hold a dot, and a file may hold none at all. Getting this
  // wrong quotes the user's entire path back at them as the file type.
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  const format: DrawingFormat | null =
    extension === 'pdf' ? 'pdf' : extension === 'dxf' ? 'dxf' : extension === 'ifc' ? 'ifc' : null;

  if (format === null) {
    return fail(
      'ifc',
      path,
      extension === ''
        ? `"${name}" has no file extension, so its format cannot be told. Use a .pdf, .dxf or .ifc file.`
        : `Unsupported file type ".${extension}". Use PDF, DXF or IFC.`,
    );
  }

  try {
    const info = await stat(path);
    if (info.size > MAX_BYTES) {
      return fail(
        format,
        path,
        `That file is ${(info.size / 1_000_000).toFixed(0)} MB, above the ${MAX_BYTES / 1_000_000} MB limit.`,
      );
    }
  } catch (error) {
    return fail(format, path, `Could not read the file: ${(error as Error).message}`);
  }

  switch (format) {
    case 'ifc':
      return importIfc(path);
    case 'dxf':
      return importDxf(path);
    case 'pdf':
      return importPdf(path);
  }
}

// ---------------------------------------------------------------------------

async function importIfc(path: string): Promise<DrawingImportPayload> {
  try {
    const WebIFC = await import('web-ifc');
    const core = await import('@adp/core');

    const api = new WebIFC.IfcAPI();
    api.SetWasmPath(webIfcDirectory(), true);
    await api.Init();

    const data = new Uint8Array(await readFile(path));
    const result = await core.importIfcModel(data, {
      wasmPath: webIfcDirectory(),
      // The importer takes the API and the entity constants rather than
      // importing web-ifc itself, so the pure core package stays free of a
      // WebAssembly dependency it cannot use in every host.
      api: api as never,
      constants: {
        IFCUNITASSIGNMENT: WebIFC.IFCUNITASSIGNMENT,
        IFCBUILDINGSTOREY: WebIFC.IFCBUILDINGSTOREY,
        IFCSPACE: WebIFC.IFCSPACE,
        IFCWALL: WebIFC.IFCWALL,
        IFCWALLSTANDARDCASE: WebIFC.IFCWALLSTANDARDCASE,
        IFCDOOR: WebIFC.IFCDOOR,
        IFCWINDOW: WebIFC.IFCWINDOW,
        IFCCOLUMN: WebIFC.IFCCOLUMN,
        IFCSTAIR: WebIFC.IFCSTAIR,
        IFCSLAB: WebIFC.IFCSLAB,
        IFCRELCONTAINEDINSPATIALSTRUCTURE: WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE,
        IFCRELAGGREGATES: WebIFC.IFCRELAGGREGATES,
        IFCRELASSOCIATESMATERIAL: WebIFC.IFCRELASSOCIATESMATERIAL,
      },
    });

    return {
      ok: result.floors.length > 0,
      format: 'ifc',
      filename: path,
      floors: result.floors,
      units: result.units,
      issues: result.issues,
      stats: result.stats,
      schema: result.schema,
    };
  } catch (error) {
    return fail('ifc', path, `IFC import failed: ${(error as Error).message}`);
  }
}

async function importDxf(path: string): Promise<DrawingImportPayload> {
  try {
    const core = await import('@adp/core');
    // DXF is latin-1 by convention; reading it as UTF-8 mangles any accented
    // layer or room name, and room names are what the recogniser labels with.
    const text = await readFile(path, 'latin1');

    const { work, issues } = core.extractDxfLineWork(text);
    if (!work) {
      return {
        ok: false,
        format: 'dxf',
        filename: path,
        floors: [],
        units: null,
        issues,
        stats: null,
      };
    }

    const recognised = core.recogniseFloor(work, { floorName: 'Ground Floor', level: 0 });
    return {
      ok: recognised.floor !== null,
      format: 'dxf',
      filename: path,
      floors: recognised.floor ? [recognised.floor] : [],
      units: work.units,
      issues: [...issues, ...recognised.issues],
      stats: recognised.stats,
    };
  } catch (error) {
    return fail('dxf', path, `DXF import failed: ${(error as Error).message}`);
  }
}

async function importPdf(path: string): Promise<DrawingImportPayload> {
  try {
    const core = await import('@adp/core');
    const data = new Uint8Array(await readFile(path));
    const { pages, issues } = await core.extractPdfLineWork(data);

    if (pages.length === 0) {
      return {
        ok: false,
        format: 'pdf',
        filename: path,
        floors: [],
        units: null,
        issues:
          issues.length > 0
            ? issues
            : [
                {
                  severity: 'blocking',
                  code: 'PDF_NO_VECTORS',
                  message: 'No vector line work was found in the PDF.',
                  remedy:
                    'The file is probably a scan. Export the drawing from CAD as a vector PDF, or import the DXF or IFC instead.',
                },
              ],
        stats: null,
      };
    }

    // A page is in points and says nothing about building scale, so nothing can
    // be measured until a scale is known. Reporting that plainly is the whole
    // point: a guessed scale produces a plausible building of the wrong size.
    //
    // The test is whether a scale exists, not whether it is *confident*. A page
    // that states its own plotting scale gives `toMmScale > 0` with
    // `confident: false` — good evidence the user should still check, which is
    // a different thing from no evidence at all. Keying on `confident` would
    // reject every self-measuring drawing set as though it had said nothing.
    const usable = pages.filter((page) => page.toMmScale > 0);
    if (usable.length === 0) {
      return {
        ok: false,
        format: 'pdf',
        filename: path,
        floors: [],
        units: pages[0]?.units ?? null,
        issues: [
          ...issues,
          {
            severity: 'blocking',
            code: 'PDF_NEEDS_CALIBRATION',
            message:
              `${pages.length} page(s) of vector line work were read, but a PDF page carries no ` +
              `building scale.`,
            remedy:
              'Calibrate by picking two points on the drawing whose real distance you know, then import again.',
          },
        ],
        stats: null,
        needsCalibration: true,
        pageCount: pages.length,
      };
    }

    const floors: CandidateFloor[] = [];
    const allIssues: ImportIssue[] = [...issues];
    let stats: ImportStats | null = null;

    // ---- Which sheets are floors? ----------------------------------------
    // A drawing set is not a stack of floors. This set of 56 sheets holds nine
    // floor plans; the rest are the title sheet, an index, a 3D view, a site
    // plan, structural grids, opening plans, area blocks, elevations, sections
    // and details. Taking one floor per page turned a nine-storey building into
    // a 52-storey tower — a complete, confident, wrong answer.
    const sheets = pages.map((page) => core.identifySheet(page.stats.pageNumber, page.texts));
    const chosen = core.chooseFloorSheets(sheets);
    const byPage = new Map(pages.map((p) => [p.stats.pageNumber, p]));

    for (const sheet of chosen.floors) {
      const page = byPage.get(sheet.pageNumber);
      if (!page || page.toMmScale <= 0) continue;

      const recognised = core.recogniseFloor(page, {
        // The storey, not the sheet number. "Mezzanine" is what the user calls
        // this floor; "Page 24" is what the PDF calls it.
        floorName: sheet.storey ?? page.sheetName ?? `Page ${sheet.pageNumber}`,
        level: sheet.level ?? 0,
        // Deliberately left at the default.
        //
        // Raising the minimum wall run was tried against this set at 400, 600,
        // 900, 1200 and 1800 mm. It never converged: 1200 mm brought the third
        // floor to 1,258 sq ft against the 1,292 sq ft the drawing itself states,
        // and simultaneously emptied the basement and first floor of every room.
        // Every value traded one wrong answer for another, so none is shipped.
        // Tuning a threshold until one number looks right is how a plausible
        // wrong building gets built.
      });
      if (recognised.floor) floors.push(recognised.floor);
      allIssues.push(...recognised.issues);
      stats = recognised.stats;
    }

    if (chosen.floors.length > 0) {
      const storeys = chosen.floors.map((f) => f.storey).join(', ');
      allIssues.push({
        severity: 'info',
        code: 'SHEETS_CLASSIFIED',
        message:
          `${pages.length} sheet(s) read; ${chosen.floors.length} of them are floor plans ` +
          `(${chosen.family} plans): ${storeys}. The rest — elevations, sections, structural ` +
          `grids, schedules and details — draw the same building and are not storeys.`,
      });
    } else {
      allIssues.push({
        severity: 'review',
        code: 'NO_FLOOR_PLANS_IDENTIFIED',
        message:
          `None of the ${pages.length} sheet(s) could be identified as a floor plan from its title, ` +
          `so no storey could be built.`,
        remedy:
          'Sheet titles are read to tell a floor plan from an elevation or a section. If this set ' +
          'names its sheets differently, import the single plan sheet you want on its own.',
      });
    }

    // ---- Does the drawing agree with what we read off it? ----------------
    //
    // A real set states its covered area, and that figure is the architect's
    // rather than ours. It is the only ground truth a PDF import has, and it is
    // worth more than any internal plausibility check: on the set that prompted
    // this, storeys the schedule puts at 1,717.34 sq ft were recognised as
    // anywhere from 21 to 976, and nothing in the pipeline could tell. A model
    // wrong by a factor of eighty that says so is useful. The same model
    // presenting itself as measured is not.
    const stated = core.mergeAreaSchedules(pages.map((p) => core.readAreaSchedule(p.texts)));
    if (stated) {
      const summary = stated.perStorey.map((s) => `${s.storey} ${s.sqft.toLocaleString()} sq ft`).join(', ');
      allIssues.push({
        severity: 'info',
        code: 'DRAWING_STATES_AREAS',
        message:
          `The drawing states its own covered areas: ${summary}` +
          `${stated.totalSqft ? `, total ${stated.totalSqft.toLocaleString()} sq ft` : ''}` +
          `${stated.plotSize ? `, on a plot of ${stated.plotSize}` : ''}` +
          `${stated.plotSqft ? ` (${stated.plotSqft.toLocaleString()} sq ft)` : ''}. ` +
          `These are the architect's figures, read from the schedule, not measured by this app.`,
      });

      const comparison = core.compareWithDrawing(
        stated,
        floors.map((f) => ({
          storey: f.name,
          sqft: f.rooms.reduce((sum, r) => sum + core.polygonArea(r.boundary), 0) / 92_903.04,
        })),
      );
      const wrong = comparison.filter((c) => !c.agrees);
      if (wrong.length > 0) {
        const worst = wrong.reduce((w, c) => (c.ratio < w.ratio ? c : w));
        allIssues.push({
          severity: 'blocking',
          code: 'AREA_DISAGREES_WITH_DRAWING',
          message:
            `The room areas read from this PDF do not match the areas the drawing states. ` +
            wrong
              .map(
                (c) =>
                  `${c.storey}: recognised ${c.recognisedSqft.toFixed(0)} sq ft against a stated ` +
                  `${c.statedSqft.toLocaleString()} (${(c.ratio * 100).toFixed(0)}%)`,
              )
              .join('; ') +
            `. Worst is ${worst.storey}. Room areas, floor finishes and anything costed from them ` +
            `would be wrong by that much, so do not use this import for quantities. The storey ` +
            `stack, the storey names and the drawing's own stated areas above are still good.`,
          remedy:
            'Import the DXF or IFC for measurable geometry. A PDF has no layers, so a dense plan ' +
            "cannot be traced reliably — the drawing's own figures are the ones to cost from.",
        });
      }
    }

    const scaleless = chosen.floors.filter((s) => (byPage.get(s.pageNumber)?.toMmScale ?? 0) <= 0);
    if (scaleless.length > 0) {
      allIssues.push({
        severity: 'review',
        code: 'PDF_PAGES_WITHOUT_SCALE',
        message:
          `${scaleless.length} floor plan(s) had no single usable scale and were left out: ` +
          `${scaleless.map((s) => s.storey).join(', ')}.`,
        remedy: 'Import those sheets separately, or calibrate them by hand.',
      });
    }

    return {
      ok: floors.length > 0,
      format: 'pdf',
      filename: path,
      floors,
      units: pages[0]?.units ?? null,
      issues: allIssues,
      stats,
      pageCount: pages.length,
    };
  } catch (error) {
    return fail('pdf', path, `PDF import failed: ${(error as Error).message}`);
  }
}

function fail(format: DrawingFormat, filename: string, message: string): DrawingImportPayload {
  return {
    ok: false,
    format,
    filename,
    floors: [],
    units: null,
    issues: [{ severity: 'blocking', code: 'IMPORT_FAILED', message }],
    stats: null,
  };
}
