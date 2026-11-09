/**
 * One animation loop shared by every animated part of a window, capped at
 * the frame rate chosen in settings (24, 30 or 60). Between frames the loop
 * sleeps on a timer instead of waking up on every display refresh (180 times
 * a second on some screens), then lines up with the display again.
 */
type FrameFn = (ts: number, dt: number) => void;

const subscribers = new Set<FrameFn>();
let raf = 0;
let timer = 0;
/** When the last frame went out to the subscribers. */
let last = 0;
let fps = 60;
/** Why the loop is stopped: hidden window, covered wallpaper, saving mode... */
const pauses = new Set<string>();

const running = () => pauses.size === 0 && subscribers.size > 0;

/** Asks for the next frame: right away, or after sleeping until it is nearly due. */
function schedule() {
  if (raf || timer || !running()) return;
  // Wake a little early; requestAnimationFrame then waits for the display.
  const wait = last ? last + 1000 / fps - performance.now() - 4 : 0;
  if (wait > 2) {
    timer = window.setTimeout(() => {
      timer = 0;
      if (running()) raf = requestAnimationFrame(loop);
    }, wait);
  } else {
    raf = requestAnimationFrame(loop);
  }
}

function loop(ts: number) {
  raf = 0;
  const frame = 1000 / fps;
  const elapsed = last ? ts - last : frame;
  // A little early is fine: display frames do not land exactly on the cap.
  if (elapsed >= frame - 2) {
    const dt = Math.min(0.1, elapsed / 1000);
    // Keep the average on the cap; start over after a long gap.
    last = elapsed > frame * 2 || !last ? ts : last + frame;
    for (const fn of subscribers) fn(ts, dt);
  }
  schedule();
}

function stop() {
  cancelAnimationFrame(raf);
  clearTimeout(timer);
  raf = 0;
  timer = 0;
}

export function onFrame(fn: FrameFn): () => void {
  subscribers.add(fn);
  if (subscribers.size === 1) last = 0;
  schedule();
  return () => {
    subscribers.delete(fn);
    if (subscribers.size === 0) stop();
  };
}

/** Frames per second for everything driven by this loop. */
export function setFrameRate(value: number) {
  fps = Math.max(10, Math.min(120, value || 60));
}

/** Stops (or resumes) all animation for one reason; it runs only when no reason is left. */
export function setPaused(value: boolean, reason = "hidden") {
  if (value) pauses.add(reason);
  else pauses.delete(reason);
  if (pauses.size > 0) {
    stop();
  } else {
    last = 0;
    schedule();
  }
}

if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => setPaused(document.hidden, "hidden"));
