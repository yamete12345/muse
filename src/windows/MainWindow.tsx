import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { Background } from "../components/Background";
import { LyricsView } from "../components/LyricsView";
import { PlayerBar } from "../components/PlayerBar";
import { SettingsPage } from "../components/SettingsPage";
import { Sidebar } from "../components/Sidebar";
import { TitleBar } from "../components/TitleBar";
import { UpdateToast } from "../components/UpdateToast";
import { nextTrack, prevTrack, togglePlay } from "../core/api";
import { useMainStyle } from "../core/appearance";
import { useStore } from "../core/store";
import { useResolvedTheme } from "../core/theme";
import { setPaused } from "../core/ticker";
import { openPanel, openView, usePanel, useView } from "../core/ui";
import { initUpdates } from "../core/update";

// Update news from Rust is shown in the main window only.
initUpdates();

export function MainWindow() {
  const theme = useResolvedTheme();
  const panel = usePanel();
  const view = useView();
  const settingsOpen = view === "settings";
  const look = useMainStyle();
  const idleMs = Math.max(1, look.idleSeconds) * 1000;
  const [idle, setIdle] = useState(false);
  const playing = useStore((s) => s.media?.playing ?? false);
  const timer = useRef(0);

  // Hide the chrome after a few seconds without mouse movement while playing.
  const wake = useCallback(() => {
    setIdle(false);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setIdle(true), idleMs);
  }, [idleMs]);
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

  // The tray's "Настройки…" lands on the settings tab.
  useEffect(() => {
    const unlisten = listen("ui:settings", () => openView("settings"));
    // The tray's "Текст неправильный…" opens the lyrics search.
    const unlistenSearch = listen("ui:search", () => openPanel("search"));
    return () => {
      unlisten.then((f) => f());
      unlistenSearch.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if ((e.target as Element | null)?.closest?.("input, textarea, .sw")) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if ((e.code === "ArrowRight" || e.code === "ArrowLeft") && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        (e.code === "ArrowRight" ? nextTrack : prevTrack)();
      } else if (e.key === "F11") {
        e.preventDefault();
        const win = getCurrentWindow();
        win.setFullscreen(!(await win.isFullscreen()));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const hidden = idle && playing && !panel && !settingsOpen;
  const playerClass = look.player === "always" ? "player-pinned" : "";

  return (
    <div
      className={`app ${hidden ? "is-idle" : ""} ${panel ? "has-pane" : ""} ${settingsOpen ? "in-settings" : ""} ${playerClass}`}
      onMouseMove={wake}
      onMouseDown={wake}
    >
      <Background light={theme === "light"} scene={look} />
      <div className="lyrics-tab" aria-hidden={settingsOpen}>
        <main className="stage">
          <LyricsView mode="main" look={look.lyrics} suspended={settingsOpen} />
        </main>
        <TitleBar showTrack={look.showHeader} />
        {look.player !== "hidden" && <PlayerBar />}
      </div>
      <SettingsPage />
      <UpdateToast />
      <Sidebar light={theme === "light"} />
    </div>
  );
}
