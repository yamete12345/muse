import { describe, expect, it } from "vitest";

import { buildItems, parseLrc } from "./lrc";
import { alignSections, partLabels, similarity, type PartsPayload } from "./parts";

const LRC = `[00:15.56]Tell me something, girl
[00:20.67]Are you happy in this modern world?
[00:25.79]Or do you need more?
[00:35.12]Tell me something, boy
[00:40.52]Aren't you tired tryin' to fill that void?
[00:50.48]I'm off the deep end, watch as I dive in
[00:55.44]I'll never meet the ground
[01:00.00]I'm off the deep end, watch as I dive in`;

const SHALLOW: PartsPayload = {
  key: "k",
  sections: [
    { kind: "Verse", number: 1, artists: ["Bradley Cooper"], lines: ["Tell me somethin', girl", "Are you happy in this modern world?", "Or do you need more?"] },
    { kind: "Verse", number: 2, artists: ["Lady Gaga"], lines: ["Tell me something, boy", "Aren't you tired tryin' to fill that void?"] },
    { kind: "Chorus", number: null, artists: ["Lady Gaga", "Bradley Cooper"], lines: ["I'm off the deep end, watch as I dive in", "I'll never meet the ground", "I'm off the deep end, watch as I dive in"] },
  ],
};

describe("similarity", () => {
  it("ignores punctuation and case", () => {
    expect(similarity(["tell", "me"], ["tell", "me"])).toBe(1);
    expect(similarity(["a"], [])).toBe(0);
  });
});

describe("alignSections", () => {
  it("assigns every timed line to its part", () => {
    const lines = parseLrc(LRC).map((l) => l.text);
    expect(alignSections(lines, SHALLOW.sections)).toEqual([0, 0, 0, 1, 1, 2, 2, 2]);
  });

  it("keeps ad-libs with the part around them", () => {
    const lines = ["Tell me something, girl", "(Yeah, yeah)", "Are you happy in this modern world?", "Tell me something, boy"];
    expect(alignSections(lines, SHALLOW.sections)).toEqual([0, 0, 0, 1]);
  });

  it("gives up when the texts are different songs", () => {
    expect(alignSections(["Completely other words", "Nothing in common here"], SHALLOW.sections)).toBeNull();
  });
});

describe("partLabels", () => {
  const items = buildItems(parseLrc(LRC));

  it("labels the first line of each part with its singers", () => {
    const labels = [...partLabels(items, SHALLOW, "duets").values()].map((l) => l.text);
    expect(labels).toEqual(["Куплет 1 · Bradley Cooper", "Куплет 2 · Lady Gaga", "Припев · Lady Gaga и Bradley Cooper"]);
  });

  it("colors solo parts by singer and shared ones neutrally", () => {
    const voices = [...partLabels(items, SHALLOW, "duets").values()].map((l) => l.voice);
    expect(voices).toEqual([0, 1, -1]);
  });

  it("skips one-singer songs unless asked for all parts", () => {
    const solo: PartsPayload = { key: "k", sections: SHALLOW.sections.map((s) => ({ ...s, artists: [] })) };
    expect(partLabels(items, solo, "duets").size).toBe(0);
    expect([...partLabels(items, solo, "all").values()].map((l) => l.text)).toEqual(["Куплет 1", "Куплет 2", "Припев"]);
    expect(partLabels(items, SHALLOW, "off").size).toBe(0);
  });
});
