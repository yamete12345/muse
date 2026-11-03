import { useEffect, useState } from "react";

import { useStore } from "./store";

const query = () => window.matchMedia("(prefers-color-scheme: light)");

/** Resolves the theme setting (incl. "system") and applies it to <html>. */
export function useResolvedTheme(): "dark" | "light" {
  const setting = useStore((s) => s.settings.theme);
  const [system, setSystem] = useState<"dark" | "light">(() => (query().matches ? "light" : "dark"));

  useEffect(() => {
    const mq = query();
    const onChange = () => setSystem(mq.matches ? "light" : "dark");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const theme = setting === "system" ? system : setting;

  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.theme === theme) return;
    const first = !root.dataset.theme;
    root.dataset.theme = theme;
    if (first) return;
    root.classList.add("theme-anim");
    const t = setTimeout(() => root.classList.remove("theme-anim"), 450);
    return () => clearTimeout(t);
  }, [theme]);

  return theme;
}
