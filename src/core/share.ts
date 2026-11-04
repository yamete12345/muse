/**
 * Share pictures: a few lyric lines with the artwork, drawn on a canvas in
 * two formats (16:9 for chats and desktops, 9:16 for stories).
 */
export type ShareFormat = "horizontal" | "vertical";

export interface ShareCard {
  lines: string[];
  title: string;
  artist: string;
  /** Cover as a data URL, if any. */
  cover: string | null;
  /** "r, g, b" of the highlight; white when not set. */
  accent: string | null;
}

export const SIZES: Record<ShareFormat, [number, number]> = {
  horizontal: [1920, 1080],
  vertical: [1080, 1920],
};

const FONT = '"Inter Variable", "Segoe UI Variable Display", "Segoe UI", sans-serif';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

/** Greedy word wrap to a width; very long words are left to overflow. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) {
      out.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) out.push(line);
  return out;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Draws `img` scaled to fill the box, cropping the overflow. */
function drawCover(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function drawMark(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, align: "center" | "right") {
  ctx.save();
  ctx.textAlign = "left";
  ctx.font = `760 ${Math.round(26 * scale)}px ${FONT}`;
  ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
  ctx.textBaseline = "middle";
  const label = "MUSE";
  const tw = ctx.measureText(label).width;
  const bar = 22 * scale;
  const gap = 12 * scale;
  const total = bar + gap + tw;
  const left = align === "right" ? x - total : x - total / 2;
  // The logo's three lyric bars, the top one lit.
  [1, 0.72, 0.5].forEach((w, i) => {
    ctx.globalAlpha = i === 0 ? 0.85 : 0.4;
    roundRect(ctx, left, y - 9 * scale + i * 7 * scale, bar * w, 4.5 * scale, 2.25 * scale);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
  ctx.fillText(label, left + bar + gap, y + 1);
  ctx.restore();
}

/** Renders a share card to a PNG blob. */
export async function renderShare(card: ShareCard, format: ShareFormat): Promise<HTMLCanvasElement> {
  const [W, H] = SIZES[format];
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  await document.fonts.load(`800 80px ${FONT}`).catch(() => {});
  const accent = card.accent ?? "255, 255, 255";
  const img = card.cover ? await loadImage(card.cover).catch(() => null) : null;

  // Background: the artwork, blurred and dimmed, or a quiet gradient.
  if (img) {
    ctx.save();
    ctx.filter = "blur(90px) saturate(1.5) brightness(0.62)";
    drawCover(ctx, img, -160, -160, W + 320, H + 320);
    ctx.restore();
  } else {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#26343c");
    g.addColorStop(1, "#0b0d0f");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  const shade = ctx.createLinearGradient(0, 0, 0, H);
  shade.addColorStop(0, "rgba(0, 0, 0, 0.15)");
  shade.addColorStop(1, "rgba(0, 0, 0, 0.45)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);

  const vertical = format === "vertical";
  const coverSize = vertical ? 620 : 520;
  const coverX = vertical ? (W - coverSize) / 2 : 150;
  const coverY = vertical ? 230 : (H - coverSize) / 2 - 40;

  // Artwork with a soft shadow.
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = 70;
  ctx.shadowOffsetY = 30;
  roundRect(ctx, coverX, coverY, coverSize, coverSize, 34);
  ctx.fillStyle = "#15191c";
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundRect(ctx, coverX, coverY, coverSize, coverSize, 34);
  ctx.clip();
  if (img) drawCover(ctx, img, coverX, coverY, coverSize, coverSize);
  ctx.restore();

  // Title and artist.
  ctx.textBaseline = "alphabetic";
  const metaX = vertical ? W / 2 : coverX;
  const metaY = coverY + coverSize + (vertical ? 92 : 78);
  ctx.textAlign = vertical ? "center" : "left";
  ctx.fillStyle = "#fff";
  ctx.font = `740 ${vertical ? 44 : 36}px ${FONT}`;
  ctx.fillText(card.title, metaX, metaY, vertical ? W - 160 : coverSize);
  ctx.fillStyle = "rgba(255, 255, 255, 0.62)";
  ctx.font = `560 ${vertical ? 36 : 30}px ${FONT}`;
  ctx.fillText(card.artist, metaX, metaY + (vertical ? 54 : 46), vertical ? W - 160 : coverSize);

  // The lines: large, bright, glowing in the highlight color.
  const textX = vertical ? W / 2 : coverX + coverSize + 110;
  const textW = vertical ? W - 180 : W - textX - 150;
  // Largest size that fits the space; a single short line gets big type.
  const room = vertical ? H - (metaY + 120) - 230 : 800;
  // Rows of one lyric line sit tight; separate lines get a clear gap, so a
  // wrapped line never reads as two.
  const layout = (s: number) => {
    ctx.font = `820 ${s}px ${FONT}`;
    const rows: { text: string; y: number }[] = [];
    let y = 0;
    card.lines.forEach((l, i) => {
      if (i > 0) y += s * 0.42;
      for (const text of wrap(ctx, l, textW)) {
        rows.push({ text, y });
        y += s * 1.16;
      }
    });
    return { rows, height: y };
  };
  let size = vertical ? 112 : 104;
  let block = layout(size);
  for (; size > 44 && block.height > room; size -= 4) block = layout(size - 4);
  // Vertical: centred in the space between the title and the mark.
  const top = vertical ? metaY + 120 + (room - block.height) / 2 + size * 0.85 : (H - block.height) / 2 + size * 0.85;
  ctx.textAlign = vertical ? "center" : "left";
  block.rows.forEach(({ text: row, y: dy }) => {
    const y = top + dy;
    ctx.save();
    ctx.shadowColor = `rgba(${accent}, 0.55)`;
    ctx.shadowBlur = size * 0.55;
    ctx.fillStyle = card.accent ? `rgb(${accent})` : "#fff";
    ctx.fillText(row, textX, y);
    ctx.restore();
  });

  drawMark(ctx, vertical ? W / 2 : W - 80, H - (vertical ? 110 : 70), vertical ? 1.3 : 1.1, vertical ? "center" : "right");
  return canvas;
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("no image"))), "image/png"));
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}
