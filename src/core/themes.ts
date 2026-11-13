/**
 * Theme packs (Rust: themes.rs, format: docs/THEMES.md). A theme carries the
 * look of the main window, the widget and the wallpaper, and optionally a
 * stylesheet and a background shader.
 *
 * Its styles come from a file anyone could have written, so every field is
 * checked here: unknown fields are dropped, numbers are kept to the ranges the
 * settings allow, words to the choices MUSE knows. Like presets, a theme never
 * changes sizes and placement, only the look.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";

import { getState, subscribe } from "./store";
import {
  DEFAULT_LYRICS,
  DEFAULT_SCENE,
  DEFAULT_WALLPAPER,
  DEFAULT_WIDGET,
  keepLayout,
  ownMain,
  ownWallpaper,
  ownWidget,
  type LyricStyle,
  type MainStyle,
  type SceneStyle,
  type WallpaperStyle,
  type WidgetStyle,
} from "./style";
import type { Settings } from "./types";

export interface ThemeInfo {
  id: string;
  name: string;
  author: string;
  version: string;
  description: string;
  colors: string[];
  data: Record<string, unknown>;
  css: string | null;
  shader: string | null;
  error: string | null;
}

/** The theme.json format this version writes. */
export const THEME_FORMAT = 1;

type Rule =
  | { num: [number, number] }
  | { numOrNull: [number, number] }
  | { oneOf: readonly string[] }
  | { color: readonly string[] }
  | { bool: true };

type Rules<T> = Partial<Record<keyof T, Rule>>;

const HEX = /^#[0-9a-fA-F]{6}$/;

const LYRIC_RULES: Rules<LyricStyle> = {
  font: { oneOf: ["inter", "segoe", "serif", "rounded", "mono"] },
  fontWeight: { num: [300, 900] },
  lineSpacing: { num: [0.3, 2.4] },
  accent: { color: ["auto", "cover"] },
  unsung: { num: [0.04, 0.9] },
  blur: { num: [0, 2.5] },
  glow: { num: [0, 2.5] },
  fill: { oneOf: ["smooth", "word", "line"] },
  emphasis: { bool: true },
  scaleInactive: { bool: true },
  motion: { oneOf: ["soft", "normal", "snappy"] },
  wave: { num: [0, 110] },
};

const SCENE_RULES: Rules<SceneStyle> = {
  background: { oneOf: ["gradient", "animated", "static", "solid", "theme"] },
  bgColor: { color: [] },
  bgBrightness: { num: [0.3, 1.8] },
  bgSaturation: { num: [0, 2] },
  bgSpeed: { num: [0, 3] },
  bgBeat: { bool: true },
};

const WIDGET_RULES: Rules<WidgetStyle> = {
  background: { oneOf: ["none", "tint", "cover"] },
  tint: { color: [] },
  opacity: { num: [0, 1] },
  coverOpacity: { num: [0.1, 1] },
  radius: { num: [0, 40] },
  shadow: { num: [0, 2] },
  glass: { oneOf: ["beauty", "fast"] },
  frost: { num: [0, 1] },
  format: { oneOf: ["lines", "line"] },
  wordColor: { color: ["auto", "cover"] },
  restBrightness: { numOrNull: [0.06, 0.9] },
  levels: { bool: true },
};

const WALLPAPER_RULES: Rules<WallpaperStyle> = { ...(SCENE_RULES as Rules<WallpaperStyle>), dim: { num: [0, 0.7] } };

function valid(rule: Rule, v: unknown): unknown {
  if ("num" in rule || "numOrNull" in rule) {
    if (v === null && "numOrNull" in rule) return null;
    const [lo, hi] = "num" in rule ? rule.num : rule.numOrNull;
    return typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined;
  }
  if ("oneOf" in rule) return typeof v === "string" && rule.oneOf.includes(v) ? v : undefined;
  if ("color" in rule) return typeof v === "string" && (HEX.test(v) || rule.color.includes(v)) ? v : undefined;
  return typeof v === "boolean" ? v : undefined;
}

/** The fields of `src` that pass `rules`, numbers clamped; everything else dropped. */
export function pick<T>(rules: Rules<T>, src: unknown): Partial<T> {
  const out: Record<string, unknown> = {};
  if (!src || typeof src !== "object") return out as Partial<T>;
  for (const [k, rule] of Object.entries(rules) as [string, Rule][]) {
    const v = valid(rule, (src as Record<string, unknown>)[k]);
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
}

interface Part<T> {
  style: Partial<T>;
  lyrics: Partial<LyricStyle>;
}

/** What a theme sets on each surface, checked; a surface it leaves out is null. */
export function themeLooks(t: Pick<ThemeInfo, "data" | "shader">) {
  const part = <T>(key: string, rules: Rules<T>): Part<T> | null => {
    const src = t.data[key];
    if (!src || typeof src !== "object") return null;
    const style = pick<T>(rules, src) as Record<string, unknown>;
    // Without a shader of its own, "from the theme" means the cover's colours.
    if (style.background === "theme" && !t.shader) style.background = "gradient";
    return { style: style as Partial<T>, lyrics: pick<LyricStyle>(LYRIC_RULES, (src as Record<string, unknown>).lyrics) };
  };
  return {
    main: part<MainStyle>("main", SCENE_RULES as Rules<MainStyle>),
    widget: part<WidgetStyle>("widget", WIDGET_RULES),
    wallpaper: part<WallpaperStyle>("wallpaper", WALLPAPER_RULES),
  };
}

/** Defaults of the fields a theme may set: what a theme leaves out goes back to them. */
function lookDefaults<T>(defaults: T, rules: Rules<T>): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(rules) as (keyof T)[]) out[k] = defaults[k];
  return out;
}

