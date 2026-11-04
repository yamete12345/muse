import { describe, expect, it } from "vitest";

import { hangulToLatin, kanaToRomaji, romanize, wantsRomaji } from "./romaji";

describe("romaji", () => {
  it("turns kana into Hepburn", () => {
    expect(kanaToRomaji("きみのなまえ")).toBe("kiminonamae");
    expect(kanaToRomaji("ちょっと")).toBe("chotto");
    expect(kanaToRomaji("まっちゃ")).toBe("matcha");
    expect(kanaToRomaji("れんあい")).toBe("ren'ai");
    expect(kanaToRomaji("ラーメン")).toBe("raamen");
  });

  it("turns Hangul into Latin with linking", () => {
    expect(hangulToLatin("사랑해")).toBe("saranghae");
    expect(hangulToLatin("한국어")).toBe("hangugeo");
    expect(hangulToLatin("서울")).toBe("seoul");
    expect(hangulToLatin("빨리")).toBe("ppalli");
  });

  it("keeps Latin words and knows which songs need it", async () => {
    expect(await romanize("k", ["Baby 사랑해, 정말"])).toEqual(["Baby saranghae, jeongmal"]);
    expect(wantsRomaji(["사랑해"])).toBe(true);
    expect(wantsRomaji(["我爱你", "Hello"])).toBe(false);
  });
});

import { estimateWords } from "./timing";
import { joinWords } from "./lrc";

describe("CJK words", () => {
  it("keep their characters together on screen", () => {
    const w = estimateWords("君の名前 Baby", 0, 1000);
    expect(w.map((x) => x.text)).toEqual(["君", "の", "名", "前", "Baby"]);
    expect(joinWords(w)).toBe("君の名前 Baby");
  });
});
