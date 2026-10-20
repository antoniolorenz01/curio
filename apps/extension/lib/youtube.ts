// YouTube support for the content script: what is being said around the current moment of the video.

export const CAPTIONS_REQUEST = 'curio:captions-request';
export const CAPTIONS_REPLY = 'curio:captions-reply';

export type CaptionsRequest = { source: typeof CAPTIONS_REQUEST; id: string; videoId: string; debug?: boolean };

/** Set from the extension's dev mode; logs each step to the page console. */
let debug = false;
export const setYoutubeDebug = (on: boolean) => {
  debug = on;
};
const log = (...args: unknown[]) => debug && console.info('[curio] youtube:', ...args);
export type CaptionsReply = { source: typeof CAPTIONS_REPLY; id: string; url: string | null };

type Segment = { startSec: number; text: string };

/** Seconds of speech before and after the current moment that make up the context. */
const WINDOW_BEFORE_SEC = 150;
const WINDOW_AFTER_SEC = 30;
const MAX_TRANSCRIPT_CHARS = 3_000;
const REQUEST_TIMEOUT_MS = 6_000;

/** Only YouTube's own caption endpoint; the page can post anything, so this is checked everywhere. */
export function isTimedtextUrl(raw: string): boolean {
  try {
    const url = new URL(raw, 'https://www.youtube.com');
    return (
      url.protocol === 'https:' &&
      ['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(url.hostname) &&
      url.pathname === '/api/timedtext'
    );
  } catch {
    return false;
  }
}

export function youtubeVideoId(href = location.href): string | null {
  try {
    const url = new URL(href);
    if (!/(^|\.)youtube\.com$/.test(url.hostname) || url.pathname !== '/watch') return null;
    return url.searchParams.get('v');
  } catch {
    return null;
  }
}

/** Asks the MAIN-world script for the caption URL the player used. */
function requestCaptionUrl(videoId: string): Promise<string | null> {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    const timer = setTimeout(() => finish(null), REQUEST_TIMEOUT_MS);
    const onMessage = (event: MessageEvent) => {
      const data = event.data as CaptionsReply | undefined;
      if (event.source !== window || data?.source !== CAPTIONS_REPLY || data.id !== id) return;
      finish(data.url && isTimedtextUrl(data.url) ? data.url : null);
    };
    const finish = (url: string | null) => {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(url);
    };
    window.addEventListener('message', onMessage);
    const request: CaptionsRequest = { source: CAPTIONS_REQUEST, id, videoId, debug };
    window.postMessage(request, location.origin);
  });
}

async function fetchSegments(captionUrl: string): Promise<Segment[]> {
  const url = new URL(captionUrl);
  url.searchParams.set('fmt', 'json3');
  url.searchParams.delete('tlang'); // the original language, not a machine translation
  const res = await fetch(url, { credentials: 'include' });
  const body = await res.text();
  if (!res.ok || body.length === 0) {
    log(`caption fetch returned ${res.status} with ${body.length} bytes (token missing or expired)`);
    return [];
  }
  const json = JSON.parse(body) as { events?: { tStartMs?: number; segs?: { utf8?: string }[] }[] };
  return (json.events ?? [])
    .map((e) => ({
      startSec: (e.tStartMs ?? 0) / 1000,
      text: (e.segs ?? []).map((s) => s.utf8 ?? '').join('').replace(/\s+/g, ' ').trim(),
    }))
    .filter((s) => s.text.length > 0);
}

function around(segments: Segment[], nowSec: number): string {
  const from = Math.max(0, nowSec - WINDOW_BEFORE_SEC);
  const to = Math.max(nowSec, WINDOW_BEFORE_SEC) + WINDOW_AFTER_SEC;
  const text = segments
    .filter((s) => s.startSec >= from && s.startSec <= to)
    .map((s) => s.text)
    .join(' ');
  return text.length > MAX_TRANSCRIPT_CHARS ? text.slice(text.length - MAX_TRANSCRIPT_CHARS) : text;
}

function videoTitle(): string {
  const heading = document.querySelector<HTMLElement>('h1.ytd-watch-metadata, ytd-watch-metadata h1, h1.title');
  return (heading?.innerText || document.title.replace(/ - YouTube$/, '')).trim();
}

function videoDescription(): string {
  const selectors = [
    'ytd-watch-metadata #description-inline-expander',
    'ytd-watch-metadata ytd-text-inline-expander',
    'ytd-watch-metadata #description',
    '#description yt-attributed-string',
    '#description',
  ];
  for (const selector of selectors) {
    const text = document.querySelector<HTMLElement>(selector)?.innerText?.replace(/\s+/g, ' ').trim();
    if (text && text.length > 20) return text.slice(0, 1_500);
  }
  // Set on the first page load; on later in-app navigations it may belong to an earlier video.
  const meta = document.querySelector<HTMLMetaElement>('meta[name="description"], meta[property="og:description"]');
  return (meta?.content ?? '').slice(0, 1_500);
}

/**
 * Title plus what is being said around the current moment. Falls back to title and description
 * when the video has no captions, never to the comments.
 */
export async function youtubeText(videoId: string): Promise<{ text: string; fromCaptions: boolean }> {
  const title = videoTitle();
  const captionUrl = await requestCaptionUrl(videoId);
  if (captionUrl) {
    try {
      const segments = await fetchSegments(captionUrl);
      const video = document.querySelector<HTMLVideoElement>('video.html5-main-video, video');
      const transcript = around(segments, video?.currentTime ?? 0);
      log(`${segments.length} caption segments, ${transcript.length} chars around ${Math.round(video?.currentTime ?? 0)}s`);
      if (transcript.length > 0) return { text: `${title}\n\n${transcript}`, fromCaptions: true };
    } catch (err) {
      log('could not read captions:', (err as Error).message);
    }
  } else {
    log('no caption URL from the page script (is it loaded? reload the tab after reloading the extension)');
  }
  const description = videoDescription();
  log(`falling back to title + description (${description.length} chars)`);
  return { text: `${title}\n\n${description}`.trim(), fromCaptions: false };
}
