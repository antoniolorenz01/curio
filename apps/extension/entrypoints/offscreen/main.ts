// Hidden document that extracts text from PDFs with pdf.js. The background worker can't run
// pdf.js itself (no workers or DOM there), so it opens this page with the offscreen API.

import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { isCurioMessage } from '@/lib/messages';
import type { PdfChapter, PdfExtractRequest, PdfExtractResult } from '@/lib/pdf-types';

GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_PAGES = 1_500;
const MAX_PAGE_CHARS = 6_000;

browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse: (r: PdfExtractResult) => void) => {
  if (!isCurioMessage<PdfExtractRequest>(message) || message.type !== 'curio:pdf-extract') return;
  extract(message.url).then(sendResponse, (err: Error) =>
    sendResponse({ ok: false, reason: err.name === 'PasswordException' ? 'password' : 'unreadable' }),
  );
  return true; // async reply
});

async function extract(url: string): Promise<PdfExtractResult> {
  const task = getDocument({ url, withCredentials: true });
  const pdf = await task.promise;
  try {
    const pages: string[] = [];
    for (let n = 1; n <= Math.min(pdf.numPages, MAX_PAGES); n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
        .join('')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      pages.push(text.slice(0, MAX_PAGE_CHARS));
      page.cleanup();
    }
    const meta = await pdf.getMetadata().catch(() => null);
    const info = meta?.info as { Title?: unknown } | undefined;
    return {
      ok: true,
      title: typeof info?.Title === 'string' ? info.Title.trim() : '',
      pages,
      chapters: await chapters(pdf),
    };
  } finally {
    await task.destroy();
  }
}

/** Table of contents (two levels) with the page each entry starts on, in reading order. */
async function chapters(pdf: PDFDocumentProxy): Promise<PdfChapter[]> {
  const outline = await pdf.getOutline().catch(() => null);
  if (!outline) return [];
  const flat = outline.flatMap((entry) => [entry, ...(entry.items ?? [])]);
  const out: PdfChapter[] = [];
  for (const entry of flat) {
    try {
      const dest = typeof entry.dest === 'string' ? await pdf.getDestination(entry.dest) : entry.dest;
      const ref = dest?.[0];
      if (ref == null) continue;
      const page = typeof ref === 'number' ? ref : await pdf.getPageIndex(ref);
      const title = String(entry.title ?? '').trim();
      if (title) out.push({ title, page });
    } catch {
      // entries pointing outside the document are skipped
    }
  }
  return out.sort((a, b) => a.page - b.page).filter((c, i, all) => i === 0 || c.page !== all[i - 1]!.page);
}
