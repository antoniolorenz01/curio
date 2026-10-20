import type { Feedback } from '@curio/contracts';
import { actionLabels } from '@/lib/labels';
import type { CardData } from '@/lib/messages';
import { styles } from './styles';

type Handlers = {
  onBubble: () => void;
  onFeedback: (interventionId: string, value: Feedback) => Promise<boolean>;
  onSave: (interventionId: string) => Promise<boolean>;
  /** Resolves with the answer text, or null if it failed. */
  onMore: (interventionId: string, question?: string) => Promise<string | null>;
};

const AUTO_HIDE_MS = 60_000;
const NOTE_MS = 4_000;
const THANKS_MS = 1_800;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Same mark as the toolbar icon (assets/icon.svg), built with DOM APIs (no innerHTML, Trusted Types safe). */
function mark() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'mark');
  svg.setAttribute('viewBox', '0 0 128 128');
  svg.setAttribute('aria-hidden', 'true');
  const parts: [string, Record<string, string>][] = [
    ['rect', { x: '4', y: '4', width: '120', height: '120', rx: '30', fill: '#1c1917' }],
    ['path', { d: 'M44 50 A20 20 0 1 1 72.5 68 Q64 72.5 64 82', fill: 'none', stroke: '#faf7f2', 'stroke-width': '15', 'stroke-linecap': 'round' }],
    ['circle', { cx: '64', cy: '101', r: '9', fill: '#f59e0b' }],
  ];
  for (const [tag, attrs] of parts) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    svg.append(node);
  }
  return svg;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text; // always textContent: suggestions are never parsed as HTML
  return node;
}

