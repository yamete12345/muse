import { estimateWords, naturalDuration, type Word } from "./timing";

export type { Word };

export interface Line {
  start: number;
  end: number;
  text: string;
  words: Word[];
  /** True when word timings come from Enhanced LRC rather than estimation. */
  exact: boolean;
}

export type Item =
  | { kind: "line"; start: number; end: number; line: Line }
  | { kind: "gap"; start: number; end: number };

/** Pauses longer than this between lines get the "breathing dots". */
export const GAP_MS = 4500;

const TIME_TAG = /^\s*\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/;
const WORD_TAG = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;
const OFFSET_TAG = /^\[offset:\s*([+-]?\d+)\s*\]/im;

function toMs(m: string, s: string, frac?: string): number {
  const f = frac ? Number(frac.padEnd(3, "0").slice(0, 3)) : 0;
  return Number(m) * 60_000 + Number(s) * 1000 + f;
}

interface Entry {
  time: number;
  text: string;
  words: Word[] | null;
  /** Timestamp after the last word in enhanced lines, if present. */
  tail: number | null;
}

/** Joins words back into display text, honouring syllables glued together. */
export function joinWords(words: Word[]): string {
  return words.map((w) => w.text + (w.glue ? "" : " ")).join("").trim();
}

function parseWords(body: string, lineStart: number): { text: string; words: Word[] | null; tail: number | null } {
  if (!/<\d{1,3}:\d{1,2}/.test(body)) return { text: body.trim(), words: null, tail: null };

  const parts: { time: number; text: string }[] = [];
  let cursor = 0;
  let time = lineStart;
  for (const m of body.matchAll(WORD_TAG)) {
    parts.push({ time, text: body.slice(cursor, m.index) });
    time = toMs(m[1], m[2], m[3]);
    cursor = m.index! + m[0].length;
  }
  parts.push({ time, text: body.slice(cursor) });

  const words: Word[] = [];
  parts.forEach((p, i) => {
    const pieces = p.text.trim().split(/\s+/).filter(Boolean);
    if (pieces.length === 0) return;
    const next = parts[i + 1];
    const end = next?.time ?? p.time;
    const span = Math.max(end - p.time, 0);
    // "<t>Hel<t>lo" are syllables of one word: no space between them.
    const glued = !/\s$/.test(p.text) && !!next && next.text !== "" && !/^\s/.test(next.text);
    pieces.forEach((text, k) =>
      words.push({
        text,
        start: p.time + (span * k) / pieces.length,
        end: p.time + (span * (k + 1)) / pieces.length,
        glue: k === pieces.length - 1 && glued,
      }),
    );
  });
  const last = parts[parts.length - 1];
  const tail = last.text.trim() === "" ? last.time : null;
  return { text: joinWords(words), words: words.length ? words : null, tail };
}

export function parseLrc(source: string): Line[] {
  const offset = Number(source.match(OFFSET_TAG)?.[1] ?? 0);
  const entries: Entry[] = [];

  for (const raw of source.split(/\r?\n/)) {
    const times: number[] = [];
    let rest = raw;
    // Leading timestamps; a line may carry several ("[00:12.00][01:30.00]chorus").
    for (;;) {
      const m = TIME_TAG.exec(rest);
      if (!m) break;
      times.push(toMs(m[1], m[2], m[3]) - offset);
      rest = rest.slice(m[0].length);
    }
    if (times.length === 0) continue;
    for (const time of times) {
      const { text, words, tail } = parseWords(rest, time);
      entries.push({ time, text, words, tail });
    }
  }
  entries.sort((a, b) => a.time - b.time);

  const lines: Line[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e.text) continue;
    const next = entries[i + 1]?.time ?? Infinity;
    const start = Math.max(0, e.time);
    if (e.words) {
      const lastEnd = e.tail ?? Math.min(next, e.words[e.words.length - 1].start + 800);
      const words = e.words.map((w, k) => (k === e.words!.length - 1 && w.end <= w.start ? { ...w, end: lastEnd } : w));
      lines.push({ start, end: Math.max(lastEnd, words[words.length - 1].end), text: e.text, words, exact: true });
      continue;
    }
    const gap = next - start;
    const end = gap <= 6000 ? start + gap * 0.92 : start + Math.min(gap - 300, naturalDuration(e.text));
    lines.push({ start, end, text: e.text, words: estimateWords(e.text, start, end), exact: false });
  }
  return lines;
}

/** Interleaves lines with gap items for long instrumental pauses. */
export function buildItems(lines: Line[]): Item[] {
  const items: Item[] = [];
  if (lines.length && lines[0].start > GAP_MS) items.push({ kind: "gap", start: 0, end: lines[0].start });
  lines.forEach((line, i) => {
    items.push({ kind: "line", start: line.start, end: line.end, line });
    const next = lines[i + 1];
    if (next) {
      const gapStart = line.end + 300;
      if (next.start - gapStart > GAP_MS) items.push({ kind: "gap", start: gapStart, end: next.start });
    }
  });
  return items;
}
