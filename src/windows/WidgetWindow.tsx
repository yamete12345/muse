import { getCurrentWindow } from "@tauri-apps/api/window";

import { updateSettings } from "../core/api";
import { useStore } from "../core/store";
import { useResolvedTheme } from "../core/theme";
import { LyricsView } from "../components/LyricsView";

const win = getCurrentWindow();

export function WidgetWindow() {
  useResolvedTheme();
  const media = useStore((s) => s.media);
  const edit = useStore((s) => !!s.settings.widgetEdit);
  const acrylic = useStore((s) => s.settings.widgetAcrylic);
  const fontSize = useStore((s) => s.settings.widgetFontSize);

  return (
    <div className={`widget ${edit ? "is-edit" : ""} ${acrylic ? "is-acrylic" : ""}`}>
      <div className="widget-panel">
        {media?.title && (
          <div className="widget-caption">
            <span className="widget-title">{media.title}</span>
            <span className="widget-artist">{media.artist}</span>
          </div>
        )}
        <LyricsView mode="widget" style={{ ["--widget-font" as string]: `${fontSize}px` }} />
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
