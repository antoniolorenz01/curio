import { storage } from '#imports';

export type Settings = {
  apiUrl: string;
  /** Only needed when the API runs somewhere other than this computer. */
  apiToken: string;
  /** Occasional suggestions while reading. Off by default; turning it on asks for consent once. */
  autoSuggest: boolean;
  autoConsent: boolean;
  /** Small "Curio" button next to selected text. */
  selectionButton: boolean;
  checkpointMin: number;
};

export type ActiveSession = {
  sessionId: string;
  startedAt: string;
  lastActivityAt: string;
};

export const defaultSettings: Settings = {
  apiUrl: 'http://localhost:8787',
  apiToken: '',
  autoSuggest: false,
  autoConsent: false,
  selectionButton: true,
  checkpointMin: 10,
};

/** A session ends on its own after this long without activity. */
export const SESSION_IDLE_MS = 30 * 60_000;

export const settingsItem = storage.defineItem<Settings>('local:settings', {
  fallback: defaultSettings,
});

/** Mirrors the API's CURIO_DEV flag: shorter timers and no per-page dedupe while developing. */
export const devModeItem = storage.defineItem<boolean>('local:devMode', { fallback: false });

export const sessionItem = storage.defineItem<ActiveSession | null>('local:session', {
  fallback: null,
});

export async function updateSettings(patch: Partial<Settings>) {
  const current = await settingsItem.getValue();
  await settingsItem.setValue({ ...defaultSettings, ...current, ...patch });
}

export const autoOn = (s: Settings) => s.autoSuggest && s.autoConsent;

export const isStale = (session: ActiveSession, now = Date.now()) => {
  const last = Date.parse(session.lastActivityAt);
  return !Number.isFinite(last) || now - last > SESSION_IDLE_MS;
};
