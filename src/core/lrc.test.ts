import { describe, expect, it } from "vitest";

import { PlaybackClock } from "./clock";
import { buildItems, GAP_MS, parseLrc } from "./lrc";
import { estimateWords, syllables, tokenize } from "./timing";

describe("parseLrc", () => {
  it("parses line timestamps and sorts them", () => {
    const lines = parseLrc("[00:05.50]second\n[00:01.00]first\n[ar:Someone]");
    expect(lines.map((l) => [l.start, l.text])).toEqual([
      [1000, "first"],
      [5500, "second"],
    ]);
  });

  it("expands repeated timestamps", () => {
    const lines = parseLrc("[00:10.00][01:00.00]chorus\n[00:20.00]verse");
    expect(lines.map((l) => l.start)).toEqual([10000, 20000, 60000]);
  });

  it("applies the [offset] tag", () => {
    const [l] = parseLrc("[offset:+500]\n[00:02.00]hi");
    expect(l.start).toBe(1500);
  });

  it("ends a line at the next timestamp, including empty markers", () => {
    const [l] = parseLrc("[00:01.00]hello world\n[00:03.00]\n[00:30.00]next");
    expect(l.end).toBeLessThanOrEqual(3000);
    expect(l.end).toBeGreaterThan(2500);
  });

  it("estimates word timings that cover the line", () => {
    const [l] = parseLrc("[00:01.00]Hits the six and\n[00:04.00]it's summer");
    expect(l.exact).toBe(false);
    expect(l.words.map((w) => w.text)).toEqual(["Hits", "the", "six", "and"]);
    expect(l.words[0].start).toBe(l.start);
    expect(l.words[l.words.length - 1].end).toBeCloseTo(l.end, 5);
    for (let i = 1; i < l.words.length; i++) expect(l.words[i].start).toBeCloseTo(l.words[i - 1].end, 5);
  });

  it("reads Enhanced LRC word timings and glued syllables", () => {
    const [l] = parseLrc("[00:01.00]<00:01.00>Hel<00:01.40>lo <00:02.00>world<00:03.00>");
    expect(l.exact).toBe(true);
    expect(l.text).toBe("Hello world");
    expect(l.words.map((w) => [w.text, w.start, w.end, !!w.glue])).toEqual([
      ["Hel", 1000, 1400, true],
      ["lo", 1400, 2000, false],
      ["world", 2000, 3000, false],
    ]);
    expect(l.end).toBe(3000);
  });
});

describe("buildItems", () => {
  it("inserts gaps for intros and long pauses", () => {
    const lines = parseLrc("[00:10.00]one\n[00:12.00]two\n[00:40.00]three");
    const items = buildItems(lines);
    expect(items.map((i) => i.kind)).toEqual(["gap", "line", "line", "gap", "line"]);
    const gap = items[3];
    expect(gap.end - gap.start).toBeGreaterThan(GAP_MS);
    expect(gap.end).toBe(40000);
  });
});

describe("timing", () => {
  it("counts syllables in Latin and Cyrillic", () => {
    expect(syllables("summer")).toBe(2);
    expect(syllables("молоко")).toBe(3);
    expect(syllables("sh")).toBe(1);
  });

  it("splits CJK per character", () => {
    expect(tokenize("夜に駆ける")).toHaveLength(5);
  });

  it("gives the held last word more time", () => {
    const [a, b] = estimateWords("go go", 0, 1000);
    expect(b.end - b.start).toBeGreaterThan(a.end - a.start);
  });
});

describe("PlaybackClock", () => {
  const media = (positionMs: number, playing = true, updatedAtMs = 1_000_000) => ({
    key: "k",
    title: "t",
    artist: "a",
    album: "",
    durationMs: 200_000,
    positionMs,
    updatedAtMs,
    playing,
    rate: 1,
    canSeek: true,
    app: "x",
    appName: "X",
  });

  it("extrapolates from the last update while playing", () => {
    const c = new PlaybackClock();
    c.sync(media(10_000), 0, 1_000_500);
    expect(c.position(0)).toBe(10_500);
    expect(c.position(1000)).toBeCloseTo(11_500, 0);
  });

  it("freezes while paused and applies the offset to lyrics time", () => {
    const c = new PlaybackClock();
    c.offsetMs = 300;
    c.sync(media(10_000, false), 0, 1_005_000);
    expect(c.position(5000)).toBe(10_000);
    expect(c.now(5000)).toBe(10_300);
  });

  it("smooths small corrections instead of jumping", () => {
    const c = new PlaybackClock();
    c.sync(media(10_000), 0, 1_000_000);
    // The player reports 200 ms less than we extrapolated.
    c.sync(media(10_800), 1000, 1_000_000);
    expect(c.position(1000)).toBeCloseTo(11_000, 0);
    expect(c.position(4000)).toBeCloseTo(13_800, -1);
  });
});
