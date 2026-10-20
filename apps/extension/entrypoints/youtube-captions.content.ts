// Runs in YouTube's own page context (MAIN world), before the player loads.
//
// YouTube only serves captions to requests that carry a token minted by its player, so a plain
// fetch of the caption track returns an empty body. Instead, this script notices the caption
// requests the player itself makes and hands their URLs to Curio's content script.
// If captions are off, it switches them on for a moment so the player makes that request.

import { CAPTIONS_REPLY, CAPTIONS_REQUEST, isTimedtextUrl, type CaptionsReply, type CaptionsRequest } from '@/lib/youtube';

type Player = HTMLElement & {
  getOption?: (module: string, option: string) => unknown;
  loadModule?: (module: string) => void;
  unloadModule?: (module: string) => void;
};

const WAIT_FOR_PLAYER_MS = 4_000;

export default defineContentScript({
  matches: ['*://www.youtube.com/*', '*://m.youtube.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    const captured = new Map<string, string>(); // video id → caption URL with the player's token

    const record = (raw: unknown) => {
      const url = String(raw);
      if (!isTimedtextUrl(url)) return;
      const videoId = new URL(url, location.origin).searchParams.get('v');
      if (videoId) captured.set(videoId, new URL(url, location.origin).toString());
    };

    const originalFetch = window.fetch;
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
      record(input instanceof Request ? input.url : input);
      return originalFetch.call(this, input, init);
    };
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
      record(url);
      return (originalOpen as (...args: unknown[]) => void).call(this, method, url, ...rest);
    } as typeof XMLHttpRequest.prototype.open;

    // Requests made before this script ran, or through paths not wrapped above, still show up here.
    const fromResourceTiming = (videoId: string) => {
      for (const entry of performance.getEntriesByType('resource')) {
        if (isTimedtextUrl(entry.name) && new URL(entry.name).searchParams.get('v') === videoId) record(entry.name);
      }
      return captured.get(videoId) ?? null;
    };

    const waitFor = async (videoId: string, ms: number) => {
      const until = Date.now() + ms;
      while (!captured.has(videoId) && !fromResourceTiming(videoId) && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 150));
      }
      return captured.get(videoId) ?? null;
    };

    const captionsOn = (player: Player) => {
      const track = player.getOption?.('captions', 'track');
      return !!track && typeof track === 'object' && Object.keys(track).length > 0;
    };

    async function captionUrl(videoId: string, debug: boolean): Promise<string | null> {
      const log = (...args: unknown[]) => debug && console.info('[curio] captions:', ...args);
      if (captured.has(videoId) || fromResourceTiming(videoId)) {
        log('already captured for', videoId);
        return captured.get(videoId)!;
      }
      const player = document.getElementById('movie_player') as Player | null;
      if (!player?.loadModule) {
        log('player API not found');
        return null;
      }

      const wasOn = captionsOn(player);
      log(wasOn ? 'captions already on, waiting for the player request' : 'turning captions on briefly');
      if (!wasOn) player.loadModule('captions');
      const url = await waitFor(videoId, WAIT_FOR_PLAYER_MS);
      if (!wasOn) player.unloadModule?.('captions'); // leave the user's caption setting as it was
      log(url ? 'captured caption request' : 'no caption request seen (no captions for this video, or an ad is playing)');
      return url;
    }

    window.addEventListener('message', (event) => {
      const data = event.data as CaptionsRequest | undefined;
      if (event.source !== window || data?.source !== CAPTIONS_REQUEST || typeof data.videoId !== 'string') return;
      void captionUrl(data.videoId, data.debug === true).then((url) => {
        const reply: CaptionsReply = { source: CAPTIONS_REPLY, id: data.id, url };
        window.postMessage(reply, location.origin);
      });
    });
  },
});
