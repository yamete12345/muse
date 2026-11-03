import { useEffect, useMemo, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { MeshBackground, noiseDataUrl } from "../core/background";
import { useStore } from "../core/store";

export function Background({ light }: { light: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const bg = useRef<MeshBackground | null>(null);
  const cover = useStore((s) => s.cover);
  const playing = useStore((s) => s.media?.playing ?? false);
  const fps = useStore((s) => s.settings.bgFps);
  const noise = useMemo(noiseDataUrl, []);

  useEffect(() => {
    try {
      const b = new MeshBackground(canvas.current!);
      // Native window + page background follow the picture, so resizing never flashes.
      let pending = 0;
      b.onTone = (rgb) => {
        document.body.style.background = `rgb(${rgb.join(",")})`;
        clearTimeout(pending);
        pending = window.setTimeout(() => getCurrentWindow().setBackgroundColor([...rgb, 255]).catch(() => {}), 60);
      };
      bg.current = b;
    } catch (e) {
      console.warn("background disabled:", e);
    }
    return () => bg.current?.destroy();
  }, []);

  useEffect(() => bg.current?.setCover(cover), [cover]);
  useEffect(() => bg.current?.setPlaying(playing), [playing]);
  useEffect(() => bg.current?.setFps(fps || 30), [fps]);
  useEffect(() => bg.current?.setTheme(light), [light]);

  return (
    <div className="bg" aria-hidden>
      <canvas ref={canvas} />
      <div className="bg-noise" style={{ backgroundImage: `url(${noise})` }} />
    </div>
  );
}
