import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "@fontsource-variable/inter";

import { installCursorLight } from "./core/light";
import { initStore } from "./core/store";
import { MainWindow } from "./windows/MainWindow";
import { WallpaperWindow } from "./windows/WallpaperWindow";
import { WidgetWindow } from "./windows/WidgetWindow";
import "./styles/theme.css";
import "./styles/lyrics.css";
import "./styles/app.css";
import "./styles/widget.css";
import "./styles/editor.css";
import "./styles/settings.css";

const label = getCurrentWindow().label;
if (label === "widget") document.documentElement.classList.add("is-widget");

const views: Record<string, () => JSX.Element> = {
  widget: WidgetWindow,
};
// Live wallpaper windows are labelled per monitor: wallpaper-0, wallpaper-1, ...
const View = label.startsWith("wallpaper-") ? WallpaperWindow : views[label] ?? MainWindow;

installCursorLight();

// Page errors go to the same log file as Rust's (settings → Общие → Журнал).
const report = (message: string) => invoke("log_frontend", { level: "error", message: `${label}: ${message}` }).catch(() => {});
window.addEventListener("error", (e) => report(`${e.message} at ${e.filename}:${e.lineno}`));
window.addEventListener("unhandledrejection", (e) => report(`unhandled: ${e.reason instanceof Error ? e.reason.stack ?? e.reason.message : String(e.reason)}`));

// Keyboard/context-menu defaults of a browser make no sense in a desktop app.
window.addEventListener("contextmenu", (e) => {
  if (!import.meta.env.DEV) e.preventDefault();
});

// No StrictMode: its double effects would create and then lose the WebGL context.
initStore().finally(() => {
  createRoot(document.getElementById("root")!).render(<View />);
});
