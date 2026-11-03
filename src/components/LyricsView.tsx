import { useEffect, useMemo, useRef, type CSSProperties } from "react";

import { seekLyrics, retryLyrics } from "../core/api";
import { buildItems, parseLrc } from "../core/lrc";
import { LyricsEngine } from "../core/lyricsEngine";
import { clock, useStore } from "../core/store";
import { openPanel } from "../core/ui";
import { NoteIcon, PenIcon } from "./Icons";
import { Logo } from "./Logo";
import { PlainLyrics } from "./PlainLyrics";

interface Props {
  mode: "main" | "widget";
  style?: CSSProperties;
}

export function LyricsView({ mode, style }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const engine = useRef<LyricsEngine | null>(null);
  const hasMedia = useStore((s) => !!s.media && !!s.media.title);
  const lyrics = useStore((s) => s.lyrics);
  const key = useStore((s) => s.media?.key);
  const current = lyrics && lyrics.key === key ? lyrics : null;
  const synced = current?.kind === "synced";

  useEffect(() => {
    const e = new LyricsEngine(root.current!, () => clock.now(), {
      anchor: mode === "main" ? 0.3 : 0.5,
      center: mode === "widget",
      interactive: mode === "main",
      onSeek: seekLyrics,
    });
    engine.current = e;
    return () => e.destroy();
  }, [mode]);

  const text = synced ? current!.text : "";
  const items = useMemo(() => (text ? buildItems(parseLrc(text)) : []), [text]);
  useEffect(() => engine.current?.setItems(items), [items]);

  let status: React.ReactNode = null;
  if (!hasMedia) {
    status = (
      <Status title="Ничего не играет" hint={mode === "main" ? "Включите музыку в любом плеере" : undefined}>
        {mode === "main" && <Logo size={56} className="status-logo" />}
      </Status>
    );
  } else if (!current || current.kind === "loading") {
    status = <Status title="Ищем текст" loading />;
  } else if (current.kind === "none") {
    status = (
      <Status title="Текст не найден" hint={mode === "main" ? "Его нет ни в lrclib, ни в Genius" : undefined}>
        {mode === "main" && (
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
    status =
      mode === "main" ? (
        <PlainLyrics text={current.text} source={current.source} />
      ) : (
        <Status title="Текст без синхронизации" />
      );
  }

  return (
    <div className={`lx-host lx-host-${mode}`} style={style}>
      <div ref={root} className={`lx-root lx-${mode}`} style={{ visibility: synced ? "visible" : "hidden" }} />
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
