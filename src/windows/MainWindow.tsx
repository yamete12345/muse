import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { Background } from "../components/Background";
import { LyricsView } from "../components/LyricsView";
import { PlayerBar } from "../components/PlayerBar";
import { Sidebar } from "../components/Sidebar";
import { TitleBar } from "../components/TitleBar";
import { togglePlay } from "../core/api";
import { useStore } from "../core/store";
import { useResolvedTheme } from "../core/theme";
import { setPaused } from "../core/ticker";
import { usePanel } from "../core/ui";

const IDLE_MS = 2800;

export function MainWindow() {
  const theme = useResolvedTheme();
  const panel = usePanel();
  const [idle, setIdle] = useState(false);
  const playing = useStore((s) => s.media?.playing ?? false);
  const timer = useRef(0);

  // Hide the chrome after a few seconds without mouse movement while playing.
  const wake = useCallback(() => {
    setIdle(false);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setIdle(true), IDLE_MS);
  }, []);
  useEffect(() => {
    wake();
    return () => clearTimeout(timer.current);
  }, [wake]);

  // Stop animating entirely while minimized.
  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten = win.onResized(async () => setPaused(await win.isMinimized()));
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea")) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "F11") {
        e.preventDefault();
        const win = getCurrentWindow();
        win.setFullscreen(!(await win.isFullscreen()));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const hidden = idle && playing && !panel;

  return (
    <div className={`app ${hidden ? "is-idle" : ""} ${panel ? "has-pane" : ""}`} onMouseMove={wake} onMouseDown={wake}>
      <Background light={theme === "light"} />
      <main className="stage">
        <LyricsView mode="main" />
      </main>
      <TitleBar />
      <PlayerBar />
      <Sidebar light={theme === "light"} />
    </div>
  );
}
