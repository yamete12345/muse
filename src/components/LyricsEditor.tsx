import { useEffect, useReducer, useRef, useState } from "react";

import { deleteUserLyrics, saveUserLyrics, seek, togglePlay } from "../core/api";
import { parseLrc } from "../core/lrc";
import { clock, useStore } from "../core/store";
import { onFrame } from "../core/ticker";
import type { LyricsPayload } from "../core/types";
import { openPanel } from "../core/ui";
import { Glass } from "./Glass/Glass";
import { BackIcon, ForwardIcon, MinusIcon, PauseIcon, PlayIcon, PlusIcon, ReplayIcon, TapIcon, TrashIcon } from "./Icons";
import { Segmented } from "./SettingsPanel";

interface Row {
  text: string;
  time: number | null;
}

interface SyncState {
  rows: Row[];
  cursor: number;
}

type Action =
  | { type: "load"; rows: Row[] }
  | { type: "stamp"; time: number }
  | { type: "undo" }
  | { type: "move"; delta: number }
  | { type: "select"; index: number }
  | { type: "nudge"; index: number; ms: number }
  | { type: "clear" };

function reducer(s: SyncState, a: Action): SyncState {
  switch (a.type) {
    case "load": {
      const first = a.rows.findIndex((r) => r.time === null);
      return { rows: a.rows, cursor: first < 0 ? a.rows.length : first };
    }
    case "stamp": {
      if (s.cursor >= s.rows.length) return s;
      const rows = s.rows.slice();
      rows[s.cursor] = { ...rows[s.cursor], time: a.time };
      return { rows, cursor: s.cursor + 1 };
    }
    case "undo": {
      const i = Math.max(0, s.cursor - 1);
      const rows = s.rows.slice();
      if (rows[i]) rows[i] = { ...rows[i], time: null };
      return { rows, cursor: i };
    }
    case "move":
      return { ...s, cursor: Math.min(s.rows.length, Math.max(0, s.cursor + a.delta)) };
    case "select":
      return { ...s, cursor: a.index };
    case "nudge": {
      const rows = s.rows.slice();
      const r = rows[a.index];
      if (r?.time != null) rows[a.index] = { ...r, time: Math.max(0, r.time + a.ms) };
      return { ...s, rows };
    }
    case "clear":
      return { rows: s.rows.map((r) => ({ ...r, time: null })), cursor: 0 };
  }
}

const pad = (n: number) => String(n).padStart(2, "0");

function fmt(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  return `${Math.floor(t / 60000)}:${pad(Math.floor(t / 1000) % 60)}.${pad(Math.floor(t / 10) % 100)}`;
}

function lrcTag(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  return `[${pad(Math.floor(t / 60000))}:${pad(Math.floor(t / 1000) % 60)}.${pad(Math.floor(t / 10) % 100)}]`;
}

function textOf(l: LyricsPayload | null): string {
  if (!l) return "";
  if (l.kind === "synced") return parseLrc(l.text).map((x) => x.text).join("\n");
  if (l.kind === "plain") return l.text;
  return "";
}

