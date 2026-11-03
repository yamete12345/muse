/**
 * Appearance model shared by the main window, the desktop widget and the live
 * wallpaper. Rust stores these objects as opaque JSON; defaults live here and
 * are merged in on read, so old or partial settings always resolve.
 */
import type { CSSProperties } from "react";

import type { Settings } from "./types";

export type FontChoice = "inter" | "segoe" | "serif" | "rounded" | "mono";
export type FillMode = "smooth" | "word" | "line";
export type Motion = "soft" | "normal" | "snappy";

export interface LyricStyle {
  font: FontChoice;
  /** px; 0 means "fit to the window" (main window and wallpaper only). */
  fontSize: number;
  fontWeight: number;
  align: "left" | "center";
  lineSpacing: number;
  /** "auto" = text color, "cover" = picked from the artwork, or a #hex. */
  accent: string;
  /** Opacity of unsung words and inactive lines. */
  unsung: number;
  blur: number;
  glow: number;
  fill: FillMode;
  emphasis: boolean;
  scaleInactive: boolean;
  motion: Motion;
  /** Delay between lines of the scroll wave, ms. */
  wave: number;
  /** Vertical position of the active line, 0..1. */
  anchor: number;
}

export type BackgroundMode = "animated" | "static" | "solid";

export interface SceneStyle {
  background: BackgroundMode;
  bgColor: string;
  bgBrightness: number;
  bgSaturation: number;
  bgSpeed: number;
}

export interface MainStyle extends SceneStyle {
  lyrics: LyricStyle;
  player: "auto" | "always" | "hidden";
  showHeader: boolean;
  idleSeconds: number;
}

export type WidgetBackground = "none" | "tint" | "acrylic" | "cover";

export interface WidgetStyle {
  lyrics: LyricStyle;
  background: WidgetBackground;
  tint: string;
  opacity: number;
  coverOpacity: number;
  radius: number;
  shadow: number;
  showCaption: boolean;
  showCover: boolean;
  controls: boolean;
}

export interface WallpaperStyle extends SceneStyle {
  lyrics: LyricStyle;
  /** Horizontal placement of the lyrics column. */
  position: "left" | "center" | "right";
  /** Width of the lyrics column, fraction of the screen. */
  width: number;
  showTrack: boolean;
  dim: number;
}

export const DEFAULT_LYRICS: LyricStyle = {
  font: "inter",
  fontSize: 0,
  fontWeight: 760,
  align: "left",
  lineSpacing: 1,
  accent: "auto",
  unsung: 0.33,
  blur: 1,
  glow: 1,
  fill: "smooth",
  emphasis: true,
  scaleInactive: true,
  motion: "normal",
  wave: 42,
  anchor: 0.3,
};

const SCENE: SceneStyle = {
  background: "animated",
  bgColor: "#2a2140",
  bgBrightness: 1,
  bgSaturation: 1,
  bgSpeed: 1,
};

export const DEFAULT_MAIN: MainStyle = {
  ...SCENE,
  lyrics: DEFAULT_LYRICS,
  player: "auto",
  showHeader: true,
  idleSeconds: 3,
};

export const DEFAULT_WIDGET: WidgetStyle = {
  lyrics: { ...DEFAULT_LYRICS, fontSize: 26, blur: 0.55, anchor: 0.5, wave: 36 },
  background: "tint",
  tint: "#0a080e",
  opacity: 0.22,
  coverOpacity: 0.55,
  radius: 24,
  shadow: 1,
  showCaption: true,
  showCover: true,
  controls: true,
};

export const DEFAULT_WALLPAPER: WallpaperStyle = {
  ...SCENE,
  lyrics: { ...DEFAULT_LYRICS, anchor: 0.42 },
  position: "left",
  width: 0.62,
  showTrack: true,
  dim: 0,
};

/** Shallow merge with defaults, one level deep for the nested lyric style. */
function merge<T extends { lyrics: LyricStyle }>(defaults: T, stored: unknown): T {
  const s = (stored && typeof stored === "object" ? stored : {}) as Partial<T>;
  return { ...defaults, ...s, lyrics: { ...defaults.lyrics, ...(s.lyrics ?? {}) } };
}

/** Linked surfaces copy the main window's look but keep their own size and position. */
function linkLyrics(own: LyricStyle, main: LyricStyle): LyricStyle {
  return { ...main, fontSize: own.fontSize, anchor: own.anchor, align: own.align };
}

/** Each surface's own stored style (before linking), used when editing. */
export const ownMain = (s: Settings): MainStyle => merge(DEFAULT_MAIN, s.mainStyle);
export const ownWidget = (s: Settings): WidgetStyle => merge(DEFAULT_WIDGET, s.widgetStyle);
export const ownWallpaper = (s: Settings): WallpaperStyle => merge(DEFAULT_WALLPAPER, s.wallpaperStyle);

export function resolveMain(s: Settings): MainStyle {
  return ownMain(s);
}

export function resolveWidget(s: Settings): WidgetStyle {
  const w = ownWidget(s);
  return s.widgetLinked ? { ...w, lyrics: linkLyrics(w.lyrics, resolveMain(s).lyrics) } : w;
}

export function resolveWallpaper(s: Settings): WallpaperStyle {
  const w = ownWallpaper(s);
  if (!s.wallpaperLinked) return w;
  const m = resolveMain(s);
  return {
    ...w,
    background: m.background,
    bgColor: m.bgColor,
    bgBrightness: m.bgBrightness,
    bgSaturation: m.bgSaturation,
    bgSpeed: m.bgSpeed,
    lyrics: linkLyrics(w.lyrics, m.lyrics),
  };
}

const FONTS: Record<FontChoice, string> = {
  inter: '"Inter Variable", "Segoe UI Variable Display", system-ui, sans-serif',
  segoe: '"Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  rounded: '"Segoe UI Variable Display", "Arial Rounded MT Bold", system-ui, sans-serif',
  mono: '"Cascadia Code", Consolas, ui-monospace, monospace',
};

export function hexToRgb(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/** CSS custom properties consumed by lyrics.css. */
export function lyricVars(l: LyricStyle, coverAccent: string | null): CSSProperties {
  const accent = l.accent === "cover" ? coverAccent : l.accent === "auto" ? null : hexToRgb(l.accent);
  const vars: Record<string, string | number> = {
    "--u-font": FONTS[l.font] ?? FONTS.inter,
    "--u-weight": l.fontWeight,
    "--u-gap": 0.3 * l.lineSpacing,
    "--unsung": l.unsung,
    "--blur-k": l.blur,
    "--glow-k": l.glow,
    "--u-inactive-scale": l.scaleInactive ? 0.955 : 1,
  };
  if (l.fontSize > 0) vars["--u-size"] = `${l.fontSize}px`;
  if (accent) {
    vars["--accent-rgb"] = accent;
    vars["--glow-rgb"] = accent;
  }
  return vars as CSSProperties;
}

const MOTION: Record<Motion, [number, number]> = {
  soft: [62, 16],
  normal: [110, 21],
  snappy: [220, 30],
};

export interface EngineTuning {
  stiffness: number;
  damping: number;
  wave: number;
  fill: FillMode;
  emphasis: boolean;
  glow: number;
  anchor: number;
}

export function engineTuning(l: LyricStyle): EngineTuning {
  const [stiffness, damping] = MOTION[l.motion] ?? MOTION.normal;
  return { stiffness, damping, wave: l.wave, fill: l.fill, emphasis: l.emphasis, glow: l.glow, anchor: l.anchor };
}
