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
export type Align = "left" | "center" | "right";

export interface LyricStyle {
  font: FontChoice;
  /** px; 0 means "fit to the window" (main window and wallpaper only). */
  fontSize: number;
  fontWeight: number;
  align: Align;
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

/** "gradient": the cover's colors flowing; "animated": the blurred cover itself, lighter on the GPU. */
export type BackgroundMode = "gradient" | "animated" | "static" | "solid";

export interface SceneStyle {
  background: BackgroundMode;
  bgColor: string;
  bgBrightness: number;
  bgSaturation: number;
  bgSpeed: number;
  /** Gradient: colours shift a little on every beat. */
  bgBeat: boolean;
}

export interface MainStyle extends SceneStyle {
  lyrics: LyricStyle;
  player: "auto" | "always" | "hidden";
  showHeader: boolean;
  idleSeconds: number;
}

/** "acrylic" is from older versions: it now means glass in the beautiful mode. */
export type WidgetBackground = "none" | "tint" | "acrylic" | "cover";
/** "Несколько строк": the scrolling lyrics; "Одна строка": only the line sung, word by word. */
export type WidgetFormat = "lines" | "line";
/** "beauty": the desktop blurred by Windows behind the glass; "fast": tint only. */
export type WidgetGlass = "beauty" | "fast";

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
  format: WidgetFormat;
  glass: WidgetGlass;
  /** The beautiful glass: a frosted haze over the blur, 0 (clear) to 1 (matte). */
  frost: number;
  /** "Одна строка": colour of the word being sung; "auto" follows the text's accent. */
  wordColor: string;
  /** "Одна строка": brightness of the other words; null follows the text's inactive lines. */
  restBrightness: number | null;
  /** The bars by the title move with the music's loudness. */
  levels: boolean;
}

export type Corner = "bottom-left" | "bottom-right" | "top-left" | "top-right";

export interface WallpaperStyle extends SceneStyle {
  lyrics: LyricStyle;
  /** Horizontal placement of the lyrics column. */
  position: "left" | "center" | "right";
  /** Where the small track card (artwork, title, artist) sits. */
  trackCorner: Corner;
  /** Where the large artwork goes when a song has no synced lyrics. */
  artPosition: "left" | "center" | "right";
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
  background: "gradient",
  bgColor: "#1c252b",
  bgBrightness: 1,
  bgSaturation: 1,
  bgSpeed: 1,
  bgBeat: true,
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
  tint: "#0b0d0f",
  opacity: 0.22,
  coverOpacity: 0.55,
  radius: 24,
  shadow: 1,
  showCaption: true,
  showCover: true,
  controls: true,
  format: "lines",
  glass: "beauty",
  frost: 0,
  wordColor: "auto",
  restBrightness: null,
  levels: true,
};

export const DEFAULT_WALLPAPER: WallpaperStyle = {
  ...SCENE,
  lyrics: { ...DEFAULT_LYRICS, anchor: 0.42 },
  position: "left",
  trackCorner: "bottom-left",
  artPosition: "center",
  width: 0.62,
  showTrack: true,
  dim: 0,
};

/** Fields every surface keeps for itself: presets and linking never touch them. */
const LAYOUT_KEYS = ["fontSize", "anchor", "align"] as const;

/** What a linked surface keeps for itself; alignment follows the main window. */
const OWN_WHEN_LINKED = ["fontSize", "anchor"] as const;

function keepLayout(next: LyricStyle, own: LyricStyle, keys: readonly (keyof LyricStyle)[] = LAYOUT_KEYS): LyricStyle {
  const out = { ...next };
  for (const k of keys) (out as Record<string, unknown>)[k] = own[k];
  return out;
}

export interface Preset {
  id: string;
  name: string;
  hint: string;
  /** Swatch colors for the preset card. */
  colors: [string, string];
  lyrics: Partial<LyricStyle>;
  scene?: Partial<SceneStyle>;
}

