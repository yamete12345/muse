import { useEffect, useState, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { updateSettings } from "../core/api";
import { useStore } from "../core/store";
import { openPanel, togglePanel, toggleView, usePanel, useView } from "../core/ui";
import { Glass } from "./Glass/Glass";
import { CloseIcon, GearIcon, MaximizeIcon, MinimizeIcon, MoonIcon, PenIcon, SearchIcon, SunIcon, WidgetIcon } from "./Icons";
import { LyricsSearch } from "./LyricsSearch";
import { LyricsEditor } from "./LyricsEditor";
import { Logo } from "./Logo";
import { SourceRail } from "./SourceRail";
import { useUpdate } from "../core/update";

const win = getCurrentWindow();

/** Right-hand rail with every action, plus the panes it opens. */
export function Sidebar({ light }: { light: boolean }) {
  const panel = usePanel();
  const view = useView();
  const widget = useStore((s) => s.settings.widgetEnabled);
  const toTray = useStore((s) => s.settings.closeToTray);
  const updateReady = useUpdate().status === "available";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") openPanel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <aside className={`rail ${panel ? "" : "chrome"}`} data-tauri-drag-region="deep">
        <Glass variant="panel" radius={30} className="rail-glass" refraction={22}>
          <div className="rail-inner">
            <div className="rail-group">
              <RailButton small label="Свернуть" onClick={() => win.minimize()}>
                <MinimizeIcon size={15} />
              </RailButton>
              <RailButton small label="Развернуть" onClick={() => win.toggleMaximize()}>
                <MaximizeIcon size={14} />
              </RailButton>
              <RailButton small danger label={toTray ? "Скрыть в трей" : "Закрыть MUSE"} onClick={() => win.close()}>
                <CloseIcon size={15} />
              </RailButton>
            </div>

            <span className="rail-sep" />

            <div className="rail-group">
              <RailButton label={view === "settings" ? "Вернуться к тексту" : "Настройки и оформление"} active={view === "settings"} onClick={() => toggleView("settings")}>
                <GearIcon size={19} />
                {updateReady && <span className="rail-badge" aria-label="Есть обновление" />}
              </RailButton>
              <RailButton label="Найти другой текст" active={panel === "search"} onClick={() => togglePanel("search")}>
                <SearchIcon size={18} />
              </RailButton>
              <RailButton label="Свой текст и тайминги" active={panel === "editor"} onClick={() => togglePanel("editor")}>
                <PenIcon size={18} />
              </RailButton>
              <RailButton
                label={widget ? "Убрать виджет со стола" : "Виджет на рабочем столе"}
                active={widget}
                onClick={() => updateSettings({ widgetEnabled: !widget, widgetEdit: false })}
              >
                <WidgetIcon size={18} />
              </RailButton>
              <RailButton label={light ? "Тёмная тема" : "Светлая тема"} onClick={() => updateSettings({ theme: light ? "dark" : "light" })}>
                <span className={`theme-icon ${light ? "is-light" : ""}`}>
                  <SunIcon size={18} />
                  <MoonIcon size={17} />
                </span>
              </RailButton>
            </div>

            <div className="rail-fill" />
            <SourceRail />
            <Logo size={30} className="rail-logo" />
          </div>
        </Glass>
      </aside>

      <Pane open={panel === "search"} title="Другой текст" wide>
        <LyricsSearch />
      </Pane>
      <Pane open={panel === "editor"} title="Свой текст" wide>
        <LyricsEditor />
      </Pane>
    </>
  );
}

function RailButton({
  label,
  active,
  small,
  danger,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  small?: boolean;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rail-item">
      <Glass
        as="button"
        variant="button"
        className={`icon-btn ${small ? "icon-btn-sm" : ""} ${danger ? "icon-btn-close" : ""}`}
        active={active}
        aria-label={label}
        onClick={onClick}
      >
        {children}
      </Glass>
      <span className="rail-label">{label}</span>
    </div>
  );
}

/** A glass pane that slides out next to the rail; stays mounted while it animates out. */
function Pane({ open, title, wide, children }: { open: boolean; title: string; wide?: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const t = setTimeout(() => setMounted(false), 420);
    return () => clearTimeout(t);
  }, [open]);

  if (!mounted) return null;
  return (
    <div className={`pane ${wide ? "pane-wide" : ""} ${open ? "is-open" : "is-closing"}`}>
      <Glass variant="panel" radius={28} large className="pane-glass">
        <div className="pane-head" data-tauri-drag-region="deep">
          <h2>{title}</h2>
          <Glass as="button" variant="button" className="icon-btn icon-btn-sm" aria-label="Закрыть" onClick={() => openPanel(null)}>
            <CloseIcon size={14} />
          </Glass>
        </div>
        <div className="pane-body">{children}</div>
      </Glass>
    </div>
  );
}
