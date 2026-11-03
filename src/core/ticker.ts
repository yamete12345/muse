/** One requestAnimationFrame loop shared by every animated part of a window. */
type FrameFn = (ts: number, dt: number) => void;

const subscribers = new Set<FrameFn>();
let raf = 0;
let last = 0;
let paused = false;

function loop(ts: number) {
  raf = requestAnimationFrame(loop);
  const dt = last ? Math.min(0.05, (ts - last) / 1000) : 1 / 60;
  last = ts;
  for (const fn of subscribers) fn(ts, dt);
}

function start() {
  if (raf || paused || subscribers.size === 0) return;
  last = 0;
  raf = requestAnimationFrame(loop);
}

function stop() {
  cancelAnimationFrame(raf);
  raf = 0;
}

export function onFrame(fn: FrameFn): () => void {
  subscribers.add(fn);
  start();
  return () => {
    subscribers.delete(fn);
    if (subscribers.size === 0) stop();
  };
}

/** Stops all animation while the window is minimized or hidden. */
export function setPaused(value: boolean) {
  paused = value;
  if (paused) stop();
  else start();
}

document.addEventListener("visibilitychange", () => setPaused(document.hidden));
