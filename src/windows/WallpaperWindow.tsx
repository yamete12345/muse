import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

import { Background } from "../components/Background";
import { LyricsView } from "../components/LyricsView";
import { useWallpaperStyle } from "../core/appearance";
import { useStore } from "../core/store";
import { useResolvedTheme } from "../core/theme";
import { setPaused } from "../core/ticker";

const MARGIN = 0.06;

/** Full-screen lyrics living in the desktop's wallpaper layer, behind the icons. */
export function WallpaperWindow() {
  const theme = useResolvedTheme();
  const look = useWallpaperStyle();
  const media = useStore((s) => s.media);
  const cover = useStore((s) => s.cover);

  // Rust reports when a maximized or fullscreen window hides the desktop.
  useEffect(() => {
    const un = listen<boolean>("wallpaper:covered", (e) => setPaused(e.payload));
    return () => {
      un.then((f) => f());
    };
  }, []);

  const width = Math.min(0.9, Math.max(0.3, look.width));
  const left = look.position === "center" ? (1 - width) / 2 : look.position === "right" ? 1 - width - MARGIN : MARGIN;
  const stage = { left: `${left * 100}%`, width: `${width * 100}%` };

  return (
    <div className="wallpaper">
      <Background light={theme === "light"} scene={look} syncWindow={false} />
      <div className="wallpaper-dim" style={{ opacity: look.dim }} />
      <div className="wallpaper-stage" style={stage}>
        <LyricsView mode="wallpaper" look={look.lyrics} />
      </div>
      {look.showTrack && media?.title && (
        <div className="wallpaper-track" key={media.key} style={{ left: stage.left }}>
          {cover && <img src={cover} alt="" />}
          <div>
            <div className="wallpaper-track-title">{media.title}</div>
            <div className="wallpaper-track-artist">{media.artist}</div>
          </div>
        </div>
      )}
    </div>
  );
}
