/**
 * Looping decoration — the live cover's drift, tilt, sheen and glow, the
 * playing bars of the sources — runs on the app's own frame clock. Its CSS
 * animations stay paused and get their time from here, so the browser does
 * not redraw them (and the glass over them) at the display's full refresh
 * rate, 180 times a second on some screens.
 */
import { savingOf } from "./power";
import { getState } from "./store";
import { onFrame } from "./ticker";

let all = 0;
/** Time while music plays: paused music freezes the live cover where it is. */
let playing = 0;

export function installLoops() {
  onFrame((_ts, dt) => {
    const s = getState();
    // Saving mode: decoration stands still.
    if (savingOf(s)) return;
    all += dt;
    if (s.media?.playing) playing += dt;
    for (const el of document.querySelectorAll<HTMLElement>(".lc.is-live")) el.style.setProperty("--loop-t", `${(-playing).toFixed(3)}s`);
    for (const el of document.querySelectorAll<HTMLElement>(".src-eq")) el.style.setProperty("--loop-t", `${(-all).toFixed(3)}s`);
  });
}
