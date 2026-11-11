import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { useSaving } from "../core/power";
import { onFrame } from "../core/ticker";

const BARS = 4;
/** Rest height of a bar, as a share of the full one. */
const REST = 0.16;
/** No levels for this long: the sound cannot be heard, fall back to the loop. */
const STALE_MS = 1500;

/**
 * Small level bars that follow the music: each bar is one band of the sound,
 * from bass to treble, reported by Rust about 30 times a second. They rise
 * fast and settle slowly, like a meter. Without levels (the setting is off,
 * the player cannot be heard, saving mode) they fall back to a gentle loop.
 */
export function LevelBars({ playing, live }: { playing: boolean; live: boolean }) {
  const saving = useSaving() !== null;
  const want = playing && live && !saving;
  const [heard, setHeard] = useState(false);
  const bars = useRef<(HTMLElement | null)[]>([]);
  const target = useRef<number[]>(new Array(BARS).fill(0));
  const shown = useRef<number[]>(new Array(BARS).fill(0));
  const last = useRef(0);

  useEffect(() => {
    if (!want) {
      setHeard(false);
      return;
    }
    const sync = () => invoke("listen_levels", { on: document.visibilityState === "visible" }).catch(() => {});
    sync();
    document.addEventListener("visibilitychange", sync);
    const off = listen<number[]>("audio:levels", (e) => {
      target.current = e.payload;
      last.current = performance.now();
      setHeard(true);
    });
    const stop = onFrame((_ts, dt) => {
      if (performance.now() - last.current > STALE_MS) {
        setHeard(false);
        return;
      }
      for (let i = 0; i < BARS; i++) {
        const t = target.current[i] ?? 0;
        const v = shown.current[i];
        // Up quickly, down slowly.
        const k = t > v ? Math.min(1, dt * 28) : Math.min(1, dt * 7);
        shown.current[i] = v + (t - v) * k;
        const el = bars.current[i];
        if (el) el.style.transform = `scaleY(${(REST + (1 - REST) * shown.current[i]).toFixed(3)})`;
      }
    });
    return () => {
      document.removeEventListener("visibilitychange", sync);
      off.then((f) => f());
      stop();
      invoke("listen_levels", { on: false }).catch(() => {});
    };
  }, [want]);

  // When the levels stop, the bars go back to their CSS loop or rest.
  useEffect(() => {
    if (!heard) for (const el of bars.current) if (el) el.style.transform = "";
  }, [heard]);

  return (
    <span className={`widget-eq ${playing ? "is-playing" : ""} ${heard ? "is-live" : ""}`} aria-hidden>
      {Array.from({ length: BARS }, (_, i) => (
        <i key={i} ref={(el) => void (bars.current[i] = el)} />
      ))}
    </span>
  );
}
