import type { EndSessionInput } from '@curio/contracts';
import { api } from './api';
import { isStale, sessionItem } from './storage';

let pending: Promise<string> | null = null;

/**
 * Sessions are implicit: the first suggestion, feedback or note starts one, and it
 * ends by itself after a while without activity. Serialized so parallel triggers share it.
 */
export function ensureSession(autoSuggest: boolean): Promise<string> {
  pending ??= (async () => {
    const now = new Date().toISOString();
    const current = await sessionItem.getValue();
    if (current && !isStale(current)) {
      await sessionItem.setValue({ ...current, lastActivityAt: now });
      return current.sessionId;
    }
    if (current) await api.endSession(current.sessionId, {}).catch(() => {});
    const created = await api.createSession({ mode: autoSuggest ? 'occasional' : 'manual' });
    await sessionItem.setValue({ sessionId: created.id, startedAt: created.startedAt, lastActivityAt: now });
    return created.id;
  })().finally(() => {
    pending = null;
  });
  return pending;
}

export async function touchSession() {
  const current = await sessionItem.getValue();
  if (current) await sessionItem.setValue({ ...current, lastActivityAt: new Date().toISOString() });
}

/** Closes the stored session if it went idle (e.g. the panel was closed for a while). */
export async function closeIfStale() {
  const current = await sessionItem.getValue();
  if (!current || !isStale(current)) return;
  await sessionItem.setValue(null);
  await api.endSession(current.sessionId, {}).catch(() => {});
}

/** Ends the session with optional ratings. Never leaves the user stuck if the server is down. */
export async function endSession(input: EndSessionInput) {
  const current = await sessionItem.getValue();
  if (!current) return;
  await sessionItem.setValue(null);
  await api.endSession(current.sessionId, input).catch(() => {});
}
