import {
  isCurioMessage,
  type ContentMessage,
  type MoreResult,
  type PageMessage,
  type Result,
  type VisitResult,
} from '@/lib/messages';
import { isFeedUrl, isSensitiveUrl } from '@/lib/sensitive';
import { autoOn, defaultSettings, settingsItem, type Settings } from '@/lib/storage';
import { collectPage, MIN_SELECTION_CHARS, selectedText, selectionSnapshot } from './extract';
import { createUi } from './ui';

const AUTO_SELECTION_CHARS = 200;
const AUTO_DEBOUNCE_MS = 800;
/** Time actually spent on a page (tab visible and focused) before it counts as reading. */
const DWELL_MS = 45_000;
const DWELL_TICK_MS = 5_000;
const MIN_READING_CHARS = 600;

export default defineContentScript({
  matches: ['<all_urls>'],
  main(ctx) {
    const sendToBackground = <T = Result>(message: ContentMessage) =>
      (browser.runtime.sendMessage(message) as Promise<T | undefined>).catch(() => undefined);

    const ui = createUi({
      onBubble: () => {
        const text = selectedText();
        ui.hideBubble();
        if (text.length < MIN_SELECTION_CHARS) return;
        if (ui.hasCard()) ui.dismiss();
        void sendToBackground({ type: 'curio:request', page: selectionSnapshot(text) });
      },
      onFeedback: async (interventionId, value) =>
        (await sendToBackground({ type: 'curio:feedback', interventionId, value }))?.ok === true,
      onSave: async (interventionId) => (await sendToBackground({ type: 'curio:save', interventionId }))?.ok === true,
      onMore: async (interventionId, question) => {
        const result = await sendToBackground<MoreResult>({ type: 'curio:more', interventionId, question });
        return result?.ok ? result.text : null;
      },
    });
    ctx.onInvalidated(() => ui.destroy());

    // The background asks for page text and tells us what to show.
    browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      if (!isCurioMessage<PageMessage>(message)) return;
      switch (message.type) {
        case 'curio:collect':
          // Never replace a card the user hasn't answered with an automatic one.
          sendResponse(!message.manual && ui.hasCard() ? { ok: false, reason: 'busy' } : collectPage());
          return;
        case 'curio:loading':
          ui.showLoading();
          return;
        case 'curio:card':
          ui.showCard(message.card);
          return;
        case 'curio:note':
          ui.showNote(message.text, message.tone);
          return;
      }
    });

    if (isSensitiveUrl(location.href)) return;

    let settings: Settings = defaultSettings;
    void settingsItem.getValue().then((v) => (settings = { ...defaultSettings, ...v }));
    const unwatch = settingsItem.watch((v) => (settings = { ...defaultSettings, ...v }));
    ctx.onInvalidated(unwatch);

    let autoTimer: ReturnType<typeof setTimeout> | undefined;
    let lastAuto = '';

    const onSelectionDone = () => {
      const text = selectedText();
      const range = text.length >= MIN_SELECTION_CHARS ? window.getSelection()?.getRangeAt(0) : undefined;
      if (range && settings.selectionButton) ui.showBubble(range.getBoundingClientRect());
      else ui.hideBubble();

      clearTimeout(autoTimer);
      if (text.length < AUTO_SELECTION_CHARS || text === lastAuto || !autoOn(settings)) return;
      autoTimer = setTimeout(() => {
        if (ui.hasCard() || selectedText() !== text) return;
        lastAuto = text;
        void sendToBackground({ type: 'curio:selection', page: selectionSnapshot(text) });
      }, AUTO_DEBOUNCE_MS);
    };

    ctx.addEventListener(document, 'mouseup', (e) => {
      if (!ui.contains(e.target)) setTimeout(onSelectionDone, 0); // let the selection settle
    });
    ctx.addEventListener(document, 'keyup', (e) => {
      if (e.shiftKey || e.key === 'Shift') onSelectionDone();
    });
    ctx.addEventListener(document, 'mousedown', (e) => {
      if (!ui.contains(e.target)) ui.hideBubble();
    });
    ctx.addEventListener(window, 'scroll', () => ui.hideBubble(), { passive: true });
    ctx.onInvalidated(() => clearTimeout(autoTimer));

    // Reading detection: after a while on a page, tell the background once (it dedupes too).
    // Single-page apps like YouTube change URL without reloading, so track that as a new page.
    let dwellMs = 0;
    let lastTick = Date.now();
    let reported = '';
    let retryAt = 0;
    let asking = false;
    ctx.addEventListener(window, 'wxt:locationchange', () => {
      dwellMs = 0;
      retryAt = 0;
      ui.hideBubble();
    });
    ctx.setInterval(async () => {
      const now = Date.now();
      if (document.visibilityState === 'visible' && document.hasFocus()) dwellMs += now - lastTick;
      lastTick = now;

      const url = location.href;
      if (asking || dwellMs < DWELL_MS || now < retryAt || reported === url || !autoOn(settings) || isFeedUrl(url)) return;
      const page = collectPage();
      if (!page.ok || page.page.text.length < MIN_READING_CHARS) {
        reported = url;
        return;
      }
      asking = true;
      const result = await sendToBackground<VisitResult>({ type: 'curio:visit', url });
      asking = false;
      // During a cooldown, ask again when it ends (only if still on this page and reading).
      if (result && !result.done) retryAt = Date.now() + result.retryInSec * 1000;
      else reported = url;
    }, DWELL_TICK_MS);
  },
});
