import { invoke } from "@tauri-apps/api/core";

import { clock, patchSettingsLocal } from "./store";
import type { Settings } from "./types";

const quiet = (p: Promise<unknown>) => p.catch((e) => console.warn(e));

export const togglePlay = () => quiet(invoke("media_toggle"));
export const nextTrack = () => quiet(invoke("media_next"));
export const prevTrack = () => quiet(invoke("media_prev"));
export const retryLyrics = () => quiet(invoke("retry_lyrics"));

/** Seeks to a position on the player's timeline (milliseconds). */
export function seek(ms: number) {
  const target = Math.max(0, Math.round(ms));
  clock.seekLocal(target);
  return quiet(invoke("media_seek", { ms: target }));
}

/** Seeks so that the given lyrics timestamp is "now". */
export function seekLyrics(ms: number) {
  return seek(ms - clock.offsetMs + 30);
}

export const saveUserLyrics = (kind: "synced" | "plain", text: string) => quiet(invoke("save_user_lyrics", { kind, text }));
export const deleteUserLyrics = () => quiet(invoke("delete_user_lyrics"));

export const setOffset =(ms: number) => quiet(invoke("set_offset", { ms: Math.round(ms) }));

// Sliders fire on every step: apply locally at once, send to Rust at most every 60 ms.
let pending: Partial<Settings> | null = null;
let flushTimer = 0;

export function updateSettings(patch: Partial<Settings>) {
  patchSettingsLocal(patch);
  pending = { ...pending, ...patch };
  if (!flushTimer) {
    flushTimer = window.setTimeout(() => {
      const p = pending;
      pending = null;
      flushTimer = 0;
      if (p) quiet(invoke("set_settings", { patch: p }));
    }, 60);
  }
}

export const openSettings = () => quiet(invoke("open_settings"));
export const setWidgetSize = (width: number, height: number) => quiet(invoke("set_widget_size", { width, height }));
export const getWidgetSize = () => invoke<[number, number] | null>("get_widget_size").catch(() => null);
export const listMonitors = () => invoke<string[]>("list_monitors").catch(() => [] as string[]);
