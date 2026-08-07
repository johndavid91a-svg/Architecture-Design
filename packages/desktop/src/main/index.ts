/**
 * Electron main process.
 *
 * Security posture: the renderer runs with `nodeIntegration` off and
 * `contextIsolation` on, and reaches the filesystem only through the narrow,
 * typed surface in `preload`. That matters more here than in a typical app,
 * because a future release will parse untrusted input — uploaded drawings,
 * supplier PDFs, fetched supplier pages — and none of that should ever execute
 * with the renderer holding Node privileges.
 */

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IPC, type AppInfo, type ExportRequest, type ExportResult } from '../shared/ipc.js';
import { listProjects, loadProject, saveProject } from './storage.js';

const dirname = fileURLToPath(new URL('.', import.meta.url));

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#12161c',
    title: 'Architecture Design',
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
      const { writeFile } = await import('node:fs/promises');
      await writeFile(result.filePath, request.contents, 'utf8');
      return { saved: true, path: result.filePath };
    };

  ipcMain.handle(IPC.exportCsv, exportHandler('csv', 'CSV'));
  ipcMain.handle(IPC.exportJson, exportHandler('json', 'JSON'));
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
