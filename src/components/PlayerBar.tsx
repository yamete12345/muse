import { useEffect, useRef, useState } from "react";

import { nextTrack, prevTrack, seek, setOffset, shiftOffset, togglePlay, updateSettings } from "../core/api";
import { appOffsetOf, clock, getState, useStore } from "../core/store";
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
  const appOffset = useStore(appOffsetOf);
  const [offsetOpen, setOffsetOpen] = useState(false);
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

  const offsetLabel = fmtOffset(offsetMs + appOffset);

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
            <div className="offset" title={offsetOpen ? undefined : "Сдвиг текста относительно музыки (Ctrl+Alt+[ / ])"}>
              <Glass as="button" variant="button" className="icon-btn icon-btn-xs" title="Текст позже" onClick={() => shiftOffset(-100)}>
                <MinusIcon size={14} />
              </Glass>
              <button className={`offset-value ${offsetOpen ? "is-open" : ""}`} aria-expanded={offsetOpen} onClick={() => setOffsetOpen(!offsetOpen)}>
                {offsetLabel}
              </button>
              <Glass as="button" variant="button" className="icon-btn icon-btn-xs" title="Текст раньше" onClick={() => shiftOffset(100)}>
                <PlusIcon size={14} />
              </Glass>
              {offsetOpen && <OffsetMenu onClose={() => setOffsetOpen(false)} />}
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

            <span aria-hidden />
          </div>
        </div>
      </Glass>
    </div>
  );
}

const fmtOffset = (ms: number) => `${ms > 0 ? "+" : ms < 0 ? "−" : "±"}${(Math.abs(ms) / 1000).toFixed(1)} с`;

/** Changes the app's offset by `delta` from its current value (quick clicks all count). */
const shiftAppOffset = (app: string, delta: number | null) => {
  const next = { ...getState().settings.appOffsets };
  const v = delta === null ? 0 : Math.max(-5000, Math.min(5000, Math.round((next[app] ?? 0) + delta)));
  if (v === 0) delete next[app];
  else next[app] = v;
  updateSettings({ appOffsets: next });
};

/** The offset split in two: this track, and everything from this app. */
function OffsetMenu({ onClose }: { onClose: () => void }) {
  const media = useStore((s) => s.media);
  const track = useStore((s) => s.offsetMs);
  const app = useStore(appOffsetOf);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const box = ref.current?.parentElement;
      if (box && !box.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (!media) return null;
  const appName = media.appName || media.app;
  return (
    <div className="offset-menu" ref={ref} role="dialog" aria-label="Сдвиг текста">
      <OffsetRow label="Этот трек" hint="Запоминается для песни" value={track} onStep={shiftOffset} />
      <OffsetRow label={`Всё из ${appName}`} hint="Если приложение отстаёт или спешит" value={app} onStep={(d) => shiftAppOffset(media.app, d)} />
      <div className="offset-menu-foot">
        <span>Плюс: текст раньше · минус: позже</span>
        <button
          className="link-button"
          disabled={track === 0 && app === 0}
          onClick={() => {
            setOffset(0);
            shiftAppOffset(media.app, null);
          }}
        >
          Сбросить
        </button>
      </div>
    </div>
  );
}

function OffsetRow({ label, hint, value, onStep }: { label: string; hint: string; value: number; onStep: (delta: number) => void }) {
  return (
    <div className="offset-row">
      <div className="offset-row-label">
        <span>{label}</span>
        <small>{hint}</small>
      </div>
      <button className="offset-step" aria-label={`${label}: позже`} onClick={() => onStep(-100)}>
        <MinusIcon size={13} />
      </button>
      <span className="offset-row-value">{fmtOffset(value)}</span>
      <button className="offset-step" aria-label={`${label}: раньше`} onClick={() => onStep(100)}>
        <PlusIcon size={13} />
      </button>
    </div>
  );
}
