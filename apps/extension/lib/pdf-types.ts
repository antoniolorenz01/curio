/** Shared between the background worker and the offscreen PDF reader. */

export type PdfChapter = { title: string; page: number }; // page is 0-based

export type PdfExtractRequest = { type: 'curio:pdf-extract'; url: string };

export type PdfExtractResult =
  | { ok: true; title: string; pages: string[]; chapters: PdfChapter[] }
  | { ok: false; reason: 'password' | 'unreadable' };
