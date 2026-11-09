import type { PartsMode, PartsPayload } from "./parts";

export interface MediaState {
  key: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  positionMs: number;
  updatedAtMs: number;
  playing: boolean;
  rate: number;
  canSeek: boolean;
  app: string;
  /** Readable name of `app`. */
  appName: string;
}

export type LyricsKind = "loading" | "synced" | "plain" | "instrumental" | "none";

export interface LyricsPayload {
  key: string;
  kind: LyricsKind;
  text: string;
  source: "lrclib" | "genius" | "user" | "";
  /** E.g. that these are the original's lyrics, for a remix. */
  note?: string;
}

export interface CoverPayload {
  key: string;
  dataUrl: string;
}

export type ThemeSetting = "dark" | "light" | "system";

export type GameMode = "auto" | "always" | "off";

/** On battery? A game (or a video) filling the screen? (Rust: power.rs) */
export interface PowerState {
  battery: boolean;
  game: boolean;
}

export interface Settings {
  theme: ThemeSetting;
  widgetEnabled: boolean;
  widgetEdit?: boolean;
  widgetAcrylic: boolean;
  widgetOnTop: boolean;
  widgetClickThrough: boolean;
  widgetLinked: boolean;
  wallpaperEnabled: boolean;
  /** Monitor indexes with a live wallpaper; -1 is the primary monitor. */
  wallpaperMonitors: number[];
  /** Each monitor keeps its own look instead of sharing one. */
  wallpaperSplit: boolean;
  /** Per-monitor looks keyed by monitor index, used when split. */
  wallpaperStyles: unknown;
  /** Presets the user saved, resolved in core/style.ts. */
  userPresets: unknown;
  wallpaperPauseCovered: boolean;
  wallpaperLinked: boolean;
  /** Opaque appearance objects, resolved against defaults in core/style.ts. */
  mainStyle: unknown;
  widgetStyle: unknown;
  wallpaperStyle: unknown;
  simpleGlass: boolean;
  /** Old background-only frame rate; `fps` covers everything now. */
  bgFps: number;
  /** Frames per second of all animation: 24, 30 or 60. */
  fps: number;
  /** On battery, go easy like in game mode. */
  batterySaver: boolean;
  /** "auto": while something fills the screen; "always"; "off". */
  gameMode: GameMode;
  autostart: boolean;
  /** The close button hides to the tray instead of quitting. */
  closeToTray: boolean;
  /** Look for new versions on GitHub in the background. */
  updateCheck: boolean;
  /** Covers drift, tilt and catch a highlight while music plays. */
  liveCover: boolean;
  /** Label song parts and their singers. */
  songParts: PartsMode;
  /** App id of the media session to show; empty: whatever plays. */
  mediaSource: string;
  /** Extra lyrics offset per app id, ms. */
  appOffsets: Record<string, number>;
  /** Latin letters for Japanese and Korean lyrics. */
  romaji: RomajiMode;
}

export type RomajiMode = "under" | "instead" | "off";

export interface MonitorInfo {
  name: string;
  primary: boolean;
}

/** Widget bounds in logical pixels within its monitor's work area. */
export interface WidgetGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  areaWidth: number;
  areaHeight: number;
}

export interface Snapshot {
  media: MediaState | null;
  cover: CoverPayload | null;
  lyrics: LyricsPayload | null;
  settings: Settings;
  offsetMs: number;
  parts: PartsPayload | null;
}
