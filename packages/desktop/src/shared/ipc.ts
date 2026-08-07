/**
 * IPC contract shared between the main process and the renderer.
 *
 * Channel names are constants rather than string literals at the call sites so a
 * typo becomes a compile error instead of a handler that silently never fires.
 */

import type { Project } from '@adp/core';

export const IPC = {
  projectSave: 'project:save',
  projectLoad: 'project:load',
  projectList: 'project:list',
  exportCsv: 'export:csv',
  exportJson: 'export:json',
  appInfo: 'app:info',
} as const;

export interface ProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly savedAt: string;
  readonly path: string;
}

export interface AppInfo {
  readonly version: string;
  readonly dataDirectory: string;
  readonly electron: string;
  readonly node: string;
}

export interface ExportRequest {
  readonly suggestedName: string;
  readonly contents: string;
}

export interface ExportResult {
  readonly saved: boolean;
  readonly path?: string;
}

export interface DesktopApi {
  saveProject(project: Project): Promise<ProjectSummary>;
  loadProject(id: string): Promise<Project | null>;
  listProjects(): Promise<ProjectSummary[]>;
  exportCsv(request: ExportRequest): Promise<ExportResult>;
  exportJson(request: ExportRequest): Promise<ExportResult>;
  appInfo(): Promise<AppInfo>;
}