/** Ready-made looks. They change the style of the text and background, not its size or placement. */
export const PRESETS: Preset[] = [
  {
    id: "classic",
    name: "Классика",
    hint: "Как в Apple Music",
    colors: ["#2a3a42", "#0d0f11"],
    lyrics: {},
    scene: {},
  },
  {
    id: "mono",
    name: "Монохром",
    hint: "Строго, без цвета",
    colors: ["#3a3d40", "#0b0c0d"],
    lyrics: { accent: "auto", unsung: 0.24, glow: 0.55, blur: 0.9 },
    scene: { background: "animated", bgSaturation: 0.15, bgBrightness: 0.85 },
  },
  {
    id: "neon",
    name: "Неон",
    hint: "Цвет обложки и яркое свечение",
    colors: ["#4fd8ff", "#7d2cff"],
    lyrics: { accent: "cover", glow: 2.2, blur: 1.3, unsung: 0.3, fontWeight: 800 },
    scene: { background: "gradient", bgSaturation: 1.6, bgBrightness: 1.05, bgSpeed: 1.4 },
  },
  {
    id: "minimal",
    name: "Минимализм",
    hint: "Без блюра и свечения",
    colors: ["#e9ebec", "#8f979c"],
    lyrics: { fontWeight: 600, blur: 0, glow: 0, scaleInactive: false, emphasis: false, fill: "line", motion: "soft", unsung: 0.4 },
    scene: { background: "static", bgSaturation: 0.6, bgBrightness: 0.9 },
  },
  {
    id: "karaoke",
    name: "Караоке",
    hint: "Слова загораются по одному",
    colors: ["#ffd65a", "#2b2b2b"],
    lyrics: { fill: "word", accent: "#ffd65a", fontWeight: 840, glow: 1.4, emphasis: true, motion: "snappy", wave: 30 },
    scene: { background: "animated", bgSaturation: 0.9, bgBrightness: 0.8 },
  },
  {
    id: "cinema",
    name: "Кино",
    hint: "Засечки, мягкая прокрутка",
    colors: ["#c9d6dc", "#141a1e"],
    lyrics: { font: "serif", fontWeight: 520, unsung: 0.2, glow: 0.8, blur: 1.6, motion: "soft", wave: 70, lineSpacing: 1.25 },
    scene: { background: "animated", bgSaturation: 0.5, bgBrightness: 0.7, bgSpeed: 0.6 },
  },
];

/** The preset's lyric style on top of the defaults, keeping the surface's own layout. */
export function presetLyrics(p: Preset, own: LyricStyle): LyricStyle {
  return keepLayout({ ...DEFAULT_LYRICS, ...p.lyrics }, own);
}

export function presetScene(p: Preset): SceneStyle {
  return { ...SCENE, ...p.scene };
}

/** Presets the user saved; anything malformed in storage is skipped. */
export function userPresets(s: Settings): Preset[] {
  const list = Array.isArray(s.userPresets) ? (s.userPresets as Partial<Preset>[]) : [];
  return list
    .filter((p) => p && typeof p.id === "string" && typeof p.name === "string" && p.lyrics && typeof p.lyrics === "object")
    .map((p) => ({ hint: "Свой пресет", colors: ["#2a3a42", "#0d0f11"], ...p }) as Preset);
}

/** A preset from the current look: everything except the surface's own layout. */
export function makePreset(name: string, l: LyricStyle, scene?: SceneStyle): Preset {
  const lyrics: Partial<LyricStyle> = { ...l };
  for (const k of LAYOUT_KEYS) delete lyrics[k];
  const accent = l.accent.startsWith("#") ? l.accent : l.accent === "cover" ? "#8fa6b0" : "#e9ebec";
  return {
    id: `user-${Date.now().toString(36)}`,
    name,
    hint: "Свой пресет",
    colors: [accent, scene?.background === "solid" ? scene.bgColor : "#141a1e"],
    lyrics,
    scene: scene
      ? { background: scene.background, bgColor: scene.bgColor, bgBrightness: scene.bgBrightness, bgSaturation: scene.bgSaturation, bgSpeed: scene.bgSpeed, bgBeat: scene.bgBeat }
      : undefined,
  };
}

