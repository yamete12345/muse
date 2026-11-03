import { createRoot } from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "@fontsource-variable/inter";

import { initStore } from "./core/store";
import { MainWindow } from "./windows/MainWindow";
import { WidgetWindow } from "./windows/WidgetWindow";
import "./styles/theme.css";
import "./styles/lyrics.css";
import "./styles/app.css";
import "./styles/widget.css";
import "./styles/editor.css";

const isWidget = getCurrentWindow().label === "widget";
if (isWidget) document.documentElement.classList.add("is-widget");

// Keyboard/context-menu defaults of a browser make no sense in a desktop app.
window.addEventListener("contextmenu", (e) => {
  if (!import.meta.env.DEV) e.preventDefault();
});

// No StrictMode: its double effects would create and then lose the WebGL context.
initStore().finally(() => {
  createRoot(document.getElementById("root")!).render(isWidget ? <WidgetWindow /> : <MainWindow />);
});
