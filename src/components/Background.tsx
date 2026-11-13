import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { useStickyCover } from "../core/appearance";
import { MeshBackground, noiseDataUrl } from "../core/background";
import { frameRateOf, useSaving } from "../core/power";
import { useStore } from "../core/store";
import type { SceneStyle } from "../core/style";
import { reportShaderError, useThemeShader } from "../core/themes";

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
  const fps = useStore(frameRateOf);
  // Saving mode (a game, the battery): the background stands still.
  const still = useSaving() !== null;
  const noise = useMemo(noiseDataUrl, []);
  const solid = scene.background === "solid";
  // "From the theme": its shader, or the cover's colours when it has none or it fails.
  const shader = useThemeShader();
  const [broken, setBroken] = useState<string | null>(null);
  const custom = scene.background === "theme" && !!shader && broken !== shader ? shader : null;
  const look = custom ? "custom" : scene.background === "gradient" || scene.background === "theme" ? "gradient" : "cover";
  const canvasKey = custom ? `custom-${hash(custom)}` : look;
  const beat = look !== "cover" && scene.bgBeat && !solid && !still;

  useEffect(() => {
    if (solid) return;
    let b: MeshBackground;
    try {
      b = new MeshBackground(canvas.current!, look, custom ?? undefined);
    } catch (e) {
      if (custom) {
        reportShaderError(custom, e instanceof Error ? e.message : String(e));
        setBroken(custom);
        return;
      }
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
  }, [solid, look, syncWindow, custom]);

  useEffect(() => bg.current?.setCover(cover), [cover, solid, canvasKey]);
  useEffect(() => bg.current?.setPlaying(playing), [playing, solid, canvasKey]);
  useEffect(() => bg.current?.setFps(fps), [fps, solid, canvasKey]);
  useEffect(() => bg.current?.setTheme(light), [light, solid, canvasKey]);
  useEffect(
    () => bg.current?.setScene(scene.bgBrightness, scene.bgSaturation, scene.background === "static" || still ? 0 : scene.bgSpeed),
    [scene.bgBrightness, scene.bgSaturation, scene.bgSpeed, scene.background, solid, canvasKey, still],
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
        <canvas ref={canvas} key={canvasKey} />
      )}
      {/* One noise dot per screen pixel: it breaks up banding without showing as grain. */}
      <div className="bg-noise" style={{ backgroundImage: `url(${noise})`, backgroundSize: `${128 / (window.devicePixelRatio || 1)}px` }} />
    </div>
  );
}

/** A short fingerprint of a shader, so a changed one gets a fresh canvas. */
function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