/** The theme's lyric style on the defaults, keeping the surface's own size and placement. */
const lyricsOf = (base: LyricStyle, theme: Partial<LyricStyle>, own: LyricStyle) => keepLayout({ ...base, ...theme }, own);

/** The settings patch that applies a theme and makes it the active one. */
export function applyTheme(s: Settings, t: ThemeInfo): Partial<Settings> {
  const looks = themeLooks(t);
  const patch: Partial<Settings> = { activeTheme: t.id };
  if (looks.main) {
    const m = ownMain(s);
    patch.mainStyle = { ...m, ...DEFAULT_SCENE, ...looks.main.style, lyrics: lyricsOf(DEFAULT_LYRICS, looks.main.lyrics, m.lyrics) };
  }
  if (looks.widget) {
    const w = ownWidget(s);
    patch.widgetStyle = {
      ...w,
      ...lookDefaults(DEFAULT_WIDGET, WIDGET_RULES),
      ...looks.widget.style,
      lyrics: lyricsOf(DEFAULT_WIDGET.lyrics, looks.widget.lyrics, w.lyrics),
    };
  }
  const wall = looks.wallpaper;
  if (wall) {
    const one = (w: WallpaperStyle): WallpaperStyle => ({
      ...w,
      ...lookDefaults(DEFAULT_WALLPAPER, WALLPAPER_RULES),
      ...wall.style,
      lyrics: lyricsOf(DEFAULT_WALLPAPER.lyrics, wall.lyrics, w.lyrics),
    });
    patch.wallpaperStyle = one(ownWallpaper(s));
    if (s.wallpaperSplit && s.wallpaperStyles && typeof s.wallpaperStyles === "object") {
      const map = s.wallpaperStyles as Record<string, unknown>;
      patch.wallpaperStyles = Object.fromEntries(Object.keys(map).map((k) => [k, one(ownWallpaper(s, Number(k)))]));
    }
  }
  return patch;
}

/** theme.json for the current look, ready to share. */
export function themeFromSettings(s: Settings, meta: { name: string; author: string }): Record<string, unknown> {
  const m = ownMain(s);
  const w = ownWidget(s);
  const wp = ownWallpaper(s);
  const accent = m.lyrics.accent.startsWith("#") ? m.lyrics.accent : "#e9ebec";
  return {
    muse: THEME_FORMAT,
    name: meta.name,
    ...(meta.author ? { author: meta.author } : {}),
    version: "1.0",
    colors: [accent, m.background === "solid" ? m.bgColor : "#141a1e"],
    main: { ...pick(SCENE_RULES as Rules<MainStyle>, m), lyrics: pick(LYRIC_RULES, m.lyrics) },
    widget: { ...pick(WIDGET_RULES, w), lyrics: pick(LYRIC_RULES, w.lyrics) },
    wallpaper: { ...pick(WALLPAPER_RULES, wp), lyrics: pick(LYRIC_RULES, wp.lyrics) },
  };
}

/** Swatch colours for a theme's card. */
export function themeColors(t: ThemeInfo): [string, string] {
  if (t.colors.length >= 2) return [t.colors[0], t.colors[1]];
  const main = themeLooks(t).main;
  const accent = main?.lyrics.accent?.startsWith("#") ? main.lyrics.accent : "#8fa6b0";
  const bg = main?.style.background === "solid" && main.style.bgColor ? main.style.bgColor : "#141a1e";
  return [t.colors[0] ?? accent, bg];
}

// ---- The active theme in this window: its stylesheet and shader ----

interface Active {
  id: string;
  css: string | null;
  shader: string | null;
}

let active: Active | null = null;
/** The shader that failed to compile here, and why (shown in the settings). */
let shaderError: { shader: string; message: string } | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const watch = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export const useThemeShader = () => useSyncExternalStore(watch, () => active?.shader ?? null);
export const useThemeShaderError = () =>
  useSyncExternalStore(watch, () => (shaderError && shaderError.shader === active?.shader ? shaderError.message : null));

export function reportShaderError(shader: string, message: string) {
  if (shaderError?.shader === shader && shaderError.message === message) return;
  shaderError = { shader, message };
  notify();
}

async function load(id: string) {
  const t = id ? await invoke<ThemeInfo | null>("get_theme", { id }).catch(() => null) : null;
  active = t && !t.error ? { id, css: t.css, shader: t.shader } : null;
  let el = document.getElementById("muse-theme") as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = "muse-theme";
    document.head.appendChild(el);
  }
  // Text, not markup: the stylesheet can only style.
  el.textContent = active?.css ?? "";
  notify();
}

/** Keeps the active theme's stylesheet and shader in this window. */
export function installThemes() {
  let id = getState().settings.activeTheme ?? "";
  load(id);
  subscribe(() => {
    const next = getState().settings.activeTheme ?? "";
    if (next !== id) {
      id = next;
      load(id);
    }
  });
  // Installed again (updated) or removed.
  listen("themes:changed", () => load(id));
}
