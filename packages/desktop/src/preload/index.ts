/**
 * Preload bridge.
 *
 * Exposes a fixed set of named functions to the renderer. Nothing here forwards
 * an arbitrary channel name or an arbitrary path — a generic
 * `invoke(channel, …)` bridge would hand the renderer the whole main process
 * and undo the point of context isolation.
 *
 * Note what the renderer never gets: the API key. It can ask the main process
 * to make a model call, and it can ask whether a key is configured, but the key
 * itself never crosses this boundary.
 */

import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC,
  type AiCallRequest,
  type DesktopApi,
  type ExportRequest,
  type PdfRequest,
} from '../shared/ipc.js';

const api: DesktopApi = {
  saveProject: (project) => ipcRenderer.invoke(IPC.projectSave, project),
  loadProject: (id) => ipcRenderer.invoke(IPC.projectLoad, id),
  listProjects: () => ipcRenderer.invoke(IPC.projectList),
  exportCsv: (request: ExportRequest) => ipcRenderer.invoke(IPC.exportCsv, request),
  exportJson: (request: ExportRequest) => ipcRenderer.invoke(IPC.exportJson, request),
  exportPdf: (request: PdfRequest) => ipcRenderer.invoke(IPC.exportPdf, request),
  importCsv: () => ipcRenderer.invoke(IPC.importCsv),
  importDrawing: () => ipcRenderer.invoke(IPC.importDrawing),
  drawingSheets: (path: string) => ipcRenderer.invoke(IPC.drawingSheets, path),
  drawingSheet: (path: string, pageNumber: number) =>
    ipcRenderer.invoke(IPC.drawingSheet, path, pageNumber),
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  aiStatus: () => ipcRenderer.invoke(IPC.aiStatus),
  aiCall: (request: AiCallRequest) => ipcRenderer.invoke(IPC.aiCall, request),
  aiSaveKey: (key: string) => ipcRenderer.invoke(IPC.aiSaveKey, key),
};

contextBridge.exposeInMainWorld('desktop', api);
