/**
 * Renders synced lyrics with plain DOM driven by the shared rAF loop.
 * React only mounts the container; nothing here triggers React renders.
 *
 * Per frame the engine only touches:
 *  - transforms of lines whose spring is moving,
 *  - the `--q` fill variable of the word being sung,
 *  - letters of an "emphasis" word (long held note) and the interlude dots.
 * Blur/opacity/scale changes are CSS transitions keyed off `data-d`.
 */
import type { Item } from "./lrc";
import { Spring } from "./spring";
import type { EngineTuning } from "./style";
import { onFrame } from "./ticker";

interface WordView {
  el: HTMLElement;
  start: number;
  end: number;
  letters: HTMLElement[] | null;
  q: number;
  e: number;
}

interface ItemView {
  item: Item;
  el: HTMLElement;
  height: number;
  spring: Spring;
  pending: number | null;
  pendingAt: number;
  shown: boolean;
  words: WordView[];
  dots: HTMLElement | null;
  dotEls: HTMLElement[];
}

export interface EngineOptions {
  /** Center the active line on the anchor instead of aligning its top. */
  center?: boolean;
  interactive: boolean;
  onSeek?: (ms: number) => void;
}

const DEFAULT_TUNING: EngineTuning = {
  stiffness: 110,
  damping: 21,
  wave: 42,
  fill: "smooth",
  emphasis: true,
  glow: 1,
  anchor: 0.3,
};

const FREE_SCROLL_MS = 2600;
const CJK = /[぀-ヿ㐀-鿿가-힯]/u;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeOut = (x: number) => 1 - (1 - x) * (1 - x) * (1 - x);
const smooth = (x: number) => x * x * (3 - 2 * x);

export class LyricsEngine {
  private views: ItemView[] = [];
  private active = -1;
  private viewH = 0;
  private tops: number[] = [];
  private total = 0;
  private free = false;
  private freeOffset = 0;
  private freeTimer = 0;
  private releasing: ItemView | null = null;
  private tune: EngineTuning = { ...DEFAULT_TUNING };
  private readonly unsubscribe: () => void;
  private readonly ro: ResizeObserver;

  constructor(
    private readonly root: HTMLElement,
    private readonly time: () => number,
    private readonly opts: EngineOptions,
  ) {
    this.ro = new ResizeObserver(() => this.layout(true));
    this.ro.observe(root);
    if (opts.interactive) {
      root.classList.add("is-interactive");
      root.addEventListener("wheel", this.onWheel, { passive: true });
    }
    this.unsubscribe = onFrame(this.frame);
    document.fonts?.ready.then(() => this.layout(true));
  }

  private suspended = false;

  /** Skips all per-frame work while the view is hidden, then catches up at once. */
  setSuspended(value: boolean) {
    if (value === this.suspended) return;
    this.suspended = value;
    if (value || this.views.length === 0) return;
    const a = this.findActive(this.time());
    if (a !== this.active) {
      const prev = this.views[this.active];
      if (prev) this.release(prev);
      this.active = a;
    }
    this.layout(true);
  }

  destroy() {
    this.unsubscribe();
    this.ro.disconnect();
    this.root.removeEventListener("wheel", this.onWheel);
    clearTimeout(this.freeTimer);
    this.root.replaceChildren();
  }

  /** Applies appearance/motion settings live; geometry is re-measured afterwards. */
  configure(t: Partial<EngineTuning>) {
    const prev = this.tune;
    this.tune = { ...prev, ...t };
    this.root.dataset.fill = this.tune.fill;
    for (const v of this.views) {
      v.spring.stiffness = this.tune.stiffness;
      v.spring.damping = this.tune.damping;
    }
    if (prev.fill !== this.tune.fill || (prev.emphasis && !this.tune.emphasis)) {
      const cur = this.views[this.active];
      if (cur) this.resetWords(cur);
    }
    // Fonts/sizes may have changed through CSS variables in the same commit.
    requestAnimationFrame(() => this.layout(false));
  }

