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
  widgetFontSize: number;
  simpleGlass: boolean;
  bgFps: number;
  autostart: boolean;
}

export interface Snapshot {
  media: MediaState | null;
  cover: CoverPayload | null;
  lyrics: LyricsPayload | null;
  settings: Settings;
  offsetMs: number;
}
