import { useEffect, useMemo, useState } from "react";

import { useStore } from "./store";
import { resolveMain, resolveWallpaper, resolveWidget, type MainStyle, type WallpaperStyle, type WidgetStyle } from "./style";

export const useMainStyle = (): MainStyle => {
  const s = useStore((st) => st.settings);
  return useMemo(() => resolveMain(s), [s]);
};

export const useWidgetStyle = (): WidgetStyle => {
  const s = useStore((st) => st.settings);
  return useMemo(() => resolveWidget(s), [s]);
};

export const useWallpaperStyle = (monitor?: number): WallpaperStyle => {
  const s = useStore((st) => st.settings);
  return useMemo(() => resolveWallpaper(s, monitor), [s, monitor]);
};

const cache = new Map<string, string>();

/**
 * A vivid, bright color from the cover ("r, g, b"), for the "from cover" accent.
 * Picks the most saturated pixels and lifts them so they read on dark backgrounds.
 */
const HOLD_MS = 2500;

/**
 * The current cover, except that the short gap between two tracks keeps the
 * previous one, so colors go straight from one song to the next instead of
 * passing through the app's idle look.
 */
export function useStickyCover(): string | null {
  const cover = useStore((s) => s.cover);
  const [held, setHeld] = useState(cover);
  useEffect(() => {
    if (cover) {
      setHeld(cover);
      return;
    }
    const t = setTimeout(() => setHeld(null), HOLD_MS);
    return () => clearTimeout(t);
  }, [cover]);
  return cover ?? held;
}

export function useCoverAccent(): string | null {
  const cover = useStickyCover();
  const [accent, setAccent] = useState<string | null>(() => (cover ? cache.get(cover) ?? null : null));

  useEffect(() => {
    if (!cover) return setAccent(null);
    const hit = cache.get(cover);
    if (hit) return setAccent(hit);
    let alive = true;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = 32;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0, 32, 32);
      const d = ctx.getImageData(0, 0, 32, 32).data;
      let best = [255, 255, 255];
      let bestScore = -1;
      for (let i = 0; i < d.length; i += 4) {
        const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const sat = max === 0 ? 0 : (max - min) / max;
        const score = sat * 0.7 + (max / 255) * 0.3;
        if (score > bestScore) {
          bestScore = score;
          best = [r, g, b];
        }
      }
      const max = Math.max(...best, 1);
      const lift = Math.max(1, 230 / max);
      const rgb = best.map((v) => Math.min(255, Math.round(v * lift + (255 - v * lift) * 0.15))).join(", ");
      cache.set(cover, rgb);
      if (alive) setAccent(rgb);
    };
    img.src = cover;
    return () => {
      alive = false;
    };
  }, [cover]);

  return accent;
}
