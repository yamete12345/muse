import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { listen } from "@tauri-apps/api/event";

import { getWidgetGeometry, setWidgetGeometry } from "../../core/api";
import { matchPreset, PRESETS, type LyricStyle, type Preset } from "../../core/style";
import type { WidgetGeometry } from "../../core/types";
import { TrashIcon } from "../Icons";
import { Section, Slider } from "./controls";

/** Cards with ready-made looks; the one matching the current style is marked. */
export function PresetPicker({ current, onPick, hint }: { current: LyricStyle; onPick: (p: Preset) => void; hint?: string }) {
  const active = matchPreset(current);
  return (
    <Section title="Пресеты" hint={hint ?? "Готовые стили. Размер и расположение текста не меняются."}>
      <div className="st-presets">
        {PRESETS.map((p) => (
          <button key={p.id} className={`st-preset ${active === p.id ? "is-on" : ""}`} onClick={() => onPick(p)}>
            <span className="st-preset-swatch" style={{ background: `linear-gradient(135deg, ${p.colors[0]}, ${p.colors[1]})` }}>
              <span
                className="st-preset-sample"
                style={{
                  fontFamily: p.lyrics.font === "serif" ? "Georgia, serif" : undefined,
                  fontWeight: p.lyrics.fontWeight ?? 760,
                  color: p.lyrics.accent?.startsWith("#") ? p.lyrics.accent : undefined,
                }}
              >
                Аа
              </span>
            </span>
            <span className="st-preset-name">{p.name}</span>
            <span className="st-preset-hint">{p.hint}</span>
          </button>
        ))}
      </div>
    </Section>
  );
}

/** A reset button that asks once more before acting. */
export function ResetButton({ label = "Сбросить", onReset }: { label?: string; onReset: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  return (
    <button
      className={`link-button st-reset ${armed ? "is-armed" : ""}`}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onReset();
      }}
    >
      <TrashIcon size={14} />
      {armed ? "Точно сбросить?" : label}
    </button>
  );
}

const MARGIN = 24;
const MAP_W = 240;

/**
 * Where the widget sits and how big it is: a scaled map of the screen with the
 * widget on it (drag it or pick a spot), plus exact sliders.
 */
export function WidgetPlacement({ enabled }: { enabled: boolean }) {
  const [g, setG] = useState<WidgetGeometry | null>(null);
  const ownChange = useRef(0);
  const pending = useRef<WidgetGeometry | null>(null);
  const frame = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setG(null);
      return;
    }
    let t = 0;
    const refresh = () => getWidgetGeometry().then((v) => v && setG(v));
    refresh();
    // The widget window may still be on its way when the toggle flips.
    const retry = setTimeout(refresh, 600);
    const un = listen("widget:moved", () => {
      if (performance.now() - ownChange.current < 500) return;
      clearTimeout(t);
      t = window.setTimeout(refresh, 150);
    });
    return () => {
      clearTimeout(t);
      clearTimeout(retry);
      un.then((f) => f());
    };
  }, [enabled]);

  if (!enabled) return null;
  if (!g) return null;

  const apply = (p: Partial<WidgetGeometry>) => {
    const n = { ...g, ...p };
    n.width = Math.round(Math.min(Math.max(n.width, 240), n.areaWidth));
    n.height = Math.round(Math.min(Math.max(n.height, 110), n.areaHeight));
    n.x = Math.round(Math.min(Math.max(n.x, 0), n.areaWidth - n.width));
    n.y = Math.round(Math.min(Math.max(n.y, 0), n.areaHeight - n.height));
    setG(n);
    ownChange.current = performance.now();
    // One IPC call per frame at most, however fast the slider moves.
    pending.current = n;
    if (!frame.current) {
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        if (pending.current) setWidgetGeometry(pending.current);
      });
    }
  };

  const k = MAP_W / g.areaWidth;
  const spot = (i: number, size: number, area: number) => (i === 0 ? MARGIN : i === 1 ? (area - size) / 2 : area - size - MARGIN);
  const near = (a: number, b: number) => Math.abs(a - b) < 3;

  const drag = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const start = { px: e.clientX, py: e.clientY, x: g.x, y: g.y };
    const move = (ev: PointerEvent) => apply({ x: start.x + (ev.clientX - start.px) / k, y: start.y + (ev.clientY - start.py) / k });
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  return (
    <div className="st-place">
      <div className="st-screen" style={{ width: MAP_W, height: g.areaHeight * k }}>
        {[0, 1, 2].flatMap((row) =>
          [0, 1, 2].map((col) => {
            const x = spot(col, g.width, g.areaWidth);
            const y = spot(row, g.height, g.areaHeight);
            return (
              <button
                key={`${row}${col}`}
                className={`st-spot ${near(x, g.x) && near(y, g.y) ? "is-on" : ""}`}
                style={{ left: `${((col + 0.5) / 3) * 100}%`, top: `${((row + 0.5) / 3) * 100}%` }}
                aria-label="Поставить сюда"
                onClick={() => apply({ x, y })}
              />
            );
          }),
        )}
        <div
          className="st-screen-widget"
          style={{ transform: `translate(${g.x * k}px, ${g.y * k}px)`, width: g.width * k, height: g.height * k }}
          onPointerDown={drag}
        />
      </div>
      <div className="st-place-sliders">
        <Slider label="По горизонтали" value={g.x} min={0} max={Math.max(0, g.areaWidth - g.width)} format={(v) => `${Math.round(v)} px`} onChange={(x) => apply({ x })} />
        <Slider label="По вертикали" value={g.y} min={0} max={Math.max(0, g.areaHeight - g.height)} format={(v) => `${Math.round(v)} px`} onChange={(y) => apply({ y })} />
        <Slider label="Ширина" value={g.width} min={240} max={Math.round(g.areaWidth)} step={10} format={(v) => `${Math.round(v)} px`} onChange={(width) => apply({ width })} />
        <Slider label="Высота" value={g.height} min={110} max={Math.round(g.areaHeight)} step={10} format={(v) => `${Math.round(v)} px`} onChange={(height) => apply({ height })} />
      </div>
    </div>
  );
}
