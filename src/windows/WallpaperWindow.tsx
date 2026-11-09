import { useEffect, useLayoutEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { Background } from "../components/Background";
import { NoteIcon } from "../components/Icons";
import { LiveCover } from "../components/LiveCover";
import { LyricsView } from "../components/LyricsView";
import { useWallpaperStyle } from "../core/appearance";
import { useSaving } from "../core/power";
import { useStore } from "../core/store";
import { wallpaperColumn } from "../core/style";
import { useResolvedTheme } from "../core/theme";
import { setPaused } from "../core/ticker";

// Each monitor has its own window, labelled wallpaper-<monitor index>.
const MONITOR = Number(getCurrentWindow().label.slice("wallpaper-".length)) || 0;

const FLIGHT_MS = 950;
/** How long a flight waits for the new song's artwork before giving up. */
const WAIT_MS = 2500;

type Pose = [number, number, number, number, number, number];

/**
 * How the live cover is zoomed and shifted inside `box` right now (it drifts
 * slowly), with the shift relative to the box width.
 */
function poseOf(box: HTMLElement | null): Pose | null {
  const img = box?.querySelector<HTMLElement>(".lc-img");
  if (!box || !img) return null;
  const t = getComputedStyle(img).transform;
  if (!t || t === "none") return [1, 0, 0, 1, 0, 0];
  const m = new DOMMatrixReadOnly(t);
  const w = box.offsetWidth || 1;
  return [m.a, m.b, m.c, m.d, m.e / w, m.f / w];
}

const poseCss = (p: Pose | null, w: number) => (p ? `matrix(${p[0]}, ${p[1]}, ${p[2]}, ${p[3]}, ${p[4] * w}, ${p[5] * w})` : "none");

/**
 * Flies a copy of the artwork from one box to another, then reveals the real
 * one there. The copy has the size of the larger box and only moves and
 * scales (compositor work, no repaints), so it stays sharp and smooth. Its
 * image takes on the live cover's zoom on the way, and the copy fades out
 * over the real artwork, so nothing jumps at landing.
 */
function fly(root: HTMLElement, src: string, from: DOMRect, fromPose: Pose | null, to: HTMLElement, radius: [number, number]) {
  const end = to.getBoundingClientRect();
  if (!from.width || !end.width) return;
  const big = from.width >= end.width ? from : end;
  const box = document.createElement("div");
  box.className = "wallpaper-flight";
  Object.assign(box.style, { left: `${big.left}px`, top: `${big.top}px`, width: `${big.width}px`, height: `${big.height}px` });
  const img = document.createElement("img");
  img.src = src;
  img.alt = "";
  box.appendChild(img);
  root.appendChild(box);
  // The real artwork waits underneath; its glow fades in only after landing.
  to.classList.add("is-flight-target");
  const at = (r: DOMRect, rad: number) => {
    const k = r.width / big.width;
    return { transform: `translate(${r.left - big.left}px, ${r.top - big.top}px) scale(${k})`, borderRadius: `${rad / k}px` };
  };
  const timing: KeyframeAnimationOptions = { duration: FLIGHT_MS, easing: "cubic-bezier(0.22, 0.9, 0.24, 1)", fill: "forwards" };
  const anim = box.animate([at(from, radius[0]), at(end, radius[1])], timing);
  img.animate([{ transform: poseCss(fromPose, big.width) }, { transform: poseCss(poseOf(to), big.width) }], timing);
  const done = () => {
    to.classList.remove("is-flight-target");
    // The real artwork is there now; the copy melts into it.
    box.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: "ease-out", fill: "forwards" }).onfinish = () => box.remove();
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

  // Saving mode (a game, the battery): the wallpaper sleeps on its last frame.
  const saving = useSaving();
  useEffect(() => setPaused(saving !== null, "saving"), [saving]);

  // Rust reports when a maximized or fullscreen window hides the desktop.
  useEffect(() => {
    const un = listen<boolean>("wallpaper:covered", (e) => setPaused(e.payload, "covered"));
    return () => {
      un.then((f) => f());
    };
  }, []);

  // The artwork moves between the corner card and the middle of the screen.
  const root = useRef<HTMLDivElement>(null);
  const small = useRef<HTMLDivElement>(null);
  const big = useRef<HTMLDivElement>(null);
  const rects = useRef<{ small?: DOMRect; big?: DOMRect; smallPose?: Pose | null; bigPose?: Pose | null }>({});
  const prevArt = useRef(artOnly);
  /** A flight waiting for its target (and the new song's artwork) to appear. */
  const pending = useRef<{ from: DOMRect; pose: Pose | null; toBig: boolean; until: number } | null>(null);
  const switching = prevArt.current !== artOnly && look.showTrack;
  // The song whose card or artwork arrives by air: it skips its own entrance
  // animation, also on later renders (when its artwork shows up, say).
  const arriving = useRef<string | null>(null);
  if (switching) arriving.current = media?.key ?? null;
  const byAir = !!media && arriving.current === media.key;

  // Declared first: it must see where the artwork was before this render.
  useLayoutEffect(() => {
    if (prevArt.current !== artOnly) {
      prevArt.current = artOnly;
      const from = artOnly ? rects.current.small : rects.current.big;
      const pose = (artOnly ? rects.current.smallPose : rects.current.bigPose) ?? null;
      pending.current = from && look.showTrack ? { from, pose, toBig: artOnly, until: performance.now() + WAIT_MS } : null;
    }
    const p = pending.current;
    if (!p) return;
    if (performance.now() > p.until) {
      pending.current = null;
      return;
    }
    // A song whose lyrics were cached can report them before its artwork:
    // the flight then starts when the artwork arrives.
    const to = p.toBig ? big.current : small.current;
    if (to && cover && root.current) {
      pending.current = null;
      fly(root.current, cover, p.from, p.pose, to, p.toBig ? [10, 22] : [22, 10]);
    }
  });
  useLayoutEffect(() => {
    if (small.current) {
      rects.current.small = small.current.getBoundingClientRect();
      rects.current.smallPose = poseOf(small.current);
    }
    if (big.current) {
      rects.current.big = big.current.getBoundingClientRect();
      rects.current.bigPose = poseOf(big.current);
    }
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
        <div className={`wallpaper-art is-${look.artPosition} ${byAir ? "is-arriving" : ""}`} key={media!.key}>
          <div ref={big} className={`wallpaper-art-cover ${cover ? "has-cover" : ""}`}>
            {cover ? <LiveCover src={cover} halo /> : <NoteIcon size={72} />}
          </div>
          <div className="wallpaper-art-title">{media!.title}</div>
          <div className="wallpaper-art-artist">{media!.artist}</div>
        </div>
      )}
      {look.showTrack && media?.title && !artOnly && (
        <div className={`wallpaper-track is-${look.trackCorner} ${byAir ? "is-arriving" : ""}`} key={media.key}>
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
