import { useMemo, useRef, type CSSProperties } from "react";

import { useCoverAccent } from "../../core/appearance";
import { buildItems, parseLrc } from "../../core/lrc";
import { useStore } from "../../core/store";
import { hexToRgb, lyricVars, type LyricStyle, type SceneStyle, type WidgetStyle } from "../../core/style";
import { LyricsCanvas } from "../LyricsView";

// Original demo lines; the long last word shows the held-note effect.
const DEMO = `[00:00.40]Свет ложится на стекло
[00:03.10]Город медленно молчит
[00:05.80]Мы поём, и всё легко
[00:08.50]Пусть мелодия звучит
[00:11.20]Навсегда
[00:15.40]`;
const LOOP_MS = 15800;

interface Props {
  look: LyricStyle;
  variant: "main" | "widget" | "wallpaper";
  scene?: SceneStyle;
  widget?: WidgetStyle;
  /** Wallpaper only: the lyrics column, fractions of the width. */
  column?: { left: number; width: number };
}

/** A live, looping sample of the chosen appearance. */
export function Preview({ look, variant, scene, widget, column }: Props) {
  const cover = useStore((s) => s.cover);
  const accent = useCoverAccent();
  const t0 = useRef(performance.now());
  const items = useMemo(() => buildItems(parseLrc(DEMO)), []);

  // Large windows get scaled-down text so the sample fits the card.
  const previewLook = useMemo<LyricStyle>(() => {
    if (variant === "widget") return look;
    return { ...look, fontSize: look.fontSize > 0 ? Math.round(look.fontSize * 0.55) : 30 };
  }, [look, variant]);

  const vars = useMemo(() => {
    const v = lyricVars(previewLook, accent) as CSSProperties;
    return column ? { ...v, left: `${column.left * 100}%`, width: `${column.width * 100}%`, right: "auto" } : v;
  }, [previewLook, accent, column?.left, column?.width]);

  let backdrop: CSSProperties;
  if (scene?.background === "solid") {
    backdrop = { background: scene.bgColor, filter: `brightness(${scene.bgBrightness})` };
  } else {
    const sat = scene?.bgSaturation ?? 1;
    const bright = scene?.bgBrightness ?? 1;
    backdrop = {
      backgroundImage: cover ? `url(${cover})` : "linear-gradient(135deg, #2a3a42, #0d0f11 55%, #34383b)",
      filter: `blur(40px) saturate(${1.3 * sat}) brightness(${0.62 * bright})`,
    };
  }

  const panel: CSSProperties | undefined =
    variant === "widget" && widget
      ? {
          background:
            widget.background === "tint" || widget.background === "cover"
              ? `rgba(${hexToRgb(widget.tint) ?? "11, 13, 15"}, ${widget.opacity})`
              : widget.background === "acrylic"
                ? "rgba(28, 31, 34, 0.55)"
                : "transparent",
          borderRadius: widget.radius,
          backdropFilter: widget.background === "acrylic" ? "blur(20px)" : undefined,
        }
      : undefined;

  return (
    <div className={`pv pv-${variant}`}>
      <div className={`pv-backdrop ${variant === "widget" ? "pv-desktop" : ""}`} style={variant === "widget" ? undefined : backdrop} />
      <div className="pv-frame" style={panel}>
        {variant === "widget" && widget?.background === "cover" && cover && (
          <div className="widget-cover-bg" style={{ backgroundImage: `url(${cover})`, opacity: widget.coverOpacity }} />
        )}
        <div className="lx-host" style={vars}>
          <LyricsCanvas
            items={items}
            time={() => (performance.now() - t0.current) % LOOP_MS}
            look={previewLook}
            className={`lx-root lx-${variant === "wallpaper" ? "wallpaper" : variant} lx-preview`}
            center={variant === "widget"}
          />
        </div>
      </div>
      <span className="pv-badge">Превью</span>
    </div>
  );
}
