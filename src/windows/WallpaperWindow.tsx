import { useEffect, useLayoutEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { Background } from "../components/Background";
import { NoteIcon } from "../components/Icons";
import { LiveCover } from "../components/LiveCover";
import { LyricsView } from "../components/LyricsView";
import { useWallpaperStyle } from "../core/appearance";
import { useStore } from "../core/store";
import { wallpaperColumn } from "../core/style";
import { useResolvedTheme } from "../core/theme";
import { setPaused } from "../core/ticker";

// Each monitor has its own window, labelled wallpaper-<monitor index>.
const MONITOR = Number(getCurrentWindow().label.slice("wallpaper-".length)) || 0;

const FLIGHT_MS = 950;

/**
 * Flies a copy of the artwork from one box to another, then reveals the real
 * one there. A separate full-size image keeps it sharp the whole way, which
 * scaling the small cover up would not.
 */
function fly(root: HTMLElement, src: string, from: DOMRect, to: HTMLElement, radius: [number, number]) {
  const end = to.getBoundingClientRect();
  if (!from.width || !end.width) return;
  const box = document.createElement("div");
  box.className = "wallpaper-flight";
  const img = document.createElement("img");
  img.src = src;
  img.alt = "";
  box.appendChild(img);
  root.appendChild(box);
  to.style.visibility = "hidden";
  const frame = (r: DOMRect, rad: number) => ({ left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: `${rad}px` });
  const anim = box.animate([frame(from, radius[0]), frame(end, radius[1])], { duration: FLIGHT_MS, easing: "cubic-bezier(0.22, 0.9, 0.24, 1)", fill: "forwards" });
  const done = () => {
    to.style.visibility = "";
    box.remove();
  };
  anim.onfinish = done;
  anim.oncancel = done;
}

/** Full-screen lyrics living in the desktop's wallpaper layer, behind the icons. */
export function WallpaperWindow() {
  const theme = useResolvedTheme();
  const look = useWallpaperStyle(MONITOR);
  const media = useStore((s) => s.media);
  const cover = useStore((s) => s.cover);
  const lyricsKind = useStore((s) => (s.lyrics && s.lyrics.key === s.media?.key ? s.lyrics.kind : null));

  // No synced lyrics at all: the artwork takes the screen instead. While the
  // next song's lyrics are still being looked up, the screen stays as it is,
  // so the artwork does not bounce between two songs without lyrics.
  const held = useRef(false);
  if (!media?.title) held.current = false;
  else if (lyricsKind && lyricsKind !== "loading") held.current = lyricsKind === "none" || lyricsKind === "plain" || lyricsKind === "instrumental";
  const artOnly = held.current;

  // Rust reports when a maximized or fullscreen window hides the desktop.
  useEffect(() => {
    const un = listen<boolean>("wallpaper:covered", (e) => setPaused(e.payload));
    return () => {
      un.then((f) => f());
    };
  }, []);

  // The artwork moves between the corner card and the middle of the screen.
  const root = useRef<HTMLDivElement>(null);
  const small = useRef<HTMLDivElement>(null);
  const big = useRef<HTMLDivElement>(null);
  const rects = useRef<{ small?: DOMRect; big?: DOMRect }>({});
  const prevArt = useRef(artOnly);
  const switching = prevArt.current !== artOnly && !!cover && look.showTrack;

  // Declared first: it must see where the artwork was before this render.
  useLayoutEffect(() => {
    if (prevArt.current === artOnly) return;
    prevArt.current = artOnly;
    const from = artOnly ? rects.current.small : rects.current.big;
    const to = artOnly ? big.current : small.current;
    if (switching && from && to && root.current) fly(root.current, cover!, from, to, artOnly ? [10, 22] : [22, 10]);
  });
  useLayoutEffect(() => {
    if (small.current) rects.current.small = small.current.getBoundingClientRect();
    if (big.current) rects.current.big = big.current.getBoundingClientRect();
  });

  const col = wallpaperColumn(look);
  const stage = { left: `${col.left * 100}%`, width: `${col.width * 100}%` };

  return (
    <div className="wallpaper" ref={root}>
      <Background light={theme === "light"} scene={look} syncWindow={false} />
      <div className="wallpaper-dim" style={{ opacity: look.dim }} />
      <div className={`wallpaper-stage ${artOnly ? "is-hidden" : ""}`} style={stage}>
        <LyricsView mode="wallpaper" look={look.lyrics} />
      </div>
      {artOnly && (
        <div className={`wallpaper-art is-${look.artPosition} ${switching ? "is-arriving" : ""}`} key={media!.key}>
          <div ref={big} className={`wallpaper-art-cover ${cover ? "has-cover" : ""}`}>
            {cover ? <LiveCover src={cover} halo /> : <NoteIcon size={72} />}
          </div>
          <div className="wallpaper-art-title">{media!.title}</div>
          <div className="wallpaper-art-artist">{media!.artist}</div>
        </div>
      )}
      {look.showTrack && media?.title && !artOnly && (
        <div className={`wallpaper-track is-${look.trackCorner} ${switching ? "is-arriving" : ""}`} key={media.key}>
          {cover && (
            <div ref={small} className="wallpaper-track-cover">
              <LiveCover src={cover} className="lc-small" />
            </div>
          )}
          <div>
            <div className="wallpaper-track-title">{media.title}</div>
            <div className="wallpaper-track-artist">{media.artist}</div>
          </div>
        </div>
      )}
    </div>
  );
}
