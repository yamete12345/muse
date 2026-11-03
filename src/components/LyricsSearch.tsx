import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { useStore } from "../core/store";
import { openPanel } from "../core/ui";

interface Candidate {
  id: number;
  source: "lrclib" | "genius";
  title: string;
  artist: string;
  album: string;
  duration: number | null;
  kind: "synced" | "plain" | "instrumental";
  preview: string;
}

const KIND: Record<Candidate["kind"], string> = { synced: "Синхронный", plain: "Без таймингов", instrumental: "Без слов" };

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** Search lrclib and Genius by hand and pick the right lyrics for the playing track. */
export function LyricsSearch() {
  const media = useStore((s) => s.media);
  const current = useStore((s) => (s.lyrics && s.lyrics.key === s.media?.key ? s.lyrics : null));
  const [query, setQuery] = useState(() => (media ? [media.artist, media.title].filter(Boolean).join(" ") : ""));
  const [results, setResults] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState<number | null>(null);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const trackSeconds = media && media.durationMs > 0 ? media.durationMs / 1000 : null;

  const run = async (q = query) => {
    if (!q.trim()) return;
    setBusy(true);
    setError("");
    try {
      setResults(await invoke<Candidate[]>("search_lyrics", { query: q }));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  // Search right away for what is playing.
  useEffect(() => {
    run();
    input.current?.select();
  }, []);

  const pick = async (c: Candidate) => {
    setPicking(c.id);
    setError("");
    try {
      await invoke("choose_lyrics", { id: c.id });
      openPanel(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setPicking(null);
    }
  };

  if (!media?.title) return <p className="ls-empty">Включите песню, чтобы искать для неё текст.</p>;

  return (
    <div className="ls">
      <form
        className="ls-form"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <input ref={input} className="ls-input" value={query} placeholder="Исполнитель и название" onChange={(e) => setQuery(e.target.value)} />
        <button className="link-button link-button-primary" disabled={busy}>
          Найти
        </button>
      </form>

      {current && current.kind !== "loading" && (
        <p className="ls-current">
          Сейчас: {current.kind === "none" ? "текст не найден" : `${KIND[current.kind as Candidate["kind"]] ?? "текст"} · ${current.source || "—"}`}
        </p>
      )}
      {error && <p className="ls-error">{error}</p>}

      <div className={`ls-results ${busy ? "is-busy" : ""}`}>
        {busy && !results && <p className="ls-empty">Ищем…</p>}
        {results && results.length === 0 && !busy && <p className="ls-empty">Ничего не нашлось. Попробуйте другой запрос.</p>}
        {results?.map((c, i) => {
          const off = trackSeconds && c.duration ? Math.round(c.duration - trackSeconds) : null;
          return (
            <button key={`${c.source}${c.id}`} className={`ls-item is-${c.kind}`} style={{ animationDelay: `${Math.min(i, 10) * 0.03}s` }} disabled={picking !== null} onClick={() => pick(c)}>
              <div className="ls-item-head">
                <span className="ls-title">{c.title}</span>
                <span className={`ls-badge is-${c.kind}`}>{KIND[c.kind]}</span>
              </div>
              <div className="ls-meta">
                {c.artist}
                {c.album && ` · ${c.album}`}
                {c.duration ? ` · ${clock(c.duration)}` : ""}
                {off !== null && Math.abs(off) <= 600 && (
                  <span className={Math.abs(off) <= 2 ? "ls-match" : "ls-off"}>{Math.abs(off) <= 2 ? " · совпадает по длине" : ` · ${off > 0 ? "+" : ""}${off} с`}</span>
                )}
                <span className="ls-source"> · {c.source === "lrclib" ? "lrclib" : "Genius"}</span>
              </div>
              {c.preview && <div className="ls-preview">{c.preview}</div>}
              {picking === c.id && <div className="ls-picking">Загружаем…</div>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