  /**
   * Puts a small caption ("Куплет 1 · Artist") above the given lines, by item
   * index; other lines lose theirs. Works on the lines already built.
   */
  setLabels(labels: Map<number, { text: string; voice: number }>) {
    let changed = false;
    this.views.forEach((v, i) => {
      const want = labels.get(i);
      let el = v.el.querySelector<HTMLElement>(":scope > .lx-label");
      if (!want) {
        if (el) {
          el.remove();
          changed = true;
        }
        return;
      }
      if (!el) {
        el = document.createElement("div");
        el.className = "lx-label";
        v.el.prepend(el);
        changed = true;
      }
      if (el.textContent !== want.text) {
        el.textContent = want.text;
        changed = true;
      }
      el.dataset.voice = String(want.voice);
    });
    // Labels change line heights: re-measure and let the lines glide.
    if (changed) requestAnimationFrame(() => this.layout(false));
  }

  setItems(items: Item[]) {
    this.root.replaceChildren();
    this.views = items.map((it) => this.build(it));
    this.active = -1;
    this.releasing = null;
    this.exitFree(false);
    this.layout(true);
    this.root.classList.remove("lx-enter");
    void this.root.offsetWidth;
    this.root.classList.add("lx-enter");
  }

  // ---- DOM -------------------------------------------------------------

  private build(item: Item): ItemView {
    const el = document.createElement("div");
    el.className = "lx-item";
    el.dataset.d = "9";
    const view: ItemView = {
      item,
      el,
      height: 0,
      spring: new Spring(0, this.tune.stiffness, this.tune.damping),
      pending: null,
      pendingAt: 0,
      shown: true,
      words: [],
      dots: null,
      dotEls: [],
    };

    if (item.kind === "gap") {
      el.classList.add("lx-gap");
      const dots = document.createElement("div");
      dots.className = "lx-dots";
      for (let i = 0; i < 3; i++) {
        const d = document.createElement("span");
        d.className = "lx-dot";
        dots.appendChild(d);
        view.dotEls.push(d);
      }
      el.appendChild(dots);
      view.dots = dots;
    } else {
      el.classList.add("lx-line");
      const text = document.createElement("div");
      text.className = "lx-text";
      const { line } = item;
      const longest = Math.max(...line.words.map((w) => w.end - w.start));
      line.words.forEach((w, i) => {
        const span = document.createElement("span");
        span.className = "lx-w";
        const dur = w.end - w.start;
        const emphasis =
          !CJK.test(w.text) &&
          w.text.length <= 14 &&
          (line.exact ? dur >= 1000 : dur >= 1500 && dur >= longest * 0.6);
        let letters: HTMLElement[] | null = null;
        if (emphasis) {
          span.classList.add("lx-emph");
          letters = Array.from(w.text).map((ch) => {
            const l = document.createElement("span");
            l.className = "lx-c";
            l.textContent = ch;
            span.appendChild(l);
            return l;
          });
        } else {
          span.textContent = w.text;
        }
        text.appendChild(span);
        if (!w.glue && i < line.words.length - 1) text.appendChild(document.createTextNode(" "));
        view.words.push({ el: span, start: w.start, end: w.end, letters, q: 1, e: 0 });
      });
      el.appendChild(text);
      if (this.opts.interactive && this.opts.onSeek) {
        el.addEventListener("click", () => {
          this.exitFree(true);
          this.opts.onSeek!(item.start);
        });
      }
    }
    this.root.appendChild(el);
    return view;
  }

  private place(v: ItemView) {
    const y = v.spring.x;
    v.el.style.transform = `translate3d(0,${y.toFixed(2)}px,0)`;
    const shown = y + v.height > -this.viewH * 0.6 && y < this.viewH * 1.6;
    if (shown !== v.shown) {
      v.shown = shown;
      v.el.style.visibility = shown ? "" : "hidden";
    }
  }

