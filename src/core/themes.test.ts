import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "./store";
import { ownMain, ownWidget } from "./style";
import { applyTheme, themeFromSettings, themeLooks, type ThemeInfo } from "./themes";
import type { Settings } from "./types";

const theme = (data: Record<string, unknown>, shader: string | null = null): ThemeInfo => ({
  id: "t",
  name: "T",
  author: "",
  version: "",
  description: "",
  colors: [],
  data,
  css: null,
  shader,
  error: null,
});

const settings = (patch: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...patch });

describe("themes", () => {
  it("keeps only known fields, in range", () => {
    const looks = themeLooks(
      theme({
        main: {
          background: "lava",
          bgSaturation: 9,
          lyrics: { glow: 100, font: "comic", accent: "#ff00aa", fontSize: 200, evil: "x" },
        },
      }),
    );
    expect(looks.main!.style).toEqual({ bgSaturation: 2 });
    expect(looks.main!.lyrics).toEqual({ glow: 2.5, accent: "#ff00aa" });
    expect(looks.widget).toBeNull();
  });

  it("uses the cover's colours when a theme asks for its own background but has no shader", () => {
    expect(themeLooks(theme({ main: { background: "theme" } })).main!.style.background).toBe("gradient");
    expect(themeLooks(theme({ main: { background: "theme" } }, "void main(){}")).main!.style.background).toBe("theme");
  });

  it("changes the look, never the size or placement", () => {
    const s = settings({
      mainStyle: { lyrics: { fontSize: 64, anchor: 0.5, align: "center", glow: 0.2 } },
      widgetStyle: { radius: 12, showCaption: false },
    });
    const patch = applyTheme(s, theme({ main: { lyrics: { glow: 2 } }, widget: { radius: 30, showCaption: true } }));
    const next = { ...s, ...patch };
    const main = ownMain(next);
    expect(main.lyrics.glow).toBe(2);
    expect(main.lyrics.fontSize).toBe(64);
    expect(main.lyrics.anchor).toBe(0.5);
    expect(main.lyrics.align).toBe("center");
    const w = ownWidget(next);
    expect(w.radius).toBe(30);
    expect(w.showCaption).toBe(false);
    expect(next.activeTheme).toBe("t");
  });

  it("round-trips the current look", () => {
    const s = settings({ mainStyle: { background: "animated", lyrics: { glow: 1.7, font: "serif" } } });
    const data = themeFromSettings(s, { name: "Мой", author: "" });
    const back = ownMain({ ...s, ...applyTheme(settings(), theme(data)) });
    expect(back.background).toBe("animated");
    expect(back.lyrics.glow).toBe(1.7);
    expect(back.lyrics.font).toBe("serif");
  });
});
