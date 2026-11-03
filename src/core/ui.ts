import { useSyncExternalStore } from "react";

/** Which side pane of the main window is open. */
export type Panel = "editor" | "search" | null;

/** Which tab the main window shows: the lyrics or the settings page. */
export type View = "lyrics" | "settings";

let panel: Panel = null;
let view: View = "lyrics";
const listeners = new Set<() => void>();

const notify = () => {
  for (const l of listeners) l();
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function openPanel(p: Panel) {
  if (p === panel) return;
  panel = p;
  if (p) view = "lyrics";
  notify();
}

export function togglePanel(p: Exclude<Panel, null>) {
  openPanel(panel === p ? null : p);
}

export function openView(v: View) {
  if (v === view && (v === "lyrics" || !panel)) return;
  view = v;
  if (v === "settings") panel = null;
  notify();
}

export function toggleView(v: Exclude<View, "lyrics">) {
  openView(view === v ? "lyrics" : v);
}

export function usePanel(): Panel {
  return useSyncExternalStore(subscribe, () => panel);
}

export function useView(): View {
  return useSyncExternalStore(subscribe, () => view);
}
