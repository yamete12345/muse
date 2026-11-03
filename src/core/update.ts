import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** A release on GitHub compared with the running version (from Rust). */
export interface UpdateInfo {
  current: string;
  version: string;
  available: boolean;
  notes: string;
  published: string;
  page: string;
  size: number;
}

export type UpdateStatus = "idle" | "checking" | "latest" | "available" | "downloading" | "installing" | "error";

interface UpdateState {
  status: UpdateStatus;
  info: UpdateInfo | null;
  /** Download progress, 0..1. */
  progress: number;
  error: string;
  /** The user closed the notice for this version. */
  dismissed: string;
}

let state: UpdateState = { status: "idle", info: null, progress: 0, error: "", dismissed: "" };
const listeners = new Set<() => void>();

function set(patch: Partial<UpdateState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function useUpdate(): UpdateState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

const message = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : "что-то пошло не так");

export async function checkForUpdate() {
  if (state.status === "checking" || state.status === "downloading" || state.status === "installing") return;
  set({ status: "checking", error: "" });
  try {
    const info = await invoke<UpdateInfo>("check_update");
    set({ info, status: info.available ? "available" : "latest" });
  } catch (e) {
    set({ status: "error", error: message(e) });
  }
}

/** Downloads, verifies and starts the installer; MUSE closes and comes back updated. */
export async function installUpdate() {
  if (state.status === "downloading" || state.status === "installing") return;
  set({ status: "downloading", progress: 0, error: "" });
  try {
    await invoke("install_update");
    set({ status: "installing", progress: 1 });
  } catch (e) {
    set({ status: "error", error: message(e) });
  }
}

export function dismissUpdate() {
  if (state.info) set({ dismissed: state.info.version });
}

export const openLink = (url: string) => invoke("open_link", { url }).catch((e) => console.warn(e));

/** Subscribes this window to background update news from Rust. */
export function initUpdates() {
  listen<UpdateInfo>("update:available", (e) => {
    if (state.status === "downloading" || state.status === "installing") return;
    set({ info: e.payload, status: "available" });
  });
  listen<{ received: number; total: number }>("update:progress", (e) => {
    const { received, total } = e.payload;
    set({ progress: total > 0 ? received / total : 0 });
  });
}

export const REPO_URL = "https://github.com/yamete12345/muse";
