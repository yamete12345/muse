import { useSyncExternalStore } from "react";

/** Which side pane of the main window is open. */
export type Panel = "settings" | "editor" | null;

let panel: Panel = null;
const listeners = new Set<() => void>();

export function openPanel(p: Panel) {
  if (p === panel) return;
  panel = p;
  for (const l of listeners) l();
}

export function togglePanel(p: Exclude<Panel, null>) {
  openPanel(panel === p ? null : p);
}

export function usePanel(): Panel {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => panel,
  );
}
