/**
 * Latin letters for Japanese and Korean lyrics.
 *
 *  - Japanese: kanji readings come from kuromoji (a Japanese word splitter);
 *    its dictionary (~12 MB) is fetched once, only when a Japanese song shows
 *    up, and then served from the cache. Kana become Hepburn romaji.
 *  - Korean: Hangul syllables, Revised Romanization with the common linking.
 */

const KANA = /[぀-ヿㇰ-ㇿｦ-ﾟ]/;
const HANGUL = /[가-힣]/;
const KANJI = /[一-鿿㐀-䶿々〆]/;
const DICT = "https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/";

const isKana = (c: string) => KANA.test(c);
const isHangul = (c: string) => HANGUL.test(c);
const isJapanese = (c: string) => isKana(c) || KANJI.test(c);

/** Worth romanizing: kana somewhere (kanji alone is more likely Chinese), or Hangul. */
export function wantsRomaji(lines: string[]): boolean {
  return lines.some((l) => KANA.test(l) || HANGUL.test(l));
}

// ---- Kana ------------------------------------------------------------------

const MONO: Record<string, string> = {};
(
  "あa いi うu えe おo かka きki くku けke こko さsa しshi すsu せse そso たta ちchi つtsu てte とto " +
  "なna にni ぬnu ねne のno はha ひhi ふfu へhe ほho まma みmi むmu めme もmo やya ゆyu よyo " +
  "らra りri るru れre ろro わwa ゐi ゑe をo んn がga ぎgi ぐgu げge ごgo ざza じji ずzu ぜze ぞzo " +
  "だda ぢji づzu でde どdo ばba びbi ぶbu べbe ぼbo ぱpa ぴpi ぷpu ぺpe ぽpo ゔvu " +
  "ぁa ぃi ぅu ぇe ぉo ゃya ゅyu ょyo ゎwa"
)
  .split(" ")
  .forEach((p) => (MONO[p[0]] = p.slice(1)));

const DI: Record<string, string> = {};
(
  "きゃkya きゅkyu きょkyo しゃsha しゅshu しょsho ちゃcha ちゅchu ちょcho にゃnya にゅnyu にょnyo " +
  "ひゃhya ひゅhyu ひょhyo みゃmya みゅmyu みょmyo りゃrya りゅryu りょryo ぎゃgya ぎゅgyu ぎょgyo " +
  "じゃja じゅju じょjo びゃbya びゅbyu びょbyo ぴゃpya ぴゅpyu ぴょpyo てぃti でぃdi ふぁfa ふぃfi " +
  "ふぇfe ふぉfo うぃwi うぇwe うぉwo しぇshe ちぇche じぇje ゔぁva とぅtu どぅdu"
)
  .split(" ")
  .forEach((p) => (DI[p.slice(0, 2)] = p.slice(2)));

/** Katakana to hiragana, so one table covers both. */
const toHiragana = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

export function kanaToRomaji(text: string): string {
  const chars = Array.from(toHiragana(text));
  let out = "";
  let double = false;
  for (let i = 0; i < chars.length; ) {
    const c = chars[i];
    if (c === "っ") {
      double = true;
      i++;
      continue;
    }
    if (c === "ー") {
      // Long vowel mark: repeat the last vowel.
      const v = out.slice(-1);
      if ("aeiou".includes(v) && v) out += v;
      i++;
      continue;
    }
    const pair = chars.slice(i, i + 2).join("");
    let r: string;
    let used = 1;
    if (DI[pair]) {
      r = DI[pair];
      used = 2;
    } else r = MONO[c] ?? c;
    if (double) {
      double = false;
      const f = r[0];
      if (f === "c") out += "t";
      else if (f && /[a-z]/.test(f) && !"aeiou".includes(f)) out += f;
    }
    // ん before a vowel or y reads apart: ren'ai.
    if (i > 0 && chars[i - 1] === "ん" && c !== "ん" && /^[aiueoy]/.test(r)) out += "'";
    out += r;
    i += used;
  }
  return out;
}

// ---- Hangul ----------------------------------------------------------------

const INITIALS = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"];
const VOWELS = ["a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i"];
/** A final consonant as heard at the end of a syllable. */
const FINALS = ["", "k", "k", "k", "n", "n", "n", "t", "l", "k", "m", "l", "l", "l", "p", "l", "m", "p", "p", "t", "t", "ng", "t", "t", "k", "t", "p", "t"];
/** The sound a final carries over when the next syllable starts with ㅇ. */
const LIAISON = ["", "g", "kk", "ks", "n", "nj", "nh", "d", "r", "lg", "lm", "lb", "ls", "lt", "lp", "lh", "m", "b", "bs", "s", "ss", "ng", "j", "ch", "k", "t", "p", "h"];

