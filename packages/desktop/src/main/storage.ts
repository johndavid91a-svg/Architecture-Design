/**
 * Project persistence.
 *
 * Projects are stored as one JSON document per project under the app's user-data
 * directory. JSON rather than a database, at this stage, for a specific reason:
 * the twin is the user's record of a real building, and a plain readable file
 * they can copy, diff, back up and hand to someone else is worth more than
 * query performance they do not yet need. A migration to SQLite becomes
 * worthwhile when price history and multi-project supplier data grow past what
 * is sensible to hold in memory; the interface here is deliberately small so
 * that swap does not reach the renderer.
 */

import { app } from 'electron';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectSummary } from '../shared/ipc.js';

interface StoredProject {
  readonly schemaVersion: number;
  readonly savedAt: string;
  readonly project: { readonly id: string; readonly name: string; readonly [k: string]: unknown };
}

const SCHEMA_VERSION = 1;

function projectsDir(): string {
  return join(app.getPath('userData'), 'projects');
}

/**
 * Ids are generated internally (`prj_<uuid>`) but still validated before being
 * used in a path. A project id arriving over IPC is renderer-controlled input,
 * and `../` in a filename is the cheapest path-traversal there is.
 */
function safeFileName(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    throw new Error(`Refusing to use "${id}" as a filename: unexpected characters.`);
  }
  return `${id}.json`;
}

export async function saveProject(raw: unknown): Promise<ProjectSummary> {
  const project = raw as StoredProject['project'];
  if (!project || typeof project.id !== 'string' || typeof project.name !== 'string') {
    throw new Error('Refusing to save: the payload is not a project.');
  }

  const dir = projectsDir();
  await mkdir(dir, { recursive: true });

  const savedAt = new Date().toISOString();
  const document: StoredProject = { schemaVersion: SCHEMA_VERSION, savedAt, project };
  const path = join(dir, safeFileName(project.id));
  await writeFile(path, JSON.stringify(document, null, 2), 'utf8');

  return { id: project.id, name: project.name, savedAt, path };
}

export async function loadProject(id: string): Promise<unknown | null> {
  try {
    const path = join(projectsDir(), safeFileName(id));
    const text = await readFile(path, 'utf8');
    const document = JSON.parse(text) as StoredProject;

    if (document.schemaVersion > SCHEMA_VERSION) {
      throw new Error(
        `This project was saved by a newer version of the application (schema ${document.schemaVersion}). ` +
          `Update before opening it, so nothing is silently dropped.`,
      );
    }
    return document.project;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const dir = projectsDir();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const summaries: ProjectSummary[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const path = join(dir, name);
      const document = JSON.parse(await readFile(path, 'utf8')) as StoredProject;
      summaries.push({
        id: document.project.id,
        name: document.project.name,
        savedAt: document.savedAt,
        path,
      });
    } catch {
      // A single corrupt file must not make the whole project list unopenable.
      continue;
    }
  }
  return summaries.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
