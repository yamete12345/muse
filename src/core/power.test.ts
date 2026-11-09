import { describe, expect, it } from "vitest";

import { frameRateOf, savingOf } from "./power";
import type { Settings } from "./types";

const at = (settings: Partial<Settings>, power = { battery: false, game: false }) => ({ settings: { fps: 60, gameMode: "auto", batterySaver: true, ...settings } as Settings, power });

describe("saving mode", () => {
  it("auto game mode follows a fullscreen app", () => {
    expect(savingOf(at({}))).toBe(null);
    expect(savingOf(at({}, { battery: false, game: true }))).toBe("game");
    expect(savingOf(at({ gameMode: "off" }, { battery: false, game: true }))).toBe(null);
    expect(savingOf(at({ gameMode: "always" }))).toBe("game");
  });

  it("battery saving can be turned off", () => {
    expect(savingOf(at({}, { battery: true, game: false }))).toBe("battery");
    expect(savingOf(at({ batterySaver: false }, { battery: true, game: false }))).toBe(null);
  });

  it("caps frames at 24 while saving, otherwise uses the setting", () => {
    expect(frameRateOf(at({ fps: 30 }))).toBe(30);
    expect(frameRateOf(at({ fps: 60 }, { battery: true, game: false }))).toBe(24);
  });
});
