import { useEffect, useMemo, useState } from "react";

import { romanize, wantsRomaji } from "../core/romaji";
import { useStore } from "../core/store";
import { openPanel } from "../core/ui";
import { PenIcon } from "./Icons";

const SOURCES: Record<string, string> = { genius: " · Genius", lrclib: " · lrclib", user: " · ваш текст" };

export function PlainLyrics({ text, source }: { text: string; source: string }) {
  const stanzas = useMemo(
    () =>
      text
        .split(/\n\s*\n/)
        .map((s) => s.split("\n").map((l) => l.trim()).filter(Boolean))
        .filter((s) => s.length > 0),
    [text],
  );

  // Japanese and Korean lines in Latin letters, under each line or instead.
  const mode = useStore((st) => st.settings.romaji);
  const [roman, setRoman] = useState<{ text: string; map: Map<string, string> } | null>(null);
  useEffect(() => {
    const lines = stanzas.flat();
    if (mode === "off" || !wantsRomaji(lines)) return setRoman(null);
    let alive = true;
    romanize(`plain:${text.length}:${text.slice(0, 60)}`, lines).then((r) => {
      if (!alive) return;
      const map = new Map<string, string>();
      r.forEach((x, k) => x !== lines[k] && map.set(lines[k], x));
      setRoman({ text, map });
    });
    return () => {
      alive = false;
    };
  }, [stanzas, text, mode]);
  const latin = (l: string) => (roman && roman.text === text && mode !== "off" ? roman.map.get(l) : undefined);

  return (
    <div className="plain">
      <div className="plain-inner">
        {stanzas.map((lines, i) => (
          <p key={i} className="plain-stanza" style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}>
            {lines.map((l, j) => (
              <span key={j} className="plain-line">
                {mode === "instead" ? latin(l) ?? l : l}
                {mode === "under" && latin(l) && <span className="plain-sub">{latin(l)}</span>}
              </span>
            ))}
          </p>
        ))}
        <div className="plain-source">
          <span>Текст без синхронизации{SOURCES[source] ?? ""}</span>
          <button className="link-button" onClick={() => openPanel("search")}>
            Другой текст
          </button>
          <button className="link-button" onClick={() => openPanel("editor")}>
            <PenIcon size={14} /> Расставить тайминги
          </button>
        </div>
      </div>
    </div>
  );
}
