import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { retryLyrics, seekLyrics } from "../core/api";
import { useCoverAccent } from "../core/appearance";
import { buildItems, parseLrc, type Item } from "../core/lrc";
import { romanize, wantsRomaji } from "../core/romaji";
import { estimateWords } from "../core/timing";
import { LyricsEngine } from "../core/lyricsEngine";
import { clock, useStore } from "../core/store";
import { partLabels, type PartLabel } from "../core/parts";
import { engineTuning, lyricVars, type LyricStyle } from "../core/style";
import { openPanel } from "../core/ui";
import { NoteIcon, PenIcon, SearchIcon } from "./Icons";
import { Logo } from "./Logo";
import { PlainLyrics } from "./PlainLyrics";
import { LineMenu } from "./LineMenu";
import { ShareDialog } from "./ShareDialog";

export type LyricsMode = "main" | "widget" | "wallpaper";

interface CanvasProps {
  items: Item[];
  time: () => number;
  look: LyricStyle;
  className: string;
  center?: boolean;
  interactive?: boolean;
  hidden?: boolean;
  /** Pause the engine, e.g. while another tab covers it. */
  suspended?: boolean;
  /** Part captions by item index. */
  labels?: Map<number, PartLabel>;
  /** Second lines (Latin letters) by item index. */
  subs?: Map<number, string>;
  onLineMenu?: (item: Item, x: number, y: number) => void;
}

/** Hosts a LyricsEngine and keeps it in sync with the appearance settings. */
export function LyricsCanvas({ items, time, look, className, center, interactive, hidden, suspended, labels, subs, onLineMenu }: CanvasProps) {
  const root = useRef<HTMLDivElement>(null);
  const engine = useRef<LyricsEngine | null>(null);
  const timeRef = useRef(time);
  timeRef.current = time;
  const menuRef = useRef(onLineMenu);
  menuRef.current = onLineMenu;

  useEffect(() => {
    const e = new LyricsEngine(root.current!, () => timeRef.current(), {
      center,
      interactive: !!interactive,
      onSeek: seekLyrics,
      onLineMenu: (item, x, y) => menuRef.current?.(item, x, y),
    });
    engine.current = e;
    return () => e.destroy();
  }, [center, interactive]);

  const tuning = useMemo(() => engineTuning(look), [look]);
  useEffect(() => engine.current?.configure(tuning), [tuning, center, interactive]);
  useEffect(() => engine.current?.setItems(items), [items, center, interactive]);
  useEffect(() => engine.current?.setSuspended(!!suspended), [suspended, center, interactive]);
  useEffect(() => engine.current?.setLabels(labels ?? new Map()), [labels, items, center, interactive]);
  useEffect(() => engine.current?.setSubs(subs ?? new Map()), [subs, items, center, interactive]);

  return <div ref={root} className={className} data-align={look.align} style={{ visibility: hidden ? "hidden" : "visible" }} />;
}

interface Props {
  mode: LyricsMode;
  look: LyricStyle;
  style?: CSSProperties;
  suspended?: boolean;
}

