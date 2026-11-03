import { useEffect, useMemo, useRef, type CSSProperties } from "react";

import { retryLyrics, seekLyrics } from "../core/api";
import { useCoverAccent } from "../core/appearance";
import { buildItems, parseLrc, type Item } from "../core/lrc";
import { LyricsEngine } from "../core/lyricsEngine";
import { clock, useStore } from "../core/store";
import { engineTuning, lyricVars, type LyricStyle } from "../core/style";
import { openPanel } from "../core/ui";
import { NoteIcon, PenIcon } from "./Icons";
import { Logo } from "./Logo";
import { PlainLyrics } from "./PlainLyrics";

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
}

/** Hosts a LyricsEngine and keeps it in sync with the appearance settings. */
export function LyricsCanvas({ items, time, look, className, center, interactive, hidden, suspended }: CanvasProps) {
  const root = useRef<HTMLDivElement>(null);
  const engine = useRef<LyricsEngine | null>(null);
  const timeRef = useRef(time);
  timeRef.current = time;

  useEffect(() => {
    const e = new LyricsEngine(root.current!, () => timeRef.current(), {
      center,
      interactive: !!interactive,
      onSeek: seekLyrics,
    });
    engine.current = e;
    return () => e.destroy();
  }, [center, interactive]);

  const tuning = useMemo(() => engineTuning(look), [look]);
  useEffect(() => engine.current?.configure(tuning), [tuning, center, interactive]);
  useEffect(() => engine.current?.setItems(items), [items, center, interactive]);
  useEffect(() => engine.current?.setSuspended(!!suspended), [suspended, center, interactive]);

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
        items={items}
        time={() => clock.now()}
        look={look}
        className={`lx-root lx-${mode}`}
        center={mode === "widget"}
        interactive={isMain}
        hidden={!synced}
        suspended={suspended}
      />
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