export function LyricsEditor() {
  const media = useStore((s) => s.media);
  const lyrics = useStore((s) => s.lyrics);
  const playing = media?.playing ?? false;
  const key = media?.key ?? "";
  const current = lyrics && lyrics.key === key ? lyrics : null;

  const [step, setStep] = useState<"text" | "sync">("text");
  const [draft, setDraft] = useState(() => textOf(current));
  const dirty = useRef(false);
  const [sync, dispatch] = useReducer(reducer, { rows: [], cursor: 0 });
  const [saving, setSaving] = useState(false);

  // New track: start over. Lyrics arriving later fill the draft unless the user typed.
  useEffect(() => {
    dirty.current = false;
    setStep("text");
    dispatch({ type: "load", rows: [] });
  }, [key]);
  useEffect(() => {
    if (!dirty.current) setDraft(textOf(current));
  }, [current?.text, current?.kind]);

  const toSync = () => {
    const texts = draft.split("\n").map((s) => s.trim()).filter(Boolean);
    const prior = current?.kind === "synced" ? parseLrc(current.text) : [];
    dispatch({ type: "load", rows: texts.map((text, i) => ({ text, time: prior[i]?.text === text ? prior[i].start : null })) });
    setStep("sync");
  };

  // Tap-to-sync keys. Capture phase so Space does not also toggle playback.
  useEffect(() => {
    if (step !== "sync") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea")) return;
      const handled = ["Space", "Enter", "Backspace", "ArrowUp", "ArrowDown"].includes(e.code);
      if (!handled) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === "Space" || e.code === "Enter") dispatch({ type: "stamp", time: Math.round(clock.position()) });
      else if (e.code === "Backspace") dispatch({ type: "undo" });
      else dispatch({ type: "move", delta: e.code === "ArrowUp" ? -1 : 1 });
    };
    // A focused button would otherwise "click" itself on Space release.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target as HTMLElement).closest("input, textarea")) e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, [step]);

  // Keep the line being timed in view.
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = list.current?.children[Math.min(sync.cursor, sync.rows.length - 1)] as HTMLElement | undefined;
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [sync.cursor, sync.rows.length]);

  // Playback time readout, written directly every frame.
  const clockEl = useRef<HTMLSpanElement>(null);
  useEffect(
    () =>
      onFrame(() => {
        if (clockEl.current) clockEl.current.textContent = fmt(clock.position());
      }),
    [],
  );

  const timed = sync.rows.filter((r) => r.time !== null).length;
  const complete = sync.rows.length > 0 && timed === sync.rows.length;

  const save = async (kind: "synced" | "plain") => {
    setSaving(true);
    const text =
      kind === "plain"
        ? draft.trim()
        : sync.rows
            .slice()
            .sort((a, b) => a.time! - b.time!)
            .map((r) => `${lrcTag(r.time!)}${r.text}`)
            .join("\n");
    await saveUserLyrics(kind, text);
    setSaving(false);
    dirty.current = false;
    openPanel(null);
  };

  if (!media?.title) {
    return (
      <div className="ed-empty">
        <TapIcon size={34} />
        <p>Включите трек, для которого хотите написать текст.</p>
      </div>
    );
  }

  return (
    <div className="editor">
      <div className="ed-track">
        <span className="ed-track-title">{media.title}</span>
        <span className="ed-track-artist">{media.artist}</span>
      </div>

      <Segmented<"text" | "sync">
        value={step}
        onChange={(v) => (v === "sync" ? toSync() : setStep("text"))}
        options={[
          ["text", "1 · Текст"],
          ["sync", "2 · Тайминги"],
        ]}
      />

      {step === "text" ? (
        <div className="ed-step" key="text">
          <textarea
            className="ed-textarea"
            value={draft}
            placeholder={"Вставьте или напишите текст песни.\nКаждая строка с новой строки."}
            spellCheck={false}
            onChange={(e) => {
              dirty.current = true;
              setDraft(e.target.value);
            }}
          />
          <div className="ed-actions">
            {current?.source === "user" && (
              <button className="ed-btn ed-btn-ghost" onClick={() => deleteUserLyrics()} title="Вернуть текст из lrclib или Genius">
                <TrashIcon size={15} /> Удалить мой текст
              </button>
            )}
            <span className="ed-fill" />
            <button className="ed-btn ed-btn-ghost" disabled={!draft.trim() || saving} onClick={() => save("plain")}>
              Без таймингов
            </button>
            <button className="ed-btn ed-btn-primary" disabled={!draft.trim()} onClick={toSync}>
              Расставить тайминги
            </button>
          </div>
        </div>
      ) : (
        <div className="ed-step" key="sync">
          <p className="ed-hint">
            Включите песню и жмите <kbd>Пробел</kbd> в начале каждой строки. <kbd>Backspace</kbd> отменяет, <kbd>↑</kbd> <kbd>↓</kbd> выбирают строку.
          </p>

          <div className="ed-transport">
            <Glass as="button" variant="button" className="icon-btn icon-btn-sm" aria-label="Назад на 5 секунд" onClick={() => seek(clock.position() - 5000)}>
              <ReplayIcon size={16} />
            </Glass>
            <Glass as="button" variant="button" className="icon-btn" aria-label={playing ? "Пауза" : "Играть"} onClick={togglePlay}>
              {playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
            </Glass>
            <Glass as="button" variant="button" className="icon-btn icon-btn-sm" aria-label="Вперёд на 5 секунд" onClick={() => seek(clock.position() + 5000)}>
              <ForwardIcon size={16} />
            </Glass>
            <span ref={clockEl} className="ed-clock" />
            <span className="ed-progress">
              {timed}/{sync.rows.length}
            </span>
          </div>

          <div className="ed-list" ref={list}>
            {sync.rows.map((r, i) => (
              <div
                key={i}
                className={`ed-row ${i === sync.cursor ? "is-current" : ""} ${r.time !== null ? "is-done" : ""}`}
                onClick={() => dispatch({ type: "select", index: i })}
              >
                <button
                  className="ed-time"
                  disabled={r.time === null}
                  title="Перейти к этому месту"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (r.time !== null) seek(r.time - 1500);
                  }}
                >
                  {r.time === null ? "–:––.––" : fmt(r.time)}
                </button>
                <span className="ed-text">{r.text}</span>
                {r.time !== null && (
                  <span className="ed-nudge">
                    <button aria-label="Раньше на 0.1 с" onClick={(e) => (e.stopPropagation(), dispatch({ type: "nudge", index: i, ms: -100 }))}>
                      <MinusIcon size={12} />
                    </button>
                    <button aria-label="Позже на 0.1 с" onClick={(e) => (e.stopPropagation(), dispatch({ type: "nudge", index: i, ms: 100 }))}>
                      <PlusIcon size={12} />
                    </button>
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="ed-actions">
            <button className="ed-btn ed-btn-ghost" onClick={() => setStep("text")}>
              <BackIcon size={15} /> Текст
            </button>
            <button className="ed-btn ed-btn-ghost" disabled={timed === 0} onClick={() => dispatch({ type: "clear" })}>
              Сбросить
            </button>
            <span className="ed-fill" />
            <button
              className="ed-btn ed-btn-tap"
              disabled={sync.cursor >= sync.rows.length}
              onClick={() => dispatch({ type: "stamp", time: Math.round(clock.position()) })}
            >
              <TapIcon size={16} /> Отметить
            </button>
            <button className="ed-btn ed-btn-primary" disabled={!complete || saving} onClick={() => save("synced")}>
              Сохранить
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
