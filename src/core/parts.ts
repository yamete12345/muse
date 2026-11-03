/**
 * Song parts ("[Verse 1: Bradley Cooper]" on Genius) lined up with the timed
 * lyrics: the lines of both sources are matched in order by word overlap,
 * and each part gets a label on its first timed line.
 */
import type { Item } from "./lrc";

export interface Section {
  kind: string;
  number: number | null;
  artists: string[];
  lines: string[];
}

export interface PartsPayload {
  key: string;
  sections: Section[];
}

export type PartsMode = "off" | "duets" | "all";

export interface PartLabel {
  text: string;
  /** Index of the singer (for a color), -1 when several or unknown. */
  voice: number;
}

/** Below this share of matched lines the two texts are too different to trust. */
const MIN_COVERAGE = 0.5;
/** Word overlap needed to call two lines the same. */
const MIN_SIMILARITY = 0.5;

const KINDS: Record<string, string> = {
  verse: "Куплет",
  chorus: "Припев",
  "pre-chorus": "Предприпев",
  "post-chorus": "Постприпев",
  bridge: "Бридж",
  intro: "Вступление",
  outro: "Концовка",
  hook: "Хук",
  "pre-hook": "Перед хуком",
  "post-hook": "После хука",
  refrain: "Рефрен",
  interlude: "Интерлюдия",
  breakdown: "Брейкдаун",
  drop: "Дроп",
  skit: "Скит",
  "spoken word": "Речитатив",
};

function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Dice coefficient over the words of two lines, 0..1. */
export function similarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const w of a) counts.set(w, (counts.get(w) ?? 0) + 1);
  let common = 0;
  for (const w of b) {
    const n = counts.get(w) ?? 0;
    if (n > 0) {
      common++;
      counts.set(w, n - 1);
    }
  }
  return (2 * common) / (a.length + b.length);
}

/**
 * For each timed line, the index of the section it belongs to, or null when
 * the texts do not line up. Order-preserving alignment (weighted LCS).
 */
export function alignSections(lines: string[], sections: Section[]): (number | null)[] | null {
  const ref: { words: string[]; section: number }[] = [];
  sections.forEach((s, i) => s.lines.forEach((l) => ref.push({ words: words(l), section: i })));
  const own = lines.map(words);
  const n = own.length;
  const m = ref.length;
  if (n === 0 || m === 0) return null;

  // best[i][j]: best total similarity matching own[i..] with ref[j..].
  const best: Float32Array[] = Array.from({ length: n + 1 }, () => new Float32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const s = similarity(own[i], ref[j].words);
      const take = s >= MIN_SIMILARITY ? s + best[i + 1][j + 1] : -1;
      best[i][j] = Math.max(take, best[i + 1][j], best[i][j + 1]);
    }
  }

  const match: (number | null)[] = new Array(n).fill(null);
  let i = 0;
  let j = 0;
  let matched = 0;
  while (i < n && j < m) {
    const s = similarity(own[i], ref[j].words);
    if (s >= MIN_SIMILARITY && Math.abs(best[i][j] - (s + best[i + 1][j + 1])) < 1e-4) {
      match[i] = ref[j].section;
      matched++;
      i++;
      j++;
    } else if (best[i + 1][j] >= best[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  const empty = own.filter((w) => w.length === 0).length;
  if (matched / Math.max(1, n - empty) < MIN_COVERAGE) return null;

  // Unmatched lines (ad-libs, split lines) belong to the part around them.
  let last: number | null = null;
  for (let k = 0; k < n; k++) {
    if (match[k] === null) match[k] = last;
    else last = match[k];
  }
  const first = match.find((x) => x !== null) ?? null;
  for (let k = 0; k < n && match[k] === null; k++) match[k] = first;
  return match;
}

function sectionName(s: Section): string {
  const kind = s.kind.trim();
  const named = KINDS[kind.toLowerCase()] ?? kind;
  return named && s.number ? `${named} ${s.number}` : named;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} и ${names[names.length - 1]}`;
}

/**
 * Labels by item index for the lyrics engine. "duets" labels only songs with
 * more than one singer; "all" also labels plain parts ("Припев").
 */
export function partLabels(items: Item[], parts: PartsPayload | null, mode: PartsMode): Map<number, PartLabel> {
  const out = new Map<number, PartLabel>();
  if (!parts || mode === "off") return out;
  const { sections } = parts;
  const singers = [...new Set(sections.flatMap((s) => s.artists))];
  if (mode === "duets" && singers.length < 2) return out;

  const lineItems = items.map((it, i) => ({ it, i })).filter((x) => x.it.kind === "line");
  const texts = lineItems.map((x) => (x.it.kind === "line" ? x.it.line.text : ""));
  const match = alignSections(texts, sections);
  if (!match) return out;

  let prev: number | null = null;
  match.forEach((section, k) => {
    if (section === null || section === prev) return;
    prev = section;
    const s = sections[section];
    const name = sectionName(s);
    const who = joinNames(s.artists);
    const text = [name, who].filter(Boolean).join(" · ");
    if (!text) return;
    out.set(lineItems[k].i, { text, voice: s.artists.length === 1 ? singers.indexOf(s.artists[0]) : -1 });
  });
  return out;
}