  // ---- Layout ----------------------------------------------------------

  private layout(snap: boolean) {
    this.viewH = this.root.clientHeight;
    for (const v of this.views) v.height = v.el.offsetHeight;
    this.retarget(snap);
  }

  private retarget(snap: boolean) {
    const a = Math.max(this.active, 0);
    let acc = 0;
    let visual = 0;
    let activeVisual = 0;
    const visualIdx: number[] = [];
    this.tops = [];
    this.views.forEach((v, i) => {
      this.tops[i] = acc;
      const collapsed = v.item.kind === "gap" && i !== this.active;
      if (i === a) activeVisual = visual;
      visualIdx[i] = visual;
      if (!collapsed) {
        acc += v.height;
        visual++;
      }
    });
    this.total = acc;

    const activeH = this.views[a]?.height ?? 0;
    const base =
      this.viewH * this.tune.anchor - (this.tops[a] ?? 0) - (this.opts.center ? activeH / 2 : 0) - this.freeOffset;
    const now = performance.now();

    this.views.forEach((v, i) => {
      const target = base + this.tops[i];
      const d = i === this.active ? 0 : Math.min(Math.abs(visualIdx[i] - activeVisual) || 1, 6);
      const ds = String(this.active < 0 ? Math.min(visualIdx[i] + 1, 6) : d);
      if (v.el.dataset.d !== ds) v.el.dataset.d = ds;

      if (snap) {
        v.spring.snap(target);
        v.pending = null;
        this.place(v);
      } else {
        // Lines below the active one start moving a little later: the wave.
        const rel = visualIdx[i] - activeVisual;
        const delay = this.free || rel <= 0 ? 0 : Math.min(rel, 8) * this.tune.wave;
        v.pending = target;
        v.pendingAt = now + delay;
      }
    });
  }

  // ---- Frame -----------------------------------------------------------

  private findActive(t: number): number {
    const n = this.views.length;
    let i = Math.min(Math.max(this.active, 0), n - 1);
    if (n === 0) return -1;
    while (i + 1 < n && this.views[i + 1].item.start <= t) i++;
    while (i >= 0 && this.views[i].item.start > t) i--;
    return i;
  }

  private frame = (ts: number, dt: number) => {
    if (this.suspended || this.views.length === 0) return;
    const t = this.time();
    const a = this.findActive(t);
    if (a !== this.active) this.activate(a);

    for (const v of this.views) {
      if (v.pending !== null && ts >= v.pendingAt) {
        v.spring.target = v.pending;
        v.pending = null;
      }
      if (!v.spring.idle) {
        v.spring.step(dt);
        this.place(v);
      }
    }

    const cur = this.views[this.active];
    if (cur) {
      if (cur.item.kind === "line") this.updateWords(cur, t);
      else this.updateDots(cur, t);
    }
    // Let a held note finish its glow after the line moves on.
    if (this.releasing) {
      if (!this.tune.emphasis || !this.updateEmphasisOnly(this.releasing, t)) this.releasing = null;
    }
  };

  private activate(a: number) {
    const prev = this.views[this.active];
    if (prev) this.release(prev);
    this.active = a;
    this.retarget(false);
  }

  private release(v: ItemView) {
    if (v.item.kind === "gap") {
      if (v.dots) v.dots.style.transform = "";
      return;
    }
    for (const w of v.words) {
      if (w.q !== 1) {
        w.q = 1;
        w.el.style.setProperty("--q", "1");
      }
    }
    if (v.words.some((w) => w.e > 0)) this.releasing = v;
  }

  /** Clears fill and emphasis state so a mode switch starts clean. */
  private resetWords(v: ItemView) {
    for (const w of v.words) {
      w.q = -1;
      w.e = 0;
      w.el.style.removeProperty("--e");
      for (const l of w.letters ?? []) {
        l.style.transform = "";
        l.style.textShadow = "";
      }
    }
  }

