import { createRoot } from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "@fontsource-variable/inter";

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
  wallpaper: WallpaperWindow,
};
const View = views[label] ?? MainWindow;

// Keyboard/context-menu defaults of a browser make no sense in a desktop app.
window.addEventListener("contextmenu", (e) => {
  if (!import.meta.env.DEV) e.preventDefault();
});

// No StrictMode: its double effects would create and then lose the WebGL context.
initStore().finally(() => {
  createRoot(document.getElementById("root")!).render(<View />);
});