/** Which preset the style matches, if any (layout fields ignored). */
export function matchPreset(l: LyricStyle, list: Preset[] = PRESETS): string | null {
  for (const p of list) {
    const want = presetLyrics(p, l);
    if ((Object.keys(want) as (keyof LyricStyle)[]).every((k) => want[k] === l[k])) return p.id;
  }
  return null;
}

/** Shallow merge with defaults, one level deep for the nested lyric style. */
function merge<T extends { lyrics: LyricStyle }>(defaults: T, stored: unknown): T {
  const s = (stored && typeof stored === "object" ? stored : {}) as Partial<T>;
  return { ...defaults, ...s, lyrics: { ...defaults.lyrics, ...(s.lyrics ?? {}) } };
}

/** Linked surfaces copy the main window's look but keep their own size and position. */
function linkLyrics(own: LyricStyle, main: LyricStyle): LyricStyle {
  return keepLayout(main, own, OWN_WHEN_LINKED);
}

/** Each surface's own stored style (before linking), used when editing. */
export const ownMain = (s: Settings): MainStyle => merge(DEFAULT_MAIN, s.mainStyle);
export const ownWidget = (s: Settings): WidgetStyle => {
  const w = merge(DEFAULT_WIDGET, s.widgetStyle);
  // "Акрил Windows" from older versions is the beautiful glass now.
  return w.background === "acrylic" ? { ...w, background: "tint", glass: "beauty" } : w;
};

/** Whether the widget asks Windows to blur the desktop behind it. */
export const widgetBlur = (w: WidgetStyle): boolean => w.background === "tint" && w.glass === "beauty";
/**
 * The wallpaper look stored for a monitor: its own when monitors are split,
 * otherwise the shared one. Monitors without their own look start from the shared.
 */
export function ownWallpaper(s: Settings, monitor?: number): WallpaperStyle {
  if (s.wallpaperSplit && monitor !== undefined) {
    const map = (s.wallpaperStyles && typeof s.wallpaperStyles === "object" ? s.wallpaperStyles : {}) as Record<string, unknown>;
    const own = map[String(monitor)];
    if (own) return merge(DEFAULT_WALLPAPER, own);
  }
  return merge(DEFAULT_WALLPAPER, s.wallpaperStyle);
}

/** The settings patch that stores a wallpaper look for a monitor (or the shared one). */
export function wallpaperPatch(s: Settings, style: WallpaperStyle, monitor?: number): Partial<Settings> {
  if (s.wallpaperSplit && monitor !== undefined) {
    const map = (s.wallpaperStyles && typeof s.wallpaperStyles === "object" ? s.wallpaperStyles : {}) as Record<string, unknown>;
    return { wallpaperStyles: { ...map, [String(monitor)]: style } };
  }
  return { wallpaperStyle: style };
}

export function resolveMain(s: Settings): MainStyle {
  return ownMain(s);
}

export function resolveWidget(s: Settings): WidgetStyle {
  const w = ownWidget(s);
  return s.widgetLinked ? { ...w, lyrics: linkLyrics(w.lyrics, resolveMain(s).lyrics) } : w;
}

export function resolveWallpaper(s: Settings, monitor?: number): WallpaperStyle {
  const w = ownWallpaper(s, monitor);
  if (!s.wallpaperLinked) return w;
  const m = resolveMain(s);
  return {
    ...w,
    background: m.background,
    bgColor: m.bgColor,
    bgBrightness: m.bgBrightness,
    bgSaturation: m.bgSaturation,
    bgSpeed: m.bgSpeed,
    bgBeat: m.bgBeat,
    // The column moves with the main window's alignment, like setting it by hand.
    position: m.lyrics.align,
    lyrics: linkLyrics(w.lyrics, m.lyrics),
  };
}

/** The wallpaper's lyrics column as fractions of the screen width. */
export function wallpaperColumn(w: WallpaperStyle, margin = 0.06): { left: number; width: number } {
  const width = Math.min(0.9, Math.max(0.3, w.width));
  const left = w.position === "center" ? (1 - width) / 2 : w.position === "right" ? 1 - width - margin : margin;
  return { left, width };
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
