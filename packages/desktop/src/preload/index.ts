/**
 * Preload bridge.
 *
 * Exposes exactly six functions to the renderer. Nothing here forwards an
 * arbitrary channel name or an arbitrary path — a generic `invoke(channel, …)`
 * bridge would hand the renderer the whole main process and undo the point of
 * context isolation.
 */

import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type DesktopApi, type ExportRequest } from '../shared/ipc.js';

const api: DesktopApi = {
  saveProject: (project) => ipcRenderer.invoke(IPC.projectSave, project),
  loadProject: (id) => ipcRenderer.invoke(IPC.projectLoad, id),
  listProjects: () => ipcRenderer.invoke(IPC.projectList),
  exportCsv: (request: ExportRequest) => ipcRenderer.invoke(IPC.exportCsv, request),
  exportJson: (request: ExportRequest) => ipcRenderer.invoke(IPC.exportJson, request),
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
};

contextBridge.exposeInMainWorld('desktop', api);
