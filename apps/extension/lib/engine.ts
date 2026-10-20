import { browser, storage } from '#imports';
import type { StimulusAction, Trigger } from '@curio/contracts';
import { api, errorMessage } from './api';
import { noneNote } from './labels';
import type { CollectResult, PageMessage, PageSnapshot, Result, VisitResult } from './messages';
import { isFeedUrl, isSensitiveUrl } from './sensitive';
import { ensureSession } from './session';
import { autoOn, defaultSettings, devModeItem, settingsItem, type Settings } from './storage';

// Runs in the background service worker: the suggestion flow lives here so it works
// on any page without the side panel open.

const inFlight = new Set<number>();

/** Asks the API whether it runs in development mode and stores the answer for every part of the extension. */
export async function refreshDevMode() {
  const dev = await api.health().then((h) => h.dev === true, () => null);
  if (dev !== null && dev !== (await devModeItem.getValue())) await devModeItem.setValue(dev);
}

export async function getSettings(): Promise<Settings> {
  return { ...defaultSettings, ...(await settingsItem.getValue()) };
}

const send = (tabId: number, message: PageMessage) => browser.tabs.sendMessage(tabId, message).catch(() => {});

/** context → decision → card in the page. Automatic triggers fail silently. */
export async function suggest(tabId: number, trigger: Trigger, page: PageSnapshot, requestedAction?: StimulusAction) {
  const manual = trigger === 'manual';
  const settings = await getSettings();
  if (!manual && !autoOn(settings)) return;
  if (inFlight.has(tabId)) {
    // An automatic suggestion is being written for this tab; say so instead of doing nothing.
    if (manual) await send(tabId, { type: 'curio:note', text: 'Still working on an idea for this page…', tone: 'muted' });
    return;
  }

  inFlight.add(tabId);
  if (manual) await send(tabId, { type: 'curio:loading' });
  try {
    const sessionId = await ensureSession(autoOn(settings));
    // Cheap check first: during the cooldown the page isn't sent or condensed at all.
    if (!manual && !(await api.autoStatus(sessionId)).allowed) return;
    const context = await api.postContext({
      sessionId,
      sourceType: page.sourceType,
      url: page.url,
      title: page.title || undefined,
      text: page.text,
    });
    const result = await api.decide({
      sessionId,
      contextId: context.contextId,
      trigger,
      mode: autoOn(settings) ? 'occasional' : 'manual',
      paused: false,
      requestedAction,
    });
    if (result.intervention) {
      await send(tabId, { type: 'curio:card', card: { intervention: result.intervention, topic: context.topic, auto: !manual } });
    } else if (manual) {
      await send(tabId, { type: 'curio:note', text: noneNote(result.decision.reasonCode), tone: 'muted' });
    }
  } catch (err) {
    if (manual) await send(tabId, { type: 'curio:note', text: errorMessage(err), tone: 'error' });
  } finally {
    inFlight.delete(tabId);
  }
}

/** Asks the page for its text. Tabs opened before the extension loaded get the script injected. */
async function collect(tabId: number, manual: boolean): Promise<CollectResult> {
  const ask = () => browser.tabs.sendMessage(tabId, { type: 'curio:collect', manual } satisfies PageMessage) as Promise<CollectResult>;
  try {
    return await ask();
  } catch {
    if (!manual) return { ok: false, reason: 'no_content_script' };
    try {
      await browser.scripting.executeScript({ target: { tabId }, files: ['/content-scripts/content.js'] });
      return await ask();
    } catch {
      return { ok: false, reason: "Curio can't run on this page." };
    }
  }
}

async function activeTab() {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id ? tab : null;
}

/** Manual request from the side panel or the keyboard shortcut. */
export async function suggestOnActiveTab(requestedAction?: StimulusAction): Promise<Result> {
  const tab = await activeTab();
  if (!tab?.id) return { ok: false, reason: 'No active tab.' };
  if (isSensitiveUrl(tab.url)) return { ok: false, reason: "This page isn't read (private or a browser page)." };
  const read = await collect(tab.id, true);
  if (!read.ok) return read;
  void suggest(tab.id, 'manual', read.page, requestedAction);
  return { ok: true };
}

const visitedItem = storage.defineItem<string[]>('session:visited', { fallback: [] });

/**
 * A page the user stayed on: evaluated once per URL per browser session. If a suggestion
 * can't happen yet (cooldown), the page isn't marked and the content script asks again later.
 */
export async function visit(tabId: number, url: string): Promise<VisitResult> {
  if (!autoOn(await getSettings()) || isSensitiveUrl(url) || isFeedUrl(url)) return { done: true };
  const key = url.split('#')[0]!;
  const dev = await devModeItem.getValue();
  if (!dev && (await visitedItem.getValue()).includes(key)) return { done: true };

  const status = await api.autoStatus(await ensureSession(true));
  if (!status.allowed) {
    return status.reason === 'cooldown' ? { done: false, retryInSec: Math.max(30, status.retryInSec ?? 60) } : { done: true };
  }

  await visitedItem.setValue([...(await visitedItem.getValue()).slice(-299), key]);
  const read = await collect(tabId, false);
  if (read.ok) await suggest(tabId, 'checkpoint', read.page);
  return { done: true };
}

/** Periodic look at the page being read, for automatic suggestions. */
export async function checkpoint() {
  if (!autoOn(await getSettings())) return;
  const tab = await activeTab();
  if (!tab?.id || isSensitiveUrl(tab.url)) return;
  const read = await collect(tab.id, false);
  if (read.ok) await suggest(tab.id, 'checkpoint', read.page);
}

export const CHECKPOINT_ALARM = 'curio:checkpoint';

export async function syncCheckpointAlarm() {
  const settings = await getSettings();
  if (autoOn(settings)) {
    const existing = await browser.alarms.get(CHECKPOINT_ALARM);
    const period = (await devModeItem.getValue()) ? 1 : Math.max(1, settings.checkpointMin);
    if (existing?.periodInMinutes !== period) {
      await browser.alarms.create(CHECKPOINT_ALARM, { periodInMinutes: period });
    }
  } else {
    await browser.alarms.clear(CHECKPOINT_ALARM);
  }
}
