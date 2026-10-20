import type { CollectResult, PageSnapshot } from '@/lib/messages';
import { isSensitiveUrl, MAX_TEXT_CHARS } from '@/lib/sensitive';
import { youtubeText, youtubeVideoId } from '@/lib/youtube';

export const MIN_SELECTION_CHARS = 40;
const MIN_PAGE_CHARS = 200;

const clean = (value: string) =>
  value
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT_CHARS);

/** Selected text, unless it's inside something the user is typing. */
export function selectedText(): string {
  const selection = window.getSelection();
  const anchor = selection?.anchorNode?.parentElement;
  if (anchor?.closest('input, textarea, [contenteditable=""], [contenteditable="true"]')) return '';
  if (document.activeElement instanceof HTMLInputElement && document.activeElement.type === 'password') return '';
  return clean(selection?.toString() ?? '');
}

export function selectionSnapshot(text: string): PageSnapshot {
  return { sourceType: 'selection', text, url: location.href, title: document.title };
}

/** The selection if there is one; on a YouTube video, what is being said now; otherwise the page's main text. */
export async function collectPage(): Promise<CollectResult> {
  if (isSensitiveUrl(location.href)) return { ok: false, reason: "This page isn't read (private or a browser page)." };

  const selection = selectedText();
  if (selection.length >= MIN_SELECTION_CHARS) return { ok: true, page: selectionSnapshot(selection) };

  const videoId = youtubeVideoId();
  if (videoId) {
    const { text } = await youtubeText(videoId);
    if (text.length < MIN_SELECTION_CHARS) return { ok: false, reason: 'Not enough to go on for this video yet.' };
    return { ok: true, page: { sourceType: 'video', text: clean(text), url: location.href, title: document.title } };
  }

  const root =
    document.querySelector<HTMLElement>('article') ??
    document.querySelector<HTMLElement>('main, [role="main"]') ??
    document.body;
  const text = clean(root?.innerText ?? '');
  if (text.length < MIN_PAGE_CHARS) return { ok: false, reason: 'Not enough text on this page.' };
  return { ok: true, page: { sourceType: 'web', text, url: location.href, title: document.title } };
}
