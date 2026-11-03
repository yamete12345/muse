import { describe, expect, it } from "vitest";

import { DEFAULT_MAIN, DEFAULT_WALLPAPER, DEFAULT_WIDGET, PRESETS, presetLyrics, resolveWallpaper, resolveWidget } from "./style";
import type { Settings } from "./types";

const base = {
  mainStyle: { ...DEFAULT_MAIN, lyrics: { ...DEFAULT_MAIN.lyrics, align: "center", font: "serif" } },
  widgetStyle: { ...DEFAULT_WIDGET, lyrics: { ...DEFAULT_WIDGET.lyrics, align: "left", fontSize: 26 } },
  wallpaperStyle: { ...DEFAULT_WALLPAPER, position: "left", lyrics: { ...DEFAULT_WALLPAPER.lyrics, align: "left" } },
  wallpaperSplit: false,
  wallpaperStyles: null,
} as unknown as Settings;

describe("linking", () => {
  it("a linked widget follows the main window's alignment but keeps its size", () => {
    const w = resolveWidget({ ...base, widgetLinked: true });
    expect(w.lyrics.align).toBe("center");
    expect(w.lyrics.font).toBe("serif");
    expect(w.lyrics.fontSize).toBe(26);
  });

  it("a linked wallpaper moves its column with the alignment", () => {
    const w = resolveWallpaper({ ...base, wallpaperLinked: true });
    expect(w.lyrics.align).toBe("center");
    expect(w.position).toBe("center");
  });

  it("unlinked surfaces keep their own alignment", () => {
    expect(resolveWidget({ ...base, widgetLinked: false }).lyrics.align).toBe("left");
    expect(resolveWallpaper({ ...base, wallpaperLinked: false }).position).toBe("left");
  });

  it("presets never change the alignment", () => {
    const own = { ...DEFAULT_MAIN.lyrics, align: "right" as const };
    for (const p of PRESETS) expect(presetLyrics(p, own).align).toBe("right");
  });
});
