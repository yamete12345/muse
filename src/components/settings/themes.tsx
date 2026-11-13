import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { updateSettings } from "../../core/api";
import { useStore } from "../../core/store";
import { applyTheme, themeColors, themeFromSettings, themeLooks, type ThemeInfo } from "../../core/themes";
import { openLink } from "../../core/update";
import { CloseIcon } from "../Icons";
import { ActionButton, Section } from "./controls";

const GUIDE = "https://github.com/yamete12345/muse/blob/main/docs/THEMES.md";

/** Installed themes, installing and removing them, and saving the current look as one. */
export function ThemesSection() {
  const settings = useStore((s) => s.settings);
  const [themes, setThemes] = useState<ThemeInfo[]>([]);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [author, setAuthor] = useState("");

  const refresh = useCallback(() => {
    invoke<ThemeInfo[]>("list_themes").then(setThemes, () => setThemes([]));
  }, []);
  useEffect(() => {
    refresh();
    const off = listen("themes:changed", refresh);
    return () => {
      off.then((f) => f());
    };
  }, [refresh]);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  const active = themes.find((t) => t.id === settings.activeTheme && !t.error) ?? null;

  const apply = (t: ThemeInfo) => {
    if (t.error) return setNote({ text: `«${t.name}»: ${t.error}`, bad: true });
    updateSettings(applyTheme(settings, t));
    setNote(null);
  };

  const install = async () => {
    try {
      const id = await invoke<string | null>("install_theme");
      if (!id) return;
      const list = await invoke<ThemeInfo[]>("list_themes");
      setThemes(list);
      const t = list.find((x) => x.id === id);
      if (t) {
        apply(t);
        setNote({ text: `Тема «${t.name}» установлена и применена` });
      }
    } catch (e) {
      setNote({ text: `Не получилось установить: ${String(e)}`, bad: true });
    }
  };

  const remove = async (t: ThemeInfo) => {
    if (armed !== t.id) return setArmed(t.id);
    setArmed(null);
    try {
      await invoke("remove_theme", { id: t.id });
      if (settings.activeTheme === t.id) updateSettings({ activeTheme: "" });
    } catch (e) {
      setNote({ text: `Не получилось удалить: ${String(e)}`, bad: true });
    }
  };

  const save = async () => {
    const data = themeFromSettings(settings, { name: name.trim() || "Моя тема", author: author.trim() });
    try {
      const path = await invoke<string | null>("export_theme", { data, css: active?.css ?? null, shader: active?.shader ?? null });
      if (!path) return;
      setNaming(false);
      setNote({ text: `Сохранено: ${path}` });
    } catch (e) {
      setNote({ text: `Не получилось сохранить: ${String(e)}`, bad: true });
    }
  };

  const card = (t: ThemeInfo) => {
    const [a, b] = themeColors(t);
    const lyrics = themeLooks(t).main?.lyrics;
    const extras = [t.shader && "свой фон", t.css && "свой стиль"].filter(Boolean).join(", ");
    const hint = t.error ?? ([t.author && `от ${t.author}`, extras].filter(Boolean).join(" · ") || t.description || "Тема");
    return (
      <div
        key={t.id}
        className={`st-preset ${settings.activeTheme === t.id ? "is-on" : ""} ${t.error ? "is-broken" : ""}`}
        role="button"
        tabIndex={0}
        title={t.description || undefined}
        onClick={() => apply(t)}
        onKeyDown={(e) => e.key === "Enter" && apply(t)}
      >
        <span className="st-preset-swatch" style={{ background: `linear-gradient(135deg, ${a}, ${b})` }}>
          <span
            className="st-preset-sample"
            style={{
              fontFamily: lyrics?.font === "serif" ? "Georgia, serif" : lyrics?.font === "mono" ? "Consolas, monospace" : undefined,
              fontWeight: lyrics?.fontWeight ?? 760,
              color: lyrics?.accent?.startsWith("#") ? lyrics.accent : undefined,
            }}
          >
            Аа
          </span>
        </span>
        <span className="st-preset-name">{t.name}</span>
        <span className="st-preset-hint">{armed === t.id ? "Нажмите × ещё раз" : hint}</span>
        <button
          className={`st-preset-delete ${armed === t.id ? "is-armed" : ""}`}
          aria-label="Удалить тему"
          title={armed === t.id ? "Точно удалить?" : "Удалить"}
          onClick={(e) => {
            e.stopPropagation();
            remove(t);
          }}
        >
          <CloseIcon size={11} />
        </button>
      </div>
    );
  };

  return (
    <Section
      title="Темы"
      hint="Готовое оформление главного окна, виджета и обоев сразу; у темы может быть свой фон и свой стиль. Размеры и расположение остаются ваши."
    >
      {themes.length > 0 && <div className="st-presets">{themes.map(card)}</div>}
      {naming && (
        <form
          className="st-theme-form"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <input autoFocus className="st-preset-input" placeholder="Название темы" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          <input className="st-preset-input" placeholder="Автор (необязательно)" maxLength={60} value={author} onChange={(e) => setAuthor(e.target.value)} />
          <div className="st-preset-form-buttons">
            <button type="submit" className="link-button link-button-primary">
              Сохранить в файл…
            </button>
            <button type="button" className="link-button" onClick={() => setNaming(false)}>
              Отмена
            </button>
          </div>
        </form>
      )}
      {note && <p className={`st-theme-note ${note.bad ? "is-bad" : ""}`}>{note.text}</p>}
      <div className="st-actions">
        <ActionButton primary onClick={install}>
          Установить тему…
        </ActionButton>
        {!naming && <ActionButton onClick={() => setNaming(true)}>Сохранить оформление как тему</ActionButton>}
        {active && <ActionButton onClick={() => updateSettings({ activeTheme: "" })}>Снять тему</ActionButton>}
        <ActionButton onClick={() => invoke("open_themes_folder").catch(() => {})}>Папка тем</ActionButton>
        <button className="link-button" onClick={() => openLink(GUIDE)}>
          Как сделать свою тему
        </button>
      </div>
    </Section>
  );
}
