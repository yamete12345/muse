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

const win = getCurrentWindow();

export function WidgetWindow() {
  const theme = useResolvedTheme();
  const look = useWidgetStyle();
  const media = useStore((s) => s.media);
  const cover = useStore((s) => s.cover);
  const edit = useStore((s) => !!s.settings.widgetEdit);
  const clickThrough = useStore((s) => s.settings.widgetClickThrough);
  const blurOn = useStore((s) => s.settings.widgetAcrylic);
  const synced = useStore((s) => !!s.lyrics && s.lyrics.key === s.media?.key && s.lyrics.kind === "synced");
  const blur = widgetBlur(look);

  // Rust blurs the desktop behind the window when the glass is beautiful.
  useEffect(() => {
    if (blurOn !== blur) updateSettings({ widgetAcrylic: blur });
  }, [blur, blurOn]);

  const panel = useMemo(() => {
    const rgb = hexToRgb(look.tint) ?? "11, 13, 15";
    const shadowColor = theme === "light" ? "255, 255, 255" : "0, 0, 0";
    const tinted = look.background === "tint" || look.background === "cover";
    return {
      "--widget-tint": tinted ? `rgba(${rgb}, ${look.opacity})` : "transparent",
      "--widget-radius": `${look.radius}px`,
      "--widget-text-shadow": look.shadow > 0 ? `0 1px ${14 * look.shadow}px rgba(${shadowColor}, ${Math.min(1, 0.55 * look.shadow)})` : "none",
    } as CSSProperties;
  }, [look, theme]);

  const playing = media?.playing ?? false;
  const showControls = look.controls && !clickThrough && !edit && !!media;

  return (
    <div className={`widget widget-bg-${look.background} ${blur ? "widget-glass" : ""} widget-format-${look.format} ${look.showCaption ? "" : "widget-no-caption"} ${edit ? "is-edit" : ""}`} style={panel}>
      <div className="widget-panel">
        {look.background === "cover" && cover && (
          <div className="widget-cover-bg" style={{ backgroundImage: `url(${cover})`, opacity: look.coverOpacity }} />
        )}
        {look.showCaption && media?.title && (
          <div className="widget-caption" key={media.key}>
            {look.showCover && cover && <img className="widget-thumb" src={cover} alt="" draggable={false} />}
            <div className="widget-meta">
              <div className="widget-title">{media.title}</div>
              {media.artist && <div className="widget-artist">{media.artist}</div>}
            </div>
            <LevelBars playing={playing} live={look.levels} />
          </div>
        )}
        {look.format === "line" && synced ? (
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
