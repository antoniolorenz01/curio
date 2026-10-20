// PDFs in whatever viewer the browser uses. Viewers don't expose the current page to extensions,
// so Curio reads the whole file itself and gives ideas about its parts (chapters, or fixed-size
// sections), choosing a part it hasn't used yet each time. Nothing about the viewer changes.

import { browser, storage } from '#imports';
import type { CollectResult } from './messages';
import type { PdfExtractRequest, PdfExtractResult } from './pdf-types';

type PdfDoc = Extract<PdfExtractResult, { ok: true }>;
type Section = { title: string | null; from: number; to: number }; // 0-based, inclusive

/** Up to this size, the whole document is one part. */
const SHORT_DOC_PAGES = 20;
const SHORT_DOC_CHARS = 12_000;
const SECTION_PAGES = 8;
const EXCERPT_CHARS = 3_500;
const CACHE_SIZE = 3;

const OFFSCREEN_URL = '/offscreen.html';

const cache = new Map<string, Promise<PdfDoc | PdfExtractResult>>();
const contentTypes = new Map<string, boolean>();
/** Parts already used per document, so ideas move around the whole file. */
const usedItem = storage.defineItem<Record<string, number[]>>('session:pdfUsedSections', { fallback: {} });

const docKey = (url: string) => url.split('#')[0]!;

export function isPdfUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return /\.pdf$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** For PDFs served without a .pdf name: asks the server for the content type once per URL. */
export async function isPdfResource(url: string | undefined): Promise<boolean> {
  if (!url || !/^https?:/.test(url)) return isPdfUrl(url);
  if (isPdfUrl(url)) return true;
  const key = docKey(url);
  if (!contentTypes.has(key)) {
    const type = await fetch(key, { method: 'HEAD', credentials: 'include' })
      .then((r) => r.headers.get('content-type') ?? '')
      .catch(() => '');
    contentTypes.set(key, type.includes('application/pdf'));
  }
  return contentTypes.get(key)!;
}

async function ensureOffscreen() {
  if (await browser.offscreen.hasDocument()) return;
  await browser.offscreen
    .createDocument({
      url: OFFSCREEN_URL,
      reasons: ['WORKERS'],
      justification: 'Extract text from PDFs with pdf.js so Curio can suggest ideas about them.',
    })
    .catch((err: Error) => {
      if (!/single offscreen/i.test(err.message)) throw err; // created by a parallel call
    });
}

function load(url: string) {
  const key = docKey(url);
  if (!cache.has(key)) {
    const job = (async () => {
      await ensureOffscreen();
      const request: PdfExtractRequest = { type: 'curio:pdf-extract', url: key };
      return (await browser.runtime.sendMessage(request)) as PdfExtractResult;
    })();
    cache.set(key, job);
    job.then((r) => !r.ok && cache.delete(key), () => cache.delete(key)); // retry failures next time
    while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  }
  return cache.get(key)!;
}

function sections(doc: PdfDoc): Section[] {
  const last = doc.pages.length - 1;
  const chars = doc.pages.reduce((n, p) => n + p.length, 0);
  if (doc.pages.length <= SHORT_DOC_PAGES && chars <= SHORT_DOC_CHARS) return [{ title: null, from: 0, to: last }];

  if (doc.chapters.length >= 3) {
    return doc.chapters.map((c, i) => ({
      title: c.title,
      from: c.page,
      to: Math.max(c.page, (doc.chapters[i + 1]?.page ?? last + 1) - 1),
    }));
  }
  const out: Section[] = [];
  for (let from = 0; from <= last; from += SECTION_PAGES) {
    out.push({ title: null, from, to: Math.min(last, from + SECTION_PAGES - 1) });
  }
  return out;
}

/** A window of the section's text, starting at a sentence, so repeated parts still vary. */
function excerpt(text: string): string {
  if (text.length <= EXCERPT_CHARS) return text;
  const start = Math.floor(Math.random() * (text.length - EXCERPT_CHARS));
  const sentence = text.slice(start).search(/[.!?]\s+\S/);
  const from = sentence >= 0 && sentence < 400 ? start + sentence + 2 : start;
  return text.slice(from, from + EXCERPT_CHARS);
}

async function pickSection(key: string, all: Section[], doc: PdfDoc): Promise<Section> {
  const withText = all.map((s, i) => i).filter((i) => doc.pages.slice(all[i]!.from, all[i]!.to + 1).join('').trim());
  const used = (await usedItem.getValue())[key] ?? [];
  const fresh = withText.filter((i) => !used.includes(i));
  const pool = fresh.length > 0 ? fresh : withText;
  const index = pool[Math.floor(Math.random() * pool.length)]!;
  const record = await usedItem.getValue();
  await usedItem.setValue({ ...record, [key]: fresh.length > 0 ? [...used, index] : [index] });
  return all[index]!;
}

/** Text for one idea about the PDF at `url`. */
export async function pdfSnapshot(url: string, tabTitle?: string): Promise<CollectResult> {
  const doc = await load(url);
  if (!doc.ok) {
    if (doc.reason === 'password') return { ok: false, reason: 'This PDF is password-protected.' };
    const local = url.startsWith('file:');
    return {
      ok: false,
      reason: local
        ? 'To read PDFs from your computer, turn on "Allow access to file URLs" for Curio in the extensions page.'
        : "Couldn't open this PDF.",
    };
  }
  if (!doc.pages.some((p) => p.trim())) {
    return { ok: false, reason: 'This PDF has no text Curio can read (it may be scanned images).' };
  }

  const key = docKey(url);
  const all = sections(doc);
  const section = all.length === 1 ? all[0]! : await pickSection(key, all, doc);
  const body = doc.pages.slice(section.from, section.to + 1).join('\n\n');
  const name = doc.title || tabTitle || decodeURIComponent(new URL(key).pathname.split('/').pop() ?? 'PDF');
  const text = [name, section.title, all.length === 1 ? body.slice(0, SHORT_DOC_CHARS) : excerpt(body)]
    .filter(Boolean)
    .join('\n\n');
  return { ok: true, page: { sourceType: 'pdf', text, url: key, title: name } };
}
