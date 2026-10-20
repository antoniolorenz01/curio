export type Verdict = { ok: true } | { ok: false; reason: string };

const MIN_CHARS = 20;
const MAX_CHARS = 400;

const URL_PATTERN = /(https?:\/\/|www\.)\S+|\[[^\]]+\]\([^)]+\)/i;
const META_PATTERNS = [
  /\bas an ai\b/i,
  /\blanguage model\b/i,
  /\bmodelo de lenguaje\b/i,
  /\bcomo (una )?ia\b/i,
  /\bignore (all |the )?previous\b/i,
  /\bsystem prompt\b/i,
];

/** Lowercase, strip accents and punctuation so anchors match despite formatting. */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Length, links and meta/injection phrases. */
export function verifyShape(text: string, maxChars: number): Verdict {
  const trimmed = text.trim();
  if (trimmed.length < MIN_CHARS) return { ok: false, reason: 'too_short' };
  if (trimmed.length > maxChars) return { ok: false, reason: 'too_long' };
  if (URL_PATTERN.test(trimmed)) return { ok: false, reason: 'contains_link' };
  if (META_PATTERNS.some((p) => p.test(trimmed))) return { ok: false, reason: 'meta_or_injection' };
  return { ok: true };
}

/**
 * Rule-based verifier: shape, safety and relevance. The anchor is the key term the
 * generator says it wrote about; it must appear in the topic or the material.
 */
export function verifyIntervention(text: string, anchor: string, material: string): Verdict {
  const shape = verifyShape(text, MAX_CHARS);
  if (!shape.ok) return shape;

  const normAnchor = normalizeForMatch(anchor);
  if (normAnchor.length < 3) return { ok: false, reason: 'missing_anchor' };
  if (!normalizeForMatch(material).includes(normAnchor)) return { ok: false, reason: 'ungrounded_anchor' };

  return { ok: true };
}
