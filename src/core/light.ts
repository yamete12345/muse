/**
 * Light that follows the cursor across every glass surface. One listener for
 * the whole window: the surfaces under the pointer get --mx/--my (position) and
 * the is-lit class; CSS animates the rest.
 */
const SELECTOR = ".lg, .st-card, .st-preset, .pv, .widget-controls";

let lit = new Set<HTMLElement>();
let last: PointerEvent | null = null;
let frame = 0;

function apply() {
  frame = 0;
  const e = last;
  if (!e) return;
  const now = new Set<HTMLElement>();
  let el = (e.target as Element | null)?.closest?.(SELECTOR) as HTMLElement | null;
  while (el) {
    now.add(el);
    const b = el.getBoundingClientRect();
    if (b.width > 0 && b.height > 0) {
      el.style.setProperty("--mx", `${(((e.clientX - b.left) / b.width) * 100).toFixed(1)}%`);
      el.style.setProperty("--my", `${(((e.clientY - b.top) / b.height) * 100).toFixed(1)}%`);
    }
    el = el.parentElement?.closest(SELECTOR) as HTMLElement | null;
  }
  for (const o of lit) if (!now.has(o)) o.classList.remove("is-lit");
  for (const n of now) n.classList.add("is-lit");
  lit = now;
}

function clear() {
  for (const o of lit) o.classList.remove("is-lit");
  lit = new Set();
  last = null;
}

export function installCursorLight() {
  window.addEventListener(
    "pointermove",
    (e) => {
      last = e;
      if (!frame) frame = requestAnimationFrame(apply);
    },
    { passive: true },
  );
  document.documentElement.addEventListener("pointerleave", clear);
  window.addEventListener("blur", clear);
}
