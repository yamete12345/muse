/**
 * Liquid-glass refraction for `backdrop-filter`: an SVG filter whose
 * displacement map bends the backdrop near the rounded edges like a lens.
 * Maps are generated once per (size, radius) and shared between elements.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const MAP_SCALE = 0.5;

interface Entry {
  id: string;
  refs: number;
  node: SVGFilterElement;
}

let defs: SVGDefsElement | null = null;
const cache = new Map<string, Entry>();
let counter = 0;

function ensureDefs(): SVGDefsElement {
  if (defs) return defs;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.position = "absolute";
  svg.setAttribute("aria-hidden", "true");
  defs = document.createElementNS(SVG_NS, "defs");
  svg.appendChild(defs);
  document.body.appendChild(svg);
  return defs;
}

/** Red/green encode the x/y displacement; 128 means "no shift". */
function displacementMap(w: number, h: number, r: number, bezel: number): string {
  const cw = Math.max(2, Math.round(w * MAP_SCALE));
  const ch = Math.max(2, Math.round(h * MAP_SCALE));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(cw, ch);
  const hw = w / 2;
  const hh = h / 2;
  r = Math.min(r, hw, hh);

  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const px = (x + 0.5) / MAP_SCALE - hw;
      const py = (y + 0.5) / MAP_SCALE - hh;
      const qx = Math.abs(px) - (hw - r);
      const qy = Math.abs(py) - (hh - r);
      const ox = Math.max(qx, 0);
      const oy = Math.max(qy, 0);
      const outside = Math.hypot(ox, oy);
      // Signed distance to the rounded rect; negative inside.
      const sd = outside + Math.min(Math.max(qx, qy), 0) - r;
      const inset = -sd;
      let dx = 0;
      let dy = 0;
      if (inset >= 0 && inset < bezel) {
        let nx: number;
        let ny: number;
        if (qx > 0 && qy > 0) {
          nx = (ox / outside) * Math.sign(px);
          ny = (oy / outside) * Math.sign(py);
        } else if (qx > qy) {
          nx = Math.sign(px);
          ny = 0;
        } else {
          nx = 0;
          ny = Math.sign(py);
        }
        // Convex squircle-ish lens profile: strongest right at the rim.
        const t = 1 - inset / bezel;
        const m = 1 - Math.sqrt(1 - t * t);
        dx = -nx * m;
        dy = -ny * m;
      }
      const i = (y * cw + x) * 4;
      img.data[i] = 128 + dx * 127;
      img.data[i + 1] = 128 + dy * 127;
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}

export interface GlassFilterOptions {
  width: number;
  height: number;
  radius: number;
  blur: number;
  /** Strength of the edge refraction in px. */
  refraction: number;
}

function keyOf(o: GlassFilterOptions): string {
  return [Math.round(o.width), Math.round(o.height), o.radius, o.blur, o.refraction].join(":");
}

/** Returns a filter id usable as `backdrop-filter: url(#id)`, plus a release callback. */
export function acquireGlassFilter(o: GlassFilterOptions): { id: string; release: () => void } {
  const key = keyOf(o);
  let entry = cache.get(key);
  if (!entry) {
    const w = Math.round(o.width);
    const h = Math.round(o.height);
    const id = `lg-${++counter}`;
    const bezel = Math.min(Math.max(o.radius * 0.9, 10), Math.min(w, h) / 2);
    const node = document.createElementNS(SVG_NS, "filter");
    node.setAttribute("id", id);
    node.setAttribute("x", "0");
    node.setAttribute("y", "0");
    node.setAttribute("width", String(w));
    node.setAttribute("height", String(h));
    node.setAttribute("filterUnits", "userSpaceOnUse");
    node.setAttribute("primitiveUnits", "userSpaceOnUse");
    node.setAttribute("color-interpolation-filters", "sRGB");
    node.innerHTML = `
      <feImage href="${displacementMap(w, h, o.radius, bezel)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="map"/>
      <feGaussianBlur in="SourceGraphic" stdDeviation="${o.blur}" edgeMode="duplicate" result="blur"/>
      <feDisplacementMap in="blur" in2="map" scale="${o.refraction}" xChannelSelector="R" yChannelSelector="G" result="bent"/>
      <feColorMatrix in="bent" type="saturate" values="1.6"/>`;
    ensureDefs().appendChild(node);
    entry = { id, refs: 0, node };
    cache.set(key, entry);
  }
  entry.refs++;
  const e = entry;
  return {
    id: e.id,
    release: () => {
      e.refs--;
      if (e.refs <= 0) {
        // Keep recently used maps around briefly: resizes come in bursts.
        setTimeout(() => {
          if (e.refs <= 0 && cache.get(key) === e) {
            e.node.remove();
            cache.delete(key);
          }
        }, 4000);
      }
    },
  };
}
