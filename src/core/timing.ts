export interface Word {
  text: string;
  start: number;
  end: number;
  /** No space after this word (syllables of one word in Enhanced LRC). */
  glue?: boolean;
}

const VOWELS = /[aeiouyàáâãäåæèéêëìíîïòóôõöøùúûüýÿœаеёиоуыэюяіїєү]+/giu;
const CJK = /[぀-ヿ㐀-鿿가-힯]/u;

/** Rough syllable count; vowel groups work well enough for Latin and Cyrillic. */
export function syllables(word: string): number {
  const groups = word.match(VOWELS)?.length ?? 0;
  if (groups > 0) return groups;
  const digits = word.replace(/\D/g, "").length;
  return digits > 0 ? Math.min(digits, 3) : 1;
}

/** Splits a line into words; CJK text without spaces is split per character. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const w of text.trim().split(/\s+/)) {
    if (!w) continue;
    if (CJK.test(w) && w.length > 1) out.push(...Array.from(w));
    else out.push(w);
  }
  return out;
}

/**
 * Estimates per-word timings from the line's duration, proportionally to
 * syllables. The last word gets extra weight because singers tend to hold it.
 */
export function estimateWords(text: string, start: number, end: number): Word[] {
  const tokens = tokenize(text);
  if (tokens.length === 0) return [];
  const weights = tokens.map((t, i) => (syllables(t) + 0.35) * (i === tokens.length - 1 ? 1.4 : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const span = Math.max(end - start, 1);
  let t = start;
  return tokens.map((text, i) => {
    const d = (weights[i] / total) * span;
    const w = { text, start: t, end: t + d };
    t += d;
    return w;
  });
}

/** How long a line is likely sung for when the next line is far away. */
export function naturalDuration(text: string): number {
  const s = tokenize(text).reduce((a, w) => a + syllables(w), 0);
  return Math.max(2200, s * 520 + 500);
}
