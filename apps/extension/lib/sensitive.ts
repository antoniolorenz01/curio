// Hosts where Curio never reads content: mail, chats, accounts and banking.
const BLOCKED_HOST_PATTERNS = [
  /^mail\.google\.com$/,
  /^outlook\./,
  /(^|\.)outlook\.(com|live\.com|office\.com)$/,
  /^web\.whatsapp\.com$/,
  /^web\.telegram\.org$/,
  /(^|\.)slack\.com$/,
  /(^|\.)discord\.com$/,
  /^accounts\./,
  /^login\./,
  /(^|\.)paypal\.com$/,
  /(^|\.)mercadopago\.com/,
  /(^|\.)(bank|banco|homebanking)[^.]*\./,
];

export function isSensitiveUrl(url: string | undefined) {
  if (!url) return true;
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'http:' && protocol !== 'https:') return true;
    return BLOCKED_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
  } catch {
    return true;
  }
}

// Feeds and home pages: lots of text, but not something the user is reading.
const FEED_PATTERNS: { host: RegExp; path?: RegExp }[] = [
  { host: /(^|\.)(x|twitter|facebook|instagram|tiktok|threads)\.(com|net)$/ },
  { host: /(^|\.)linkedin\.com$/, path: /^\/(feed)?\/?$/ },
  { host: /(^|\.)youtube\.com$/, path: /^\/(feed\/.*|shorts\/.*|results)?\/?$/ },
  { host: /(^|\.)reddit\.com$/, path: /^\/(r\/[^/]+\/?)?$/ },
  { host: /^news\.google\.com$/ },
];

export function isFeedUrl(url: string) {
  try {
    const { hostname, pathname } = new URL(url);
    return FEED_PATTERNS.some((f) => f.host.test(hostname) && (!f.path || f.path.test(pathname)));
  } catch {
    return true;
  }
}

export const MAX_TEXT_CHARS = 12_000;