export function LyricsView({ mode, look, style, suspended }: Props) {
  const hasMedia = useStore((s) => !!s.media && !!s.media.title);
  const lyrics = useStore((s) => s.lyrics);
  const key = useStore((s) => s.media?.key);
  const accent = useCoverAccent();
  const current = lyrics && lyrics.key === key ? lyrics : null;
  const synced = current?.kind === "synced";
  const isMain = mode === "main";

  const text = synced ? current!.text : "";
  const items = useMemo(() => (text ? buildItems(parseLrc(text)) : []), [text]);
  // Who sings which part; the widget is too small for captions.
  const parts = useStore((s) => (s.parts && s.parts.key === key ? s.parts : null));
  const partsMode = useStore((s) => s.settings.songParts);
  const labels = useMemo(() => (mode === "widget" ? undefined : partLabels(items, parts, partsMode)), [items, parts, partsMode, mode]);
  // Japanese and Korean lines in Latin letters: under each line, or instead of it.
  const romajiMode = useStore((s) => s.settings.romaji);
  const roman = useRomaji(current ? current.key : "", items);
  const shownItems = useMemo(
    () =>
      romajiMode === "instead" && roman
        ? items.map((it, i) => {
            const r = roman.get(i);
            return it.kind === "line" && r ? { ...it, line: { ...it.line, text: r, words: estimateWords(r, it.line.start, it.line.end), exact: false } } : it;
          })
        : items,
    [items, roman, romajiMode],
  );
  const subs = romajiMode === "under" ? roman ?? undefined : undefined;
  // Right click on a line in the main window: copy it, or make a picture of
  // up to four lines from it.
  const [share, setShare] = useState<string[] | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; item: Item } | null>(null);
  const [copied, setCopied] = useState(0);
  const linesFrom = (item: Item) =>
    items.slice(items.indexOf(item)).flatMap((it) => (it.kind === "line" && it.line.text.trim() ? [it.line.text] : [])).slice(0, 4);
  const openMenu = (item: Item, x: number, y: number) => {
    if (item.kind === "line" && item.line.text.trim()) setMenu({ x, y, item });
  };
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(0), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  const vars = useMemo(() => ({ ...lyricVars(look, accent), ...style }), [look, accent, style]);

  let status: React.ReactNode = null;
  if (mode === "wallpaper") {
    status = null;
  } else if (!hasMedia) {
    status = (
      <Status title="Ничего не играет" hint={isMain ? "Включите музыку в любом плеере" : undefined}>
        {isMain && <Logo size={56} className="status-logo" />}
      </Status>
    );
  } else if (!current || current.kind === "loading") {
    status = <Status title="Ищем текст" loading />;
  } else if (current.kind === "none") {
    status = (
      <Status title="Текст не найден" hint={isMain ? "Его нет ни в lrclib, ни в Genius" : undefined}>
        {isMain && (
          <div className="status-actions">
            <button className="link-button link-button-primary" onClick={() => openPanel("editor")}>
              <PenIcon size={15} /> Написать самому
            </button>
            <button className="link-button" onClick={() => openPanel("search")}>
              <SearchIcon size={15} /> Найти вручную
            </button>
            <button className="link-button" onClick={retryLyrics}>
              Поискать ещё раз
            </button>
          </div>
        )}
      </Status>
    );
  } else if (current.kind === "instrumental") {
    status = <Status title="Инструментальная композиция" icon />;
  } else if (current.kind === "plain") {
    status = isMain ? <PlainLyrics text={current.text} source={current.source} /> : <Status title="Текст без синхронизации" />;
  }

  return (
    <div className={`lx-host lx-host-${mode}`} style={vars}>
      <LyricsCanvas
        items={shownItems}
        time={() => clock.now()}
        look={look}
        className={`lx-root lx-${mode}`}
        center={mode === "widget"}
        interactive={isMain}
        hidden={!synced}
        suspended={suspended}
        labels={labels}
        subs={subs}
        onLineMenu={isMain ? openMenu : undefined}
      />
      {menu && (
        <LineMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: "Скопировать строку",
              onSelect: () => {
                const text = menu.item.kind === "line" ? menu.item.line.text : "";
                navigator.clipboard.writeText(text).then(() => setCopied(Date.now()), () => {});
              },
            },
            { label: "Картинка с текстом…", hint: "Для чатов и историй", onSelect: () => setShare(linesFrom(menu.item)) },
          ]}
        />
      )}
      {copied > 0 && <div className="copied-toast" key={copied}>Строка скопирована</div>}
      {share && <ShareDialog lines={share} onClose={() => setShare(null)} />}
      {!synced && status}
    </div>
  );
}

function Status({
  title,
  hint,
  loading,
  icon,
  children,
}: {
  title: string;
  hint?: string;
  loading?: boolean;
  icon?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="status" key={title}>
      {icon && <NoteIcon size={36} className="status-icon" />}
      <div className="status-title">
        {title}
        {loading && (
          <span className="status-dots">
            <i />
            <i />
            <i />
          </span>
        )}
      </div>
      {hint && <div className="status-hint">{hint}</div>}
      {children}
    </div>
  );
}

/**
 * Latin versions of the lines that differ from the original (Japanese,
 * Korean), by item index; null while there are none or the setting is off.
 */
function useRomaji(key: string, items: Item[]): Map<number, string> | null {
  const mode = useStore((s) => s.settings.romaji);
  const [result, setResult] = useState<{ items: Item[]; map: Map<number, string> } | null>(null);
  useEffect(() => {
    const idx: number[] = [];
    const texts: string[] = [];
    items.forEach((it, i) => {
      if (it.kind === "line") {
        idx.push(i);
        texts.push(it.line.text);
      }
    });
    if (mode === "off" || !wantsRomaji(texts)) {
      setResult(null);
      return;
    }
    let alive = true;
    romanize(key, texts).then((lines) => {
      if (!alive) return;
      const map = new Map<number, string>();
      lines.forEach((r, k) => r && r !== texts[k] && map.set(idx[k], r));
      setResult({ items, map });
    });
    return () => {
      alive = false;
    };
  }, [key, items, mode]);
  return result && result.items === items && mode !== "off" ? result.map : null;
}