  private updateWords(v: ItemView, t: number) {
    const { fill, emphasis } = this.tune;
    for (const w of v.words) {
      let q: number;
      if (fill === "line") q = 1;
      else if (fill === "word") q = t >= w.start ? 1 : 0;
      else q = t <= w.start ? 0 : t >= w.end ? 1 : (t - w.start) / (w.end - w.start);
      if (q !== w.q && (Math.abs(q - w.q) > 0.0015 || q === 0 || q === 1)) {
        w.q = q;
        w.el.style.setProperty("--q", q.toFixed(4));
      }
      if (w.letters && emphasis) this.updateEmphasis(w, t);
    }
  }

  private updateEmphasisOnly(v: ItemView, t: number): boolean {
    let busy = false;
    for (const w of v.words) {
      if (w.letters && w.e > 0) {
        this.updateEmphasis(w, t);
        busy = true;
      }
    }
    return busy;
  }

  /** Long notes: the word swells slightly and its letters lift and glow in a wave. */
  private updateEmphasis(w: WordView, t: number) {
    const dur = w.end - w.start;
    let e: number;
    if (t < w.start) e = 0;
    else if (t < w.end) e = easeOut(clamp01((t - w.start) / Math.min(dur, 650)));
    else e = 1 - clamp01((t - w.end) / 750);
    if (e === 0 && w.e === 0) return;
    w.e = e;
    w.el.style.setProperty("--e", e.toFixed(3));

    const letters = w.letters!;
    const filled = clamp01((t - w.start) / dur) * letters.length;
    for (let j = 0; j < letters.length; j++) {
      const lift = e * smooth(clamp01(filled - j + 0.6));
      const l = letters[j];
      if (lift < 0.005) {
        if (l.style.transform) {
          l.style.transform = "";
          l.style.textShadow = "";
        }
        continue;
      }
      const glow = lift * this.tune.glow;
      l.style.transform = `translateY(${(-lift * 0.055).toFixed(4)}em)`;
      l.style.textShadow =
        glow > 0.005 ? `0 0 ${(glow * 0.42).toFixed(3)}em rgba(var(--glow-rgb),${Math.min(1, glow * 0.8).toFixed(3)})` : "";
    }
  }

  /** Interlude: three dots fill in sequence, breathe, and shrink right before the next line. */
  private updateDots(v: ItemView, t: number) {
    const { start, end } = v.item;
    const g = clamp01((t - start) / Math.max(end - start, 1));
    v.dotEls.forEach((d, k) => {
      d.style.opacity = (0.22 + 0.78 * smooth(clamp01(g * 3 - k))).toFixed(3);
    });
    const breathe = 1 + 0.09 * Math.sin((t / 1000) * Math.PI * 1.15);
    const intro = easeOut(clamp01((t - start) / 450));
    const outro = smooth(clamp01((end - t) / 550));
    v.dots!.style.transform = `scale(${(breathe * Math.min(intro, outro)).toFixed(4)})`;
  }

  // ---- Free scrolling ----------------------------------------------------

  private onWheel = (e: WheelEvent) => {
    if (this.views.length === 0) return;
    const a = Math.max(this.active, 0);
    this.free = true;
    this.root.classList.add("is-free");
    const min = -(this.tops[a] ?? 0);
    const max = this.total - (this.tops[a] ?? 0);
    this.freeOffset = Math.min(max, Math.max(min, this.freeOffset + e.deltaY));
    this.retarget(false);
    clearTimeout(this.freeTimer);
    this.freeTimer = window.setTimeout(() => this.exitFree(true), FREE_SCROLL_MS);
  };

  private exitFree(animate: boolean) {
    clearTimeout(this.freeTimer);
    if (!this.free && this.freeOffset === 0) return;
    this.free = false;
    this.freeOffset = 0;
    this.root.classList.remove("is-free");
    if (animate) this.retarget(false);
  }
}
