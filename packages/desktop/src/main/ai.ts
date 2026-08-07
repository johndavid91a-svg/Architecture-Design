/**
 * Model calls.
 *
 * These live in the main process for two reasons that are not negotiable:
 * the renderer must never hold an API key, and every outbound request must
 * happen somewhere it can be logged and attributed.
 *
 * The key is read from the environment or from a file the user places in their
 * own data directory. It is never written into a project document — a project
 * file is something users copy, diff and email to each other, and a credential
 * inside one leaks the moment it is shared.
 */

import { app } from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface AiRequest {
  readonly system: string;
  readonly user: string;
  readonly maxTokens?: number;
}

export type AiResponse =
  | { readonly ok: true; readonly text: string; readonly model: string; readonly stopReason: string }
  | { readonly ok: false; readonly reason: AiFailureReason; readonly detail: string };

export type AiFailureReason =
  | 'no_api_key'
  | 'network'
  | 'rate_limited'
  | 'auth'
  | 'overloaded'
  | 'bad_response'
  | 'unknown';

/**
 * Default model.
 *
 * Design work is judgement-heavy and the calls are infrequent — a handful per
 * design, not per keystroke — so the capable model is the right default. It is
 * configurable because a user running a hundred rooms may reasonably want a
 * cheaper one for the bulk pass.
 */
const DEFAULT_MODEL = 'claude-sonnet-4-5';
const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

let cachedKey: string | null | undefined;

/**
 * Resolve the API key.
 *
 * Environment first so CI and power users can inject it, then a file in the
 * user-data directory so a desktop user has somewhere to put it that is not a
 * project file.
 */
export async function resolveApiKey(): Promise<string | null> {
  if (cachedKey !== undefined) return cachedKey;

  const fromEnv = process.env['ANTHROPIC_API_KEY']?.trim();
  if (fromEnv) {
    cachedKey = fromEnv;
    return cachedKey;
  }

  try {
    const path = join(app.getPath('userData'), 'anthropic-api-key');
    const contents = (await readFile(path, 'utf8')).trim();
    cachedKey = contents === '' ? null : contents;
  } catch {
    cachedKey = null;
  }
  return cachedKey;
}

/** Called after the user saves a key, so the next call picks it up. */
export function clearKeyCache(): void {
  cachedKey = undefined;
}

export function keyLocationHint(): string {
  return join(app.getPath('userData'), 'anthropic-api-key');
}

export async function callModel(request: AiRequest, model = DEFAULT_MODEL): Promise<AiResponse> {
  const key = await resolveApiKey();
  if (!key) {
    return {
      ok: false,
      reason: 'no_api_key',
      detail:
        'No Anthropic API key is configured. Set ANTHROPIC_API_KEY, or save the key to ' +
        `${keyLocationHint()}. The key is never written into a project file.`,
    };
  }

  let response: Response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': API_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: request.maxTokens ?? 4096,
        system: request.system,
        messages: [{ role: 'user', content: request.user }],
      }),
    });
  } catch (error) {
    return {
      ok: false,
      reason: 'network',
      detail: `Could not reach the API: ${(error as Error).message}`,
    };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const reason: AiFailureReason =
      response.status === 401 || response.status === 403
        ? 'auth'
        : response.status === 429
          ? 'rate_limited'
          : response.status === 529
            ? 'overloaded'
            : 'unknown';
    return { ok: false, reason, detail: `HTTP ${response.status}: ${body.slice(0, 400)}` };
  }

  try {
    const payload = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
      model?: string;
      stop_reason?: string;
    };
    const text = (payload.content ?? [])
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text!)
      .join('');

    if (text.trim() === '') {
      return { ok: false, reason: 'bad_response', detail: 'The response contained no text.' };
    }

    return {
      ok: true,
      text,
      model: payload.model ?? model,
      stopReason: payload.stop_reason ?? 'unknown',
    };
  } catch (error) {
    return {
      ok: false,
      reason: 'bad_response',
      detail: `Could not read the response: ${(error as Error).message}`,
    };
  }
}

export interface AiStatus {
  readonly configured: boolean;
  readonly keyLocation: string;
  readonly model: string;
}

export async function aiStatus(): Promise<AiStatus> {
  return {
    configured: (await resolveApiKey()) !== null,
    keyLocation: keyLocationHint(),
    model: DEFAULT_MODEL,
  };
}