export function hangulToLatin(run: string): string {
  const syl = Array.from(run).map((c) => {
    const n = c.charCodeAt(0) - 0xac00;
    return [Math.floor(n / 588), Math.floor((n % 588) / 28), n % 28] as const;
  });
  let out = "";
  syl.forEach(([ini, vow, fin], i) => {
    const prevFin = i > 0 ? syl[i - 1][2] : 0;
    out += ini === 11 ? "" : ini === 5 && prevFin === 8 ? "l" : INITIALS[ini];
    out += VOWELS[vow];
    const next = syl[i + 1]?.[0];
    out += next === 11 && fin !== 0 && fin !== 21 ? LIAISON[fin] : next === 5 && fin === 8 ? "l" : FINALS[fin];
  });
  return out;
}

// ---- Japanese words ----------------------------------------------------------

interface Token {
  surface_form: string;
  reading?: string;
  pos: string;
  pos_detail_1: string;
}
interface Tokenizer {
  tokenize(text: string): Token[];
}

let tokenizer: Promise<Tokenizer | null> | null = null;

function getTokenizer(): Promise<Tokenizer | null> {
  tokenizer ??= import("kuromoji/build/kuromoji.js")
    .then(
      (mod) =>
        new Promise<Tokenizer | null>((resolve) => {
          const k = (mod as { default?: unknown }).default ?? mod;
          (k as { builder(o: { dicPath: string }): { build(cb: (e: unknown, t: Tokenizer) => void): void } })
            .builder({ dicPath: DICT })
            .build((err, t) => resolve(err ? null : t));
        }),
    )
    .catch(() => null)
    .then((t) => {
      // Offline: try again next time a Japanese song comes.
      if (!t) tokenizer = null;
      return t;
    });
  return tokenizer;
}

/** Words of a Japanese run, read aloud: particles and endings stick to their word. */
function japaneseRun(run: string, t: Tokenizer | null): string {
  if (!t) return kanaToRomaji(run);
  // Kana per word first, romaji after: "だっ" + "た" must give "datta".
  const words: string[] = [];
  for (const tok of t.tokenize(run)) {
    let kana = tok.reading && tok.reading !== "*" ? tok.reading : tok.surface_form;
    // Particles read differently from how they are written.
    if (tok.pos === "助詞" && tok.surface_form === "は") kana = "ワ";
    else if (tok.pos === "助詞" && tok.surface_form === "へ") kana = "エ";
    const attach = tok.pos === "助動詞" || tok.pos_detail_1 === "接尾" || (tok.pos === "助詞" && tok.pos_detail_1 === "接続助詞");
    if (attach && words.length) words[words.length - 1] += kana;
    else words.push(kana);
  }
  return words.map(kanaToRomaji).filter(Boolean).join(" ");
}

function line(text: string, japanese: boolean, t: Tokenizer | null): string {
  const runs: { kind: 0 | 1 | 2; text: string }[] = [];
  for (const c of Array.from(text)) {
    const kind: 0 | 1 | 2 = japanese && (isJapanese(c) || (c === "ー" && runs.at(-1)?.kind === 1)) ? 1 : isHangul(c) ? 2 : 0;
    const last = runs.at(-1);
    if (last && last.kind === kind) last.text += c;
    else runs.push({ kind, text: c });
  }
  const out = runs
    .map((r) => (r.kind === 1 ? ` ${japaneseRun(r.text, t)} ` : r.kind === 2 ? ` ${hangulToLatin(r.text)} ` : r.text))
    .join("")
    .replace(/、/g, ", ")
    .replace(/。/g, ". ")
    .replace(/[「」『』]/g, '"')
    .replace(/[！]/g, "!")
    .replace(/[？]/g, "?")
    .replace(/　/g, " ");
  return out.replace(/\s+/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
}

const cache = new Map<string, Promise<string[]>>();

/**
 * Each line in Latin letters (lines without Japanese or Korean stay as they
 * are). `id` keys the cache, e.g. the lyrics' track key.
 */
export function romanize(id: string, lines: string[]): Promise<string[]> {
  const key = id + "\u0000" + lines.length;
  let p = cache.get(key);
  if (!p) {
    const japanese = lines.some((l) => KANA.test(l));
    const needsWords = japanese && lines.some((l) => KANJI.test(l) || KANA.test(l));
    p = (needsWords ? getTokenizer() : Promise.resolve(null)).then((t) => lines.map((l) => line(l, japanese, t)));
    cache.set(key, p);
    // Do not keep a kana-only result made while the dictionary was unreachable.
    if (needsWords) p.then(() => tokenizer === null && cache.delete(key));
  }
  return p;
}

/** Debug view for development tools. */
if (typeof window !== "undefined") (window as unknown as { __museRomanize: unknown }).__museRomanize = romanize;
