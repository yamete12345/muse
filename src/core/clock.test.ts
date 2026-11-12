import { describe, expect, it } from "vitest";

import { PlaybackClock } from "./clock";
import type { MediaState } from "./types";

const media = (positionMs: number, updatedAtMs: number): MediaState => ({
  key: "a|b",
  title: "b",
  artist: "a",
  album: "",
  durationMs: 200_000,
  positionMs,
  updatedAtMs,
  playing: true,
  rate: 1,
  canSeek: false,
  app: "AppleInc.AppleMusicWin_nzyj5cx40ttqa!App",
  appName: "Apple Music",
});

describe("PlaybackClock", () => {
  it("runs smoothly for a player that reports whole seconds", () => {
    const clock = new PlaybackClock();
    // The song really started at t = -53 370 ms; reports every ~280 ms, rounded down.
    const truth = (t: number) => t + 53_370;
    let last = -Infinity;
    let worst = 0;
    for (let t = 0; t < 20_000; t += 20) {
      if (t % 280 === 0) clock.sync(media(Math.floor(truth(t) / 1000) * 1000, 1e12 + t), t, 1e12 + t);
      const p = clock.position(t);
      // Never backwards, and after a few seconds close to the truth.
      expect(p).toBeGreaterThanOrEqual(last - 1);
      last = p;
      if (t > 6000) worst = Math.max(worst, Math.abs(p - truth(t)));
    }
    expect(worst).toBeLessThan(120);
  });

  it("follows a seek in a whole-second player", () => {
    const clock = new PlaybackClock();
    for (let t = 0; t < 3000; t += 250) clock.sync(media(Math.floor((t + 10_400) / 1000) * 1000, 1e12 + t), t, 1e12 + t);
    for (let t = 3000; t < 6000; t += 250) clock.sync(media(Math.floor((t + 90_000) / 1000) * 1000, 1e12 + t), t, 1e12 + t);
    expect(Math.abs(clock.position(6000) - 96_000)).toBeLessThan(600);
  });

  it("keeps exact positions as they are", () => {
    const clock = new PlaybackClock();
    clock.sync(media(12_345, 1e12), 0, 1e12);
    expect(clock.position(1000)).toBeCloseTo(13_345, 0);
  });
});