/** The in-page UI: a small button next to selections and one floating card in the corner. */
export function createUi(handlers: Handlers) {
  document.querySelectorAll('curio-root').forEach((n) => n.remove()); // leftover from a reloaded extension
  const host = document.createElement('curio-root');
  host.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;';
  document.documentElement.append(host);
  const root = host.attachShadow({ mode: 'closed' });
  root.append(el('style', undefined, styles));

  let bubble: HTMLButtonElement | null = null;
  let panel: HTMLElement | null = null;
  let card: CardData | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clearPanel = () => {
    clearTimeout(timer);
    panel?.remove();
    panel = null;
    card = null;
  };

  const mountPanel = (className: string) => {
    clearPanel();
    panel = el('div', className);
    panel.setAttribute('role', 'status');
    root.append(panel);
    return panel;
  };

  const compact = (text: string, tone: 'muted' | 'error' = 'muted', ms = NOTE_MS) => {
    const node = mountPanel(`panel compact${tone === 'error' ? ' error' : ''}`);
    node.textContent = text;
    timer = setTimeout(clearPanel, ms);
  };

  /** Closing without answering counts as `ignored`, which is not treated as a failure: it may just mean focus. */
  const dismiss = () => {
    if (card) void handlers.onFeedback(card.intervention.id, 'ignored');
    clearPanel();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && card) dismiss();
  };
  document.addEventListener('keydown', onKey);

  return {
    contains: (target: EventTarget | null) => target === host,
    hasCard: () => card !== null,
    dismiss,

    showBubble(rect: DOMRect) {
      bubble ??= (() => {
        const b = el('button', 'bubble');
        b.type = 'button';
        b.append(mark(), 'Curio');
        b.title = 'Suggest something about this';
        b.addEventListener('click', () => handlers.onBubble());
        root.append(b);
        return b;
      })();
      const top = Math.min(rect.bottom + 6, window.innerHeight - 34);
      const left = Math.min(Math.max(8, rect.right - 70), window.innerWidth - 90);
      bubble.style.top = `${Math.max(8, top)}px`;
      bubble.style.left = `${left}px`;
    },

    hideBubble() {
      bubble?.remove();
      bubble = null;
    },

    showLoading() {
      const node = mountPanel('panel compact');
      node.append(el('span', 'dots', 'Thinking'));
    },

    showNote(text: string, tone: 'muted' | 'error') {
      compact(text, tone);
    },

    showCard(data: CardData) {
      const node = mountPanel('panel');
      node.setAttribute('role', 'dialog');
      node.setAttribute('aria-label', 'Curio suggestion');
      card = data;

      const head = el('div', 'head');
      const close = el('button', 'close', '✕');
      close.type = 'button';
      close.setAttribute('aria-label', 'Close');
      close.addEventListener('click', dismiss);
      head.append(el('span', 'tag', actionLabels[data.intervention.action]), close);

      const actions = el('div', 'actions');
      const answer = (label: string, value: Feedback, thanks: string) => {
        const b = el('button', 'btn', label);
        b.type = 'button';
        b.addEventListener('click', async () => {
          card = null; // answered: closing now is not "ignored"
          actions.querySelectorAll('button').forEach((x) => (x.disabled = true));
          const ok = await handlers.onFeedback(data.intervention.id, value);
          compact(ok ? thanks : "Couldn't save your answer.", ok ? 'muted' : 'error', THANKS_MS);
        });
        return b;
      };
      const save = el('button', 'btn ghost', 'Save');
      save.type = 'button';
      save.title = 'Save for later';
      save.addEventListener('click', async () => {
        save.disabled = true;
        save.textContent = (await handlers.onSave(data.intervention.id)) ? 'Saved ✓' : 'Error';
      });
      actions.append(
        answer('Helpful', 'helped', 'Thanks, noted.'),
        answer('Not interested', 'not_interesting', 'Noted.'),
        answer('Distracting', 'distracted', "Noted: I'll step in less like that."),
        save,
      );

      // Automatic cards fade away on their own unless the user is looking at or using them.
      let engaged = false;
      const engage = () => {
        engaged = true;
        clearTimeout(timer);
      };

      const thread = el('div', 'thread');
      const explore = el('div', 'explore');
      const ask = async (question?: string) => {
        engage();
        const entry = el('div', 'more');
        if (question) entry.append(el('p', 'q', question));
        const answer = el('p', 'a');
        answer.append(el('span', 'dots', 'Thinking'));
        entry.append(answer);
        thread.append(entry);
        explore.querySelectorAll('button, input').forEach((x) => ((x as HTMLButtonElement).disabled = true));
        const text = await handlers.onMore(data.intervention.id, question);
        answer.textContent = text ?? "Couldn't answer right now. Try again.";
        answer.classList.toggle('failed', text === null);
        showExplore();
      };

      const showExplore = () => {
        explore.replaceChildren();
        const more = el('button', 'btn', 'Tell me more');
        more.type = 'button';
        more.addEventListener('click', () => void ask());
        const question = el('button', 'btn', 'Ask');
        question.type = 'button';
        question.addEventListener('click', showQuestion);
        explore.append(more, question);
      };

      const showQuestion = () => {
        engage();
        explore.replaceChildren();
        const form = el('form', 'ask');
        const input = el('input', 'input');
        input.placeholder = 'Ask something about this…';
        input.maxLength = 500;
        input.setAttribute('aria-label', 'Your question');
        // Keys typed here must not reach the page (e.g. YouTube's "k" or "f" shortcuts).
        for (const type of ['keydown', 'keyup', 'keypress'] as const) {
          input.addEventListener(type, (e) => {
            e.stopPropagation();
            if (type === 'keydown' && (e as KeyboardEvent).key === 'Escape') showExplore();
          });
        }
        const send = el('button', 'btn primary', 'Send');
        send.type = 'submit';
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const value = input.value.trim();
          if (value) void ask(value);
        });
        form.append(input, send);
        explore.append(form);
        input.focus();
      };
      showExplore();

      node.append(head, el('p', 'text', data.intervention.text), thread, explore, actions);

      if (data.auto) {
        const schedule = () => {
          if (engaged) return;
          clearTimeout(timer);
          timer = setTimeout(() => card === data && dismiss(), AUTO_HIDE_MS);
        };
        node.addEventListener('mouseenter', () => clearTimeout(timer));
        node.addEventListener('mouseleave', schedule);
        schedule();
      }
    },

    destroy() {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
      host.remove();
    },
  };
}
