import { useEffect, useRef, useState } from "react";

import { nextTrack, prevTrack, seek, setOffset, togglePlay } from "../core/api";
import { clock, useStore } from "../core/store";
import { onFrame } from "../core/ticker";
import { Glass } from "./Glass/Glass";
import { MinusIcon, NextIcon, PauseIcon, PlayIcon, PlusIcon, PrevIcon } from "./Icons";

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function PlayerBar() {
  const media = useStore((s) => s.media);
  const offsetMs = useStore((s) => s.offsetMs);
  const playing = media?.playing ?? false;
  const duration = media?.durationMs ?? 0;
  const canSeek = (media?.canSeek ?? false) && duration > 0;

  const fill = useRef<HTMLDivElement>(null);
  const elapsed = useRef<HTMLSpanElement>(null);
  const remaining = useRef<HTMLSpanElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const scrubRef = useRef<number | null>(null);
  scrubRef.current = scrub;

  // Progress is written straight to the DOM every frame; React stays idle.
  useEffect(() => {
    let lastSec = -1;
    let lastF = -1;
    return onFrame(() => {
      const d = clock.durationMs;
      const pos = scrubRef.current ?? clock.position();
      const f = d > 0 ? Math.min(1, pos / d) : 0;
      // Skip sub-pixel changes: no style work on frames where nothing moves.
      if (fill.current && Math.abs(f - lastF) > 0.0002) {
        lastF = f;
        fill.current.style.transform = `scaleX(${f.toFixed(5)})`;
      }
      const sec = Math.floor(pos / 1000);
      if (sec !== lastSec && elapsed.current && remaining.current) {
        lastSec = sec;
        elapsed.current.textContent = fmt(pos);
        remaining.current.textContent = d > 0 ? `−${fmt(d - pos)}` : "";
      }
    });
  }, []);

  const posFromEvent = (e: React.PointerEvent) => {
    const b = track.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)) * duration;
  };

  const offsetLabel = `${offsetMs > 0 ? "+" : offsetMs < 0 ? "−" : "±"}${(Math.abs(offsetMs) / 1000).toFixed(1)} с`;

  return (
    <div className="player chrome">
      <Glass variant="panel" radius={30} className="player-glass" refraction={30}>
        <div className="player-inner">
          <div className="progress">
            <span ref={elapsed} className="time">
              0:00
            </span>
            <div
              ref={track}
              className={`track ${canSeek ? "can-seek" : ""} ${scrub !== null ? "is-scrubbing" : ""}`}
              onPointerDown={(e) => {
                if (!canSeek) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                setScrub(posFromEvent(e));
              }}
              onPointerMove={(e) => scrub !== null && setScrub(posFromEvent(e))}
              onPointerUp={(e) => {
                if (scrub === null) return;
                seek(posFromEvent(e));
                setScrub(null);
              }}
              onPointerCancel={() => setScrub(null)}
            >
              <div className="track-rail">
                <div ref={fill} className="track-fill" />
              </div>
            </div>
            <span ref={remaining} className="time time-right" />
          </div>

          <div className="controls">
            <div className="offset" title="Сдвиг текста относительно музыки (Ctrl+Alt+[ / ])">
              <Glass as="button" variant="button" className="icon-btn icon-btn-xs" title="Текст позже" onClick={() => setOffset(offsetMs - 100)}>
                <MinusIcon size={14} />
              </Glass>
              <button className="offset-value" title="Сбросить сдвиг" onClick={() => setOffset(0)}>
                {offsetLabel}
              </button>
              <Glass as="button" variant="button" className="icon-btn icon-btn-xs" title="Текст раньше" onClick={() => setOffset(offsetMs + 100)}>
                <PlusIcon size={14} />
              </Glass>
            </div>

            <div className="transport">
              <Glass as="button" variant="button" className="icon-btn icon-btn-md" title="Предыдущий" onClick={prevTrack} disabled={!media}>
                <PrevIcon size={20} />
              </Glass>
              <Glass as="button" variant="button" className="icon-btn icon-btn-lg" title={playing ? "Пауза" : "Играть"} onClick={togglePlay} disabled={!media}>
                {playing ? <PauseIcon size={24} /> : <PlayIcon size={24} />}
              </Glass>
              <Glass as="button" variant="button" className="icon-btn icon-btn-md" title="Следующий" onClick={nextTrack} disabled={!media}>
                <NextIcon size={20} />
              </Glass>
            </div>

            <div className="player-app" title={media?.app}>
              {appName(media?.app)}
            </div>
          </div>
        </div>
      </Glass>
    </div>
  );
}

function appName(id?: string): string {
  if (!id) return "";
  const known: Record<string, string> = {
    spotify: "Spotify",
    "yandex.music": "Яндекс Музыка",
    yandexmusic: "Яндекс Музыка",
    chrome: "Chrome",
    msedge: "Edge",
    firefox: "Firefox",
    opera: "Opera",
    zunemusic: "Медиаплеер",
    applemusic: "Apple Music",
    deezer: "Deezer",
    vk: "VK Музыка",
  };
  const low = id.toLowerCase();
  for (const [k, v] of Object.entries(known)) if (low.includes(k)) return v;
  return id.replace(/\.exe$/i, "").split(/[!.\\]/).filter(Boolean).pop() ?? "";
}
