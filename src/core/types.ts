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
}

export type LyricsKind = "loading" | "synced" | "plain" | "instrumental" | "none";

export interface LyricsPayload {
  key: string;
  kind: LyricsKind;
  text: string;
  source: "lrclib" | "genius" | "user" | "";
}

export interface CoverPayload {
  key: string;
  dataUrl: string;
}

export type ThemeSetting = "dark" | "light" | "system";

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
  bgFps: number;
  autostart: boolean;
  /** The close button hides to the tray instead of quitting. */
  closeToTray: boolean;
}

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
}
