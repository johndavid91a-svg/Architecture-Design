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
    // be measured until the user calibrates. Reporting that plainly is the whole
    // point: a guessed scale produces a plausible building of the wrong size.
    const uncalibrated = pages.every((page) => !page.units.confident);
    if (uncalibrated) {
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

    pages.forEach((page, index) => {
      const recognised = core.recogniseFloor(page, {
        floorName: page.sheetName ?? `Page ${index + 1}`,
        level: index,
      });
      if (recognised.floor) floors.push(recognised.floor);
      allIssues.push(...recognised.issues);
      stats = recognised.stats;
    });

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
