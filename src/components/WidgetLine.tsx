import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { useCoverAccent } from "../core/appearance";
import { buildItems, parseLrc, type Line } from "../core/lrc";
import { clock, useStore } from "../core/store";
import { hexToRgb, lyricVars, type LyricStyle } from "../core/style";
import { estimateWords } from "../core/timing";
import { onFrame } from "../core/ticker";
import { useRomaji } from "./LyricsView";

/** After a line ends, a long pause shows the next line, not yet sung. */
const SHOW_NEXT_AFTER_MS = 900;
/** How far toward the next word the camera has moved by the end of a word. */
const LEAD = 0.45;
/** Camera speed: how quickly it closes in on where it should be. */
const FOLLOW = 7;
/** Each new word: the camera pushes in by this much, then settles. */
const PUNCH = 0.035;

interface Props {
  look: LyricStyle;
  /** Colour of the word being sung: "auto" (the text's accent), "cover" or #rrggbb. */
  wordColor: string;
  /** Brightness of the other words; null: like the text's inactive lines. */
  restBrightness: number | null;
}

/** "Одна строка" for the playing song. */
export function WidgetLine(props: Props) {
  const lyrics = useStore((s) => s.lyrics);
  const key = useStore((s) => s.media?.key);
  const romajiMode = useStore((s) => s.settings.romaji);
  const current = lyrics && lyrics.key === key && lyrics.kind === "synced" ? lyrics : null;

  const items = useMemo(() => (current ? buildItems(parseLrc(current.text)) : []), [current]);
  const roman = useRomaji(current ? current.key : "", items);
  // Lines only, with Latin letters when the text is to be shown that way.
  const lines = useMemo(
    () =>
      items.flatMap((it, i): Line[] => {
        if (it.kind !== "line" || !it.line.text.trim()) return [];
        const r = romajiMode === "instead" ? roman?.get(i) : undefined;
        return [r ? { ...it.line, text: r, words: estimateWords(r, it.line.start, it.line.end), exact: false } : it.line];
      }),
    [items, roman, romajiMode],
  );
  return <LineRunner {...props} lines={lines} time={() => clock.now()} />;
}

/**
 * "Одна строка": only the line being sung. The highlight runs from word to
 * word; a line wider than the widget slides along so the word being sung
 * stays in view, and the next line rises in from below.
 */
export function LineRunner({ look, wordColor, restBrightness, lines, time }: Props & { lines: Line[]; time: () => number }) {
  const accent = useCoverAccent();
  const timeRef = useRef(time);
  timeRef.current = time;

  // The line on screen, and whether it is being sung or only coming up.
  const [shown, setShown] = useState<{ index: number; live: boolean }>({ index: -1, live: false });
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const box = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  // Camera: horizontal position (NaN: jump there on the next frame) and push-in.
  const cam = useRef({ x: NaN, kick: 0, word: -1 });

  useEffect(() => {
    if (!lines.length) return;
    const states: string[] = [];
    return onFrame((_ts, dt) => {
      const t = timeRef.current();
      // The last line that has started, or the first one before anything is sung.
      let i = -1;
      for (let k = 0; k < lines.length && lines[k].start <= t; k++) i = k;
      let next = { index: Math.max(0, i), live: i >= 0 };
      if (i >= 0 && i + 1 < lines.length && t > lines[i].end + SHOW_NEXT_AFTER_MS) next = { index: i + 1, live: false };
      const cur = shownRef.current;
      if (cur.index !== next.index || cur.live !== next.live) {
        if (cur.index !== next.index) {
          cam.current = { x: NaN, kick: 0, word: -1 };
          states.length = 0;
        }
        setShown(next);
        return;
      }

      // Word states: sung, being sung, still to come.
      const el = strip.current;
      const line = lines[next.index];
      if (!el || !line) return;
      const spans = el.children;
      let now = -1;
      for (let k = 0; k < line.words.length && k < spans.length; k++) {
        const w = line.words[k];
        const state = !next.live ? "" : t >= w.end ? "is-sung" : t >= w.start ? "is-now" : "";
        if (state === "is-now") now = k;
        if (states[k] !== state) {
          states[k] = state;
          (spans[k] as HTMLElement).className = `wl-w ${state}`;
        }
      }

      // The camera keeps its focus in the middle: the word being sung,
      // drifting toward the next one while it is sung, so it never stops.
      const b = box.current;
      if (!b) return;
      const mid = b.clientWidth / 2 - parseFloat(getComputedStyle(b).paddingLeft);
      const center = (k: number) => {
        const sp = spans[k] as HTMLElement | undefined;
        return sp ? sp.offsetLeft + sp.offsetWidth / 2 : 0;
      };
      const lastSung = states.lastIndexOf("is-sung");
      let focus = center(0);
      if (now >= 0) {
        const w = line.words[now];
        const p = Math.min(1, Math.max(0, (t - w.start) / Math.max(1, w.end - w.start)));
        const nextC = now + 1 < line.words.length ? center(now + 1) : center(now);
        focus = center(now) + (nextC - center(now)) * p * LEAD;
      } else if (lastSung >= 0) {
        // Between two words: from the last one sung toward the next.
        focus = lastSung + 1 < line.words.length ? (center(lastSung) + center(lastSung + 1)) / 2 : center(lastSung);
      }
      const c = cam.current;
      const target = mid - focus;
      c.x = Number.isNaN(c.x) ? target : c.x + (target - c.x) * Math.min(1, dt * FOLLOW);
      // A small push-in on every new word, settling back.
      if (now >= 0 && now !== c.word) c.kick = PUNCH;
      c.word = now;
      c.kick *= Math.exp(-dt / 0.35);
      el.style.transformOrigin = `${focus.toFixed(1)}px 60%`;
      el.style.transform = `translateX(${c.x.toFixed(1)}px) scale(${(1 + c.kick).toFixed(4)})`;
    });
  }, [lines]);

  const word = wordColor === "cover" ? accent : wordColor.startsWith("#") ? hexToRgb(wordColor) : null;
  const vars = {
    ...lyricVars(look, accent),
    ...(word ? { "--wl-word-rgb": word } : {}),
    "--wl-rest": restBrightness ?? look.unsung,
  } as CSSProperties;

  const line = lines[shown.index];
  return (
    <div className="wl" ref={box} data-align={look.align} style={vars}>
      {line && (
        <div className={`wl-line ${shown.live ? "is-live" : "is-next"}`} key={`${shown.index}`} ref={strip}>
          {line.words.map((w, k) => (
            // The space stays outside the word, so a larger word never eats it.
            <Fragment key={k}>
              <span className="wl-w">{w.text}</span>
              {w.glue || k === line.words.length - 1 ? "" : " "}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
