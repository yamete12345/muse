import { useMemo } from "react";

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

  return (
    <div className="plain">
      <div className="plain-inner">
        {stanzas.map((lines, i) => (
          <p key={i} className="plain-stanza" style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}>
            {lines.map((l, j) => (
              <span key={j} className="plain-line">
                {l}
              </span>
            ))}
          </p>
        ))}
        <div className="plain-source">
          <span>Текст без синхронизации{SOURCES[source] ?? ""}</span>
          <button className="link-button" onClick={() => openPanel("editor")}>
            <PenIcon size={14} /> Расставить тайминги
          </button>
        </div>
      </div>
    </div>
  );
}
