/**
 * Electron main process.
 *
 * Security posture: the renderer runs with `nodeIntegration` off and
 * `contextIsolation` on, and reaches the filesystem, the network and the API
 * key only through the narrow, typed surface in `preload`. That matters more
 * here than in a typical app, because this product parses untrusted input —
 * uploaded price lists, and in future drawings and supplier PDFs — and none of
 * that should ever execute with the renderer holding Node privileges.
 */

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import {
  IPC,
  type AiCallRequest,
  type AppInfo,
  type DrawingImport,
  type ExportRequest,
  type ExportResult,
  type ImportResult,
  type PdfRequest,
} from '../shared/ipc.js';
import { listProjects, loadProject, saveProject } from './storage.js';
import { aiStatus, callModel, clearKeyCache, keyLocationHint } from './ai.js';
import { importDrawingFile } from './drawing-import.js';

const dirname = fileURLToPath(new URL('.', import.meta.url));

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    backgroundColor: '#12161c',
    title: 'Architecture Design',
    // Windows and macOS take the icon from the packaged bundle, but Linux reads
    // it from the running window, so a packaged Linux build shows a blank
    // placeholder in the task bar without this. Harmless on the other two.
    icon: join(dirname, '../../build/icons/512x512.png'),
    webPreferences: {
      // `.js`, not `.mjs`: this package is CommonJS, so electron-vite emits a
      // `.js` preload. If a "type": "module" is ever added, this becomes `.mjs`
      // and the preload silently fails to load.
      preload: join(dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.on('ready-to-show', () => window.show());

  // External links open in the user's browser, never inside the app frame. The
  // pricing UI links out to source pages, and those pages are untrusted.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(dirname, '../renderer/index.html'));
  }

  return window;
}

/**
 * Render an HTML document to PDF in an offscreen window.
 *
 * Electron's own print pipeline is used rather than a PDF library so that the
 * exported document is the same rendering the user was shown. A separate PDF
 * generator would be a second layout engine to keep in agreement with the
 * first, and it would drift.
 */
async function renderPdf(html: string): Promise<Buffer> {
  const worker = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, javascript: false, images: true },
  });
  try {
    // A data URL rather than a temporary file: nothing touches disk, and the
    // document inherits no file:// origin it could read the filesystem from.
    await worker.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return await worker.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'default' },
    });
  } finally {
    worker.destroy();
  }
}

function registerHandlers(): void {
  ipcMain.handle(IPC.projectSave, async (_event, project: unknown) => saveProject(project));
  ipcMain.handle(IPC.projectLoad, async (_event, id: string) => loadProject(id));
  ipcMain.handle(IPC.projectList, async () => listProjects());

  ipcMain.handle(IPC.appInfo, async (): Promise<AppInfo> => {
    return {
      version: app.getVersion(),
      dataDirectory: app.getPath('userData'),
      electron: process.versions.electron ?? 'unknown',
      node: process.versions.node,
    };
  });

  const exportHandler =
    (extension: string, filterName: string) =>
    async (event: Electron.IpcMainInvokeEvent, request: ExportRequest): Promise<ExportResult> => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showSaveDialog(window ?? undefined!, {
        defaultPath: request.suggestedName,
        filters: [{ name: filterName, extensions: [extension] }],
      });
      if (result.canceled || !result.filePath) return { saved: false };
      try {
        await writeFile(result.filePath, request.contents, 'utf8');
        return { saved: true, path: result.filePath };
      } catch (error) {
        return { saved: false, error: (error as Error).message };
      }
    };

  ipcMain.handle(IPC.exportCsv, exportHandler('csv', 'CSV'));
  ipcMain.handle(IPC.exportJson, exportHandler('json', 'JSON'));

  ipcMain.handle(
    IPC.exportPdf,
    async (event, request: PdfRequest): Promise<ExportResult> => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showSaveDialog(window ?? undefined!, {
        defaultPath: request.suggestedName,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (result.canceled || !result.filePath) return { saved: false };
      try {
        const pdf = await renderPdf(request.html);
        await writeFile(result.filePath, pdf);
        return { saved: true, path: result.filePath };
      } catch (error) {
        return { saved: false, error: (error as Error).message };
      }
    },
  );

  ipcMain.handle(IPC.importCsv, async (event): Promise<ImportResult> => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(window ?? undefined!, {
      properties: ['openFile'],
      filters: [{ name: 'Price list', extensions: ['csv', 'txt'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return { cancelled: true };
    try {
      const path = result.filePaths[0]!;
      const { readFile } = await import('node:fs/promises');
      const contents = await readFile(path, 'utf8');
      // Bounded so a mis-selected multi-gigabyte file cannot exhaust memory in
      // the renderer that receives it.
      if (contents.length > 8_000_000) {
        return { cancelled: false, error: 'That file is larger than 8 MB. Split it before importing.' };
      }
      return { cancelled: false, filename: path, contents };
    } catch (error) {
      return { cancelled: false, error: (error as Error).message };
    }
  });

  ipcMain.handle(IPC.importDrawing, async (event): Promise<DrawingImport> => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(window ?? undefined!, {
      properties: ['openFile'],
      filters: [
        { name: 'Architectural drawing', extensions: ['ifc', 'dxf', 'pdf'] },
        { name: 'IFC / BIM model', extensions: ['ifc'] },
        { name: 'DXF drawing', extensions: ['dxf'] },
        { name: 'PDF drawing', extensions: ['pdf'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return { cancelled: true };

    try {
      const payload = await importDrawingFile(result.filePaths[0]!);
      return {
        cancelled: false,
        ok: payload.ok,
        filename: payload.filename,
        format: payload.format,
        floors: payload.floors as unknown[],
        units: payload.units,
        issues: payload.issues as unknown[],
        stats: payload.stats,
        schema: payload.schema,
        needsCalibration: payload.needsCalibration,
        pageCount: payload.pageCount,
      };
    } catch (error) {
      return { cancelled: false, ok: false, error: (error as Error).message };
    }
  });

  // ---- AI ---------------------------------------------------------------
  ipcMain.handle(IPC.aiStatus, async () => aiStatus());

  ipcMain.handle(IPC.aiCall, async (_event, request: AiCallRequest) => {
    const response = await callModel(request);
    return response.ok
      ? { ok: true as const, text: response.text, model: response.model, stopReason: response.stopReason }
      : { ok: false as const, reason: response.reason, detail: response.detail };
  });

  ipcMain.handle(IPC.aiSaveKey, async (_event, key: string) => {
    try {
      // Written to the user-data directory, never into a project document —
      // project files get copied and emailed, and a credential inside one leaks
      // the moment it is shared.
      await writeFile(keyLocationHint(), String(key).trim(), { encoding: 'utf8', mode: 0o600 });
      clearKeyCache();
      return { saved: true };
    } catch (error) {
      return { saved: false, error: (error as Error).message };
    }
  });
}

void app.whenReady().then(() => {
  registerHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
