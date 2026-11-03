import { useEffect, useMemo, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { MeshBackground, noiseDataUrl } from "../core/background";
import { useStore } from "../core/store";
import type { SceneStyle } from "../core/style";

interface Props {
  light: boolean;
  scene: SceneStyle;
  /** Mirror the picture's tone into the native window background (avoids resize flashes). */
  syncWindow?: boolean;
}

export function Background({ light, scene, syncWindow = true }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const bg = useRef<MeshBackground | null>(null);
  const cover = useStore((s) => s.cover);
  const playing = useStore((s) => s.media?.playing ?? false);
  const fps = useStore((s) => s.settings.bgFps);
  const noise = useMemo(noiseDataUrl, []);
  const solid = scene.background === "solid";

  useEffect(() => {
    if (solid) return;
    let b: MeshBackground;
    try {
      b = new MeshBackground(canvas.current!);
    } catch (e) {
      console.warn("background disabled:", e);
      return;
    }
    let pending = 0;
    b.onTone = (rgb) => {
      document.body.style.background = `rgb(${rgb.join(",")})`;
      if (!syncWindow) return;
      clearTimeout(pending);
      pending = window.setTimeout(() => getCurrentWindow().setBackgroundColor([...rgb, 255]).catch(() => {}), 60);
    };
    bg.current = b;
    return () => {
      b.destroy();
      bg.current = null;
    };
  }, [solid, syncWindow]);

  useEffect(() => bg.current?.setCover(cover), [cover, solid]);
  useEffect(() => bg.current?.setPlaying(playing), [playing, solid]);
  useEffect(() => bg.current?.setFps(fps || 30), [fps, solid]);
  useEffect(() => bg.current?.setTheme(light), [light, solid]);
  useEffect(
    () => bg.current?.setScene(scene.bgBrightness, scene.bgSaturation, scene.background === "static" ? 0 : scene.bgSpeed),
    [scene.bgBrightness, scene.bgSaturation, scene.bgSpeed, scene.background, solid],
  );

  useEffect(() => {
    if (!solid) return;
    document.body.style.background = scene.bgColor;
    if (syncWindow) getCurrentWindow().setBackgroundColor(scene.bgColor).catch(() => {});
  }, [solid, scene.bgColor, syncWindow]);

  return (
    <div className="bg" aria-hidden>
      {solid ? (
        <div className="bg-solid" style={{ background: scene.bgColor, filter: `brightness(${scene.bgBrightness})` }} />
      ) : (
        <canvas ref={canvas} key="mesh" />
      )}
      <div className="bg-noise" style={{ backgroundImage: `url(${noise})` }} />
    </div>
  );
}
