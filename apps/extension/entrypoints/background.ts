import { api, errorMessage } from '@/lib/api';
import { CHECKPOINT_ALARM, checkpoint, suggest, suggestOnActiveTab, syncCheckpointAlarm, visit } from '@/lib/engine';
import {
  isCurioMessage,
  type ContentMessage,
  type MoreResult,
  type PanelMessage,
  type Result,
  type VisitResult,
} from '@/lib/messages';
import { touchSession } from '@/lib/session';
import { settingsItem } from '@/lib/storage';

export default defineBackground(() => {
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

  void syncCheckpointAlarm();
  settingsItem.watch(() => void syncCheckpointAlarm());
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === CHECKPOINT_ALARM) void checkpoint();
  });

  browser.commands.onCommand.addListener((command) => {
    if (command === 'suggest') void suggestOnActiveTab();
  });

  // sendResponse + `return true` keeps the channel open for async replies in every Chromium.
  type Reply = Result | MoreResult | VisitResult;
  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse: (r: Reply) => void) => {
    if (!isCurioMessage<ContentMessage | PanelMessage>(message)) return;
    const tabId = sender.tab?.id;
    const reply = (work: Promise<unknown>) => {
      work.then(
        (r) => sendResponse(isResult(r) ? r : { ok: true }),
        (err: Error) => sendResponse({ ok: false, reason: err.message }),
      );
      return true;
    };

    switch (message.type) {
      case 'curio:request-active':
        return reply(suggestOnActiveTab(message.requestedAction));
      case 'curio:selection':
        if (tabId !== undefined) void suggest(tabId, 'selection', message.page);
        return;
      case 'curio:request':
        if (tabId !== undefined) void suggest(tabId, 'manual', message.page);
        return;
      case 'curio:visit':
        if (tabId === undefined) return;
        visit(tabId, message.url).then(sendResponse, () => sendResponse({ done: true }));
        return true;
      case 'curio:feedback':
        return reply(api.feedback({ interventionId: message.interventionId, value: message.value }).then(touchSession));
      case 'curio:save':
        return reply(api.save(message.interventionId));
      case 'curio:more':
        api.more(message.interventionId, message.question).then(
          ({ text }) => sendResponse({ ok: true, text }),
          (err) => sendResponse({ ok: false, reason: errorMessage(err) }),
        );
        return true;
    }
  });
});

const isResult = (value: unknown): value is Result =>
  typeof value === 'object' && value !== null && typeof (value as { ok?: unknown }).ok === 'boolean';
