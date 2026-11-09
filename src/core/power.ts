/**
 * Saving mode: on battery (if enabled) and in game mode, MUSE goes easy so
 * the game or the battery gets the power. Everything runs at 24 frames, the
 * background stands still and does not listen for the beat, cover motion
 * stops and the live wallpaper sleeps. The lyrics keep moving.
 */
import { getState, subscribe, useStore, type AppStore } from "./store";
import { setFrameRate } from "./ticker";

export type Saving = "game" | "battery" | null;

/** Frames per second while saving. */
export const SAVING_FPS = 24;

export function savingOf(s: Pick<AppStore, "settings" | "power">): Saving {
  const mode = s.settings.gameMode ?? "auto";
  if (mode === "always" || (mode === "auto" && s.power.game)) return "game";
  if ((s.settings.batterySaver ?? true) && s.power.battery) return "battery";
  return null;
}

export const useSaving = (): Saving => useStore(savingOf);

/** Frame rate of everything in this window, from settings and saving mode. */
export function frameRateOf(s: Pick<AppStore, "settings" | "power">): number {
  return savingOf(s) ? SAVING_FPS : s.settings.fps || 60;
}

/** Keeps this window's frame cap and the root's `is-saving` class (CSS motion) current. */
export function installPower() {
  const apply = () => {
    const s = getState();
    setFrameRate(frameRateOf(s));
    document.documentElement.classList.toggle("is-saving", savingOf(s) !== null);
  };
  apply();
  subscribe(apply);
}
