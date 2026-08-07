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
  exportPdf: 'export:pdf',
  importCsv: 'import:csv',
  appInfo: 'app:info',
  aiStatus: 'ai:status',
  aiCall: 'ai:call',
  aiSaveKey: 'ai:save-key',
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
  readonly error?: string;
}

export interface PdfRequest {
  readonly suggestedName: string;
  /** A complete, self-contained HTML document. */
  readonly html: string;
}

export interface ImportResult {
  readonly cancelled: boolean;
  readonly filename?: string;
  readonly contents?: string;
  readonly error?: string;
}

export interface AiStatus {
  readonly configured: boolean;
  readonly keyLocation: string;
  readonly model: string;
}

export interface AiCallRequest {
  readonly system: string;
  readonly user: string;
  readonly maxTokens?: number;
}

export type AiCallResult =
  | { readonly ok: true; readonly text: string; readonly model: string; readonly stopReason: string }
  | { readonly ok: false; readonly reason: string; readonly detail: string };

export interface DesktopApi {
  saveProject(project: Project): Promise<ProjectSummary>;
  loadProject(id: string): Promise<Project | null>;
  listProjects(): Promise<ProjectSummary[]>;
  exportCsv(request: ExportRequest): Promise<ExportResult>;
  exportJson(request: ExportRequest): Promise<ExportResult>;
  exportPdf(request: PdfRequest): Promise<ExportResult>;
  importCsv(): Promise<ImportResult>;
  appInfo(): Promise<AppInfo>;
  aiStatus(): Promise<AiStatus>;
  aiCall(request: AiCallRequest): Promise<AiCallResult>;
  aiSaveKey(key: string): Promise<{ saved: boolean; error?: string }>;
}
