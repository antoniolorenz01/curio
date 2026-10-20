import { browser, storage } from '#imports';
import type { StimulusAction, Trigger } from '@curio/contracts';
import { api, errorMessage } from './api';
import { noneNote } from './labels';
import type { CollectResult, PageMessage, PageSnapshot, PanelCardState, Result, VisitResult } from './messages';
import { isPdfResource, isPdfUrl, pdfSnapshot } from './pdf';
import { isFeedUrl, isSensitiveUrl } from './sensitive';
import { ensureSession } from './session';
import { autoOn, defaultSettings, devModeItem, panelCardItem, settingsItem, type Settings } from './storage';

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

/**
 * Shows a message in the page. Where no card can be drawn (PDF viewers, browser pages), the side
 * panel shows it instead and the toolbar icon gets a badge.
 */
async function send(tabId: number, message: PageMessage) {
  try {
    await browser.tabs.sendMessage(tabId, message);
  } catch {
    const state: PanelCardState | null =
      message.type === 'curio:loading'
        ? { kind: 'loading' }
        : message.type === 'curio:card'
          ? { kind: 'card', card: message.card }
          : message.type === 'curio:note'
            ? { kind: 'note', text: message.text, tone: message.tone }
            : null;
    if (!state) return;
    await panelCardItem.setValue(state);
    if (state.kind === 'card') await browser.action.setBadgeText({ text: '1', tabId }).catch(() => {});
  }
}

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

/** The page's text, or for PDFs (in any viewer) a part of the document read by Curio itself. */
async function readTab(tabId: number, url: string | undefined, title: string | undefined, manual: boolean) {
  if (url && isPdfUrl(url)) return pdfSnapshot(url, title);
  const read = await collect(tabId, manual);
  if (read.ok || read.reason === 'busy' || !url || !/^(https?|file):/.test(url)) return read;
  // PDFs served without a .pdf name show up as pages Curio can't read.
  return (await isPdfResource(url)) ? pdfSnapshot(url, title) : read;
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
  const read = await readTab(tab.id, tab.url, tab.title, true);
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
  const tab = await browser.tabs.get(tabId).catch(() => null);
  const read = await readTab(tabId, url, tab?.title, false);
  if (read.ok) await suggest(tabId, 'checkpoint', read.page);
  return { done: true };
}

/** Periodic look at the page being read, for automatic suggestions. */
export async function checkpoint() {
  if (!autoOn(await getSettings())) return;
  const tab = await activeTab();
  if (!tab?.id || isSensitiveUrl(tab.url)) return;
  const read = await readTab(tab.id, tab.url, tab.title, false);
  if (read.ok) await suggest(tab.id, 'checkpoint', read.page);
}

// PDF viewers run no content script, so the background measures "reading for a while" itself:
// when a PDF tab becomes active, an alarm fires after the dwell time if it's still in front.
export const PDF_VISIT_ALARM = 'curio:pdf-visit';
const pendingPdfVisit = storage.defineItem<{ tabId: number; url: string } | null>('session:pdfVisit', { fallback: null });

export async function schedulePdfVisit(tabId: number, url: string | undefined) {
  if (!url || !isPdfUrl(url) || !autoOn(await getSettings())) {
    await browser.alarms.clear(PDF_VISIT_ALARM);
    return;
  }
  const seconds = (await devModeItem.getValue()) ? 5 : 45;
  await pendingPdfVisit.setValue({ tabId, url });
  await browser.alarms.create(PDF_VISIT_ALARM, { when: Date.now() + seconds * 1000 });
}

export async function runPdfVisit() {
  const pending = await pendingPdfVisit.getValue();
  const tab = await activeTab();
  if (!pending || tab?.id !== pending.tabId || tab.url !== pending.url) return;
  const result = await visit(pending.tabId, pending.url);
  if (!result.done) await browser.alarms.create(PDF_VISIT_ALARM, { when: Date.now() + result.retryInSec * 1000 });
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
