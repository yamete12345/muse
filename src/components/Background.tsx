import { useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { useStickyCover } from "../core/appearance";
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
  const cover = useStickyCover();
  const playing = useStore((s) => s.media?.playing ?? false);
  const fps = useStore((s) => s.settings.bgFps);
  const noise = useMemo(noiseDataUrl, []);
  const solid = scene.background === "solid";
  const look = scene.background === "gradient" ? "gradient" : "cover";
  const beat = look === "gradient" && scene.bgBeat && !solid;

  useEffect(() => {
    if (solid) return;
    let b: MeshBackground;
    try {
      b = new MeshBackground(canvas.current!, look);
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
  }, [solid, look, syncWindow]);

  useEffect(() => bg.current?.setCover(cover), [cover, solid, look]);
  useEffect(() => bg.current?.setPlaying(playing), [playing, solid, look]);
  useEffect(() => bg.current?.setFps(fps || 30), [fps, solid, look]);
  useEffect(() => bg.current?.setTheme(light), [light, solid, look]);
  useEffect(
    () => bg.current?.setScene(scene.bgBrightness, scene.bgSaturation, scene.background === "static" ? 0 : scene.bgSpeed),
    [scene.bgBrightness, scene.bgSaturation, scene.bgSpeed, scene.background, solid, look],
  );

  // The beat: MUSE hears the playing app only while this window shows the pulse.
  useEffect(() => {
    if (!beat) return;
    const sync = () => invoke("listen_beat", { on: document.visibilityState === "visible" }).catch(() => {});
    sync();
    document.addEventListener("visibilitychange", sync);
    const off = listen<number>("audio:beat", (e) => bg.current?.pulse(e.payload));
    return () => {
      document.removeEventListener("visibilitychange", sync);
      off.then((f) => f());
      invoke("listen_beat", { on: false }).catch(() => {});
    };
  }, [beat]);

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
        <canvas ref={canvas} key={look} />
      )}
      {/* One noise dot per screen pixel: it breaks up banding without showing as grain. */}
      <div className="bg-noise" style={{ backgroundImage: `url(${noise})`, backgroundSize: `${128 / (window.devicePixelRatio || 1)}px` }} />
    </div>
  );
}
