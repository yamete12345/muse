import { useEffect, useMemo, type CSSProperties } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { LevelBars } from "../components/LevelBars";
import { LyricsView } from "../components/LyricsView";
import { WidgetLine } from "../components/WidgetLine";
import { NextIcon, PauseIcon, PlayIcon, PrevIcon } from "../components/Icons";
import { nextTrack, prevTrack, togglePlay, updateSettings } from "../core/api";
import { useWidgetStyle } from "../core/appearance";
import { useStore } from "../core/store";
import { hexToRgb, widgetBlur } from "../core/style";
import { useResolvedTheme } from "../core/theme";
import type { LyricsPayload } from "../core/types";

const win = getCurrentWindow();

export function WidgetWindow() {
  const theme = useResolvedTheme();
  const look = useWidgetStyle();
  const media = useStore((s) => s.media);
  const cover = useStore((s) => s.cover);
  const edit = useStore((s) => !!s.settings.widgetEdit);
  const clickThrough = useStore((s) => s.settings.widgetClickThrough);
  const blurOn = useStore((s) => s.settings.widgetAcrylic);
  const cutRadius = useStore((s) => s.settings.widgetGlassRadius);
  const lyrics = useStore((s) => (s.lyrics && s.lyrics.key === s.media?.key ? s.lyrics : null));
  const synced = lyrics?.kind === "synced";
  // Nothing to sing along to: the song itself, in the middle.
  const note = media?.title && lyrics ? cardNote(lyrics) : null;
  const blur = widgetBlur(look);

  // Rust blurs the desktop behind the window when the glass is beautiful,
  // and cuts the window to the panel's rounded corners.
  useEffect(() => {
    if (blurOn !== blur || cutRadius !== look.radius) updateSettings({ widgetAcrylic: blur, widgetGlassRadius: look.radius });
  }, [blur, blurOn, cutRadius, look.radius]);

  const panel = useMemo(() => {
    const rgb = hexToRgb(look.tint) ?? "11, 13, 15";
    const shadowColor = theme === "light" ? "255, 255, 255" : "0, 0, 0";
    const tinted = look.background === "tint" || look.background === "cover";
    return {
      "--widget-tint": tinted ? `rgba(${rgb}, ${look.opacity})` : "transparent",
      "--widget-radius": `${look.radius}px`,
      "--widget-frost": look.frost,
      "--widget-text-shadow": look.shadow > 0 ? `0 1px ${14 * look.shadow}px rgba(${shadowColor}, ${Math.min(1, 0.55 * look.shadow)})` : "none",
    } as CSSProperties;
  }, [look, theme]);

  const playing = media?.playing ?? false;
  const showControls = look.controls && !clickThrough && !edit && !!media;

  return (
    <div className={`widget widget-bg-${look.background} ${blur ? "widget-glass" : ""} widget-format-${look.format} ${look.showCaption ? "" : "widget-no-caption"} ${edit ? "is-edit" : ""}`} style={panel}>
      <div className="widget-panel">
        {blur && <div className="widget-frost" />}
        {look.background === "cover" && cover && (
          <div className="widget-cover-bg" style={{ backgroundImage: `url(${cover})`, opacity: look.coverOpacity }} />
        )}
        {look.showCaption && media?.title && !note && (
          <div className="widget-caption" key={media.key}>
            {look.showCover && cover && <img className="widget-thumb" src={cover} alt="" draggable={false} />}
            <div className="widget-meta">
              <div className="widget-title">{media.title}</div>
              {media.artist && <div className="widget-artist">{media.artist}</div>}
            </div>
            <LevelBars playing={playing} live={look.levels} />
          </div>
        )}
        {note && media ? (
          <div className="widget-card" key={media.key}>
            {cover ? <img className="wc-cover" src={cover} alt="" draggable={false} /> : <div className="wc-cover is-empty" />}
            <div className="wc-meta">
              <div className="wc-title">{media.title}</div>
              {media.artist && <div className="wc-artist">{media.artist}</div>}
              <div className="wc-note">
                {look.showCaption && <LevelBars playing={playing} live={look.levels} />}
                <span>{note}</span>
              </div>
            </div>
          </div>
        ) : look.format === "line" && synced ? (
          <WidgetLine look={look.lyrics} wordColor={look.wordColor} restBrightness={look.restBrightness} />
        ) : (
          <LyricsView mode="widget" look={look.lyrics} style={look.showCaption ? undefined : { top: 0 }} />
        )}
        {showControls && (
          <div className="widget-controls">
            <button onClick={prevTrack} aria-label="Предыдущий">
              <PrevIcon size={14} />
            </button>
            <button onClick={togglePlay} aria-label={playing ? "Пауза" : "Играть"}>
              {playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
            </button>
            <button onClick={nextTrack} aria-label="Следующий">
              <NextIcon size={14} />
            </button>
          </div>
        )}
      </div>

      {edit && (
        <div className="widget-edit" onMouseDown={(e) => e.button === 0 && e.target === e.currentTarget && win.startDragging()}>
          <span className="widget-edit-hint">Перетащите виджет</span>
          <button className="widget-done" onClick={() => updateSettings({ widgetEdit: false })}>
            Готово
          </button>
          <div className="widget-resize" onMouseDown={() => win.startResizeDragging("SouthEast")} />
        </div>
      )}
    </div>
  );
}

/** What the card says when the widget has no synced lyrics; null: show the lyrics. */
function cardNote(l: LyricsPayload): string | null {
  switch (l.kind) {
    case "plain":
      return l.source === "genius" ? "Текст с Genius есть в приложении" : "Текст без синхронизации есть в приложении";
    case "none":
      return "Текст не найден";
    case "instrumental":
      return "Инструментал";
    default:
      return null;
  }
}
