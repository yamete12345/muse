import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { PlaybackClock } from "./clock";
import type { CoverPayload, LyricsPayload, MediaState, Settings, Snapshot } from "./types";

export interface AppStore {
  ready: boolean;
  media: MediaState | null;
  cover: string | null;
  lyrics: LyricsPayload | null;
  settings: Settings;
  offsetMs: number;
}

const defaultSettings: Settings = {
  theme: "dark",
  widgetEnabled: false,
  widgetAcrylic: false,
  widgetFontSize: 26,
  simpleGlass: false,
  bgFps: 30,
  autostart: false,
};

let state: AppStore = { ready: false, media: null, cover: null, lyrics: null, settings: defaultSettings, offsetMs: 0 };
const listeners = new Set<() => void>();

export const clock = new PlaybackClock();

export function getState(): AppStore {
  return state;
}

function set(patch: Partial<AppStore>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useStore<T>(select: (s: AppStore) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}

function coverFor(c: CoverPayload | null, key: string | undefined): string | null {
  return c && c.dataUrl && c.key === key ? c.dataUrl : null;
}

export async function initStore() {
  await Promise.all([
    listen<MediaState | null>("media:state", (e) => {
      const m = e.payload;
      clock.sync(m);
      const patch: Partial<AppStore> = { media: m };
      if (!m || m.key !== state.media?.key) patch.cover = null;
      set(patch);
    }),
    listen<CoverPayload>("media:cover", (e) => {
      if (e.payload.key === state.media?.key) set({ cover: e.payload.dataUrl || null });
    }),
    listen<LyricsPayload | null>("lyrics:loaded", (e) => set({ lyrics: e.payload })),
    listen<Settings>("settings:changed", (e) => set({ settings: e.payload })),
    listen<number>("offset:changed", (e) => {
      clock.offsetMs = e.payload;
      set({ offsetMs: e.payload });
    }),
  ]);

  const snap = await invoke<Snapshot>("get_snapshot");
  clock.sync(snap.media);
  clock.offsetMs = snap.offsetMs;
  set({
    ready: true,
    media: snap.media,
    cover: coverFor(snap.cover, snap.media?.key),
    lyrics: snap.lyrics,
    settings: snap.settings,
    offsetMs: snap.offsetMs,
  });
}
