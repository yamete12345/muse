import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

import { Background } from "../components/Background";
import { NoteIcon } from "../components/Icons";
import { LyricsView } from "../components/LyricsView";
import { useWallpaperStyle } from "../core/appearance";
import { useStore } from "../core/store";
import { wallpaperColumn } from "../core/style";
import { useResolvedTheme } from "../core/theme";
import { setPaused } from "../core/ticker";

/** Full-screen lyrics living in the desktop's wallpaper layer, behind the icons. */
export function WallpaperWindow() {
  const theme = useResolvedTheme();
  const look = useWallpaperStyle();
  const media = useStore((s) => s.media);
  const cover = useStore((s) => s.cover);
  const lyricsKind = useStore((s) => (s.lyrics && s.lyrics.key === s.media?.key ? s.lyrics.kind : null));
  // No synced lyrics at all: the artwork takes the middle of the screen instead.
  const artOnly = !!media?.title && (lyricsKind === "none" || lyricsKind === "plain" || lyricsKind === "instrumental");

  // Rust reports when a maximized or fullscreen window hides the desktop.
  useEffect(() => {
    const un = listen<boolean>("wallpaper:covered", (e) => setPaused(e.payload));
    return () => {
      un.then((f) => f());
    };
  }, []);

  const col = wallpaperColumn(look);
  const stage = { left: `${col.left * 100}%`, width: `${col.width * 100}%` };

  return (
    <div className="wallpaper">
      <Background light={theme === "light"} scene={look} syncWindow={false} />
      <div className="wallpaper-dim" style={{ opacity: look.dim }} />
      <div className={`wallpaper-stage ${artOnly ? "is-hidden" : ""}`} style={stage}>
        <LyricsView mode="wallpaper" look={look.lyrics} />
      </div>
      {artOnly && (
        <div className="wallpaper-art" key={media!.key}>
          <div className="wallpaper-art-cover">{cover ? <img src={cover} alt="" /> : <NoteIcon size={72} />}</div>
          <div className="wallpaper-art-title">{media!.title}</div>
          <div className="wallpaper-art-artist">{media!.artist}</div>
        </div>
      )}
      {look.showTrack && media?.title && !artOnly && (
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
