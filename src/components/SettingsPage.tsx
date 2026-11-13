import { useEffect, useState, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";

import { Glass } from "./Glass/Glass";
import { BackIcon, BugIcon, DownloadIcon, GearIcon, GithubIcon, LinkIcon, NoteIcon, RefreshIcon } from "./Icons";
import { Logo } from "./Logo";
import { ActionButton, Row, Section, Segmented, Slider, Toggle, ColorField } from "./settings/controls";
import { LyricStyleEditor, SceneEditor } from "./settings/editors";
import { Preview } from "./settings/Preview";
import { PresetPicker, ResetButton, WidgetPlacement } from "./settings/presets";
import { ThemesSection } from "./settings/themes";
import { listMonitors, openLog, openLogFolder, updateSettings } from "../core/api";
import { useStore } from "../core/store";
import {
  DEFAULT_MAIN,
  DEFAULT_WALLPAPER,
  DEFAULT_WIDGET,
  ownMain,
  ownWallpaper,
  ownWidget,
  presetLyrics,
  presetScene,
  resolveWallpaper,
  resolveWidget,
  wallpaperColumn,
  wallpaperPatch,
  type Corner,
  type LyricStyle,
  type Preset,
  type MainStyle,
  type WallpaperStyle,
  type WidgetBackground,
  type WidgetFormat,
  type WidgetGlass,
  widgetBlur,
  type WidgetStyle,
} from "../core/style";
import type { PartsMode } from "../core/parts";
import type { GameMode, MonitorInfo, RomajiMode, Settings, ThemeSetting } from "../core/types";
import { useSaving } from "../core/power";
import { openView, useView } from "../core/ui";
import { checkForUpdate, installUpdate, openLink, REPO_URL, useUpdate } from "../core/update";

type Tab = "general" | "look" | "about";

const TABS: [Tab, string, ReactNode][] = [
  ["general", "Общие", <GearIcon size={17} key="g" />],
  ["look", "Оформление", <LookIcon key="l" />],
  ["about", "О программе", <NoteIcon size={16} key="a" />],
];

/** The settings tab of the main window; stays mounted while it animates out. */
export function SettingsPage() {
  const open = useView() === "settings";
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const t = setTimeout(() => setMounted(false), 420);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && openView("lyrics");
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!mounted) return null;
  return <Page closing={!open} />;
}

function Page({ closing }: { closing: boolean }) {
  const settings = useStore((s) => s.settings);
  const [tab, setTab] = useState<Tab>("look");
  const idx = TABS.findIndex(([t]) => t === tab);

  return (
    <div className={`sw ${closing ? "is-closing" : "is-open"}`}>
      <Glass variant="panel" radius={26} className="sw-nav" large>
        <div className="sw-nav-inner" data-tauri-drag-region="deep">
          <div className="sw-brand">
            <Logo size={34} />
            <div className="sw-brand-text">
              <div className="sw-brand-name">MUSE</div>
              <div className="sw-brand-sub">Настройки</div>
            </div>
          </div>
          <nav className="sw-tabs" style={{ ["--i" as string]: idx }}>
            <span className="sw-tab-thumb" />
            {TABS.map(([t, label, icon]) => (
              <button key={t} className={`sw-tab ${t === tab ? "is-on" : ""}`} title={label} onClick={() => setTab(t)}>
                <span className="sw-tab-icon">{icon}</span>
                <span className="sw-tab-label">{label}</span>
              </button>
            ))}
          </nav>
        </div>
      </Glass>

      <main className="sw-main">
        <header className="sw-head" data-tauri-drag-region="deep">
          <h1 key={tab}>{TABS[idx][1]}</h1>
          <div className="sw-head-buttons">
            <button className="link-button" onClick={() => openView("lyrics")}>
              <BackIcon size={15} />
              К тексту
            </button>
          </div>
        </header>
        <div className="sw-scroll">
          <div className="sw-content" key={tab}>
            {tab === "general" && <General s={settings} />}
            {tab === "look" && <LookTab s={settings} />}
            {tab === "about" && <About s={settings} />}
          </div>
        </div>
      </main>
    </div>
  );
}

// ---- Writers ---------------------------------------------------------------

const setMain = (s: Settings, p: Partial<MainStyle>) => updateSettings({ mainStyle: { ...ownMain(s), ...p } });
const setMainLyrics = (s: Settings, p: Partial<LyricStyle>) => setMain(s, { lyrics: { ...ownMain(s).lyrics, ...p } });
const setWidget = (s: Settings, p: Partial<WidgetStyle>) => updateSettings({ widgetStyle: { ...ownWidget(s), ...p } });
const setWidgetLyrics = (s: Settings, p: Partial<LyricStyle>) => setWidget(s, { lyrics: { ...ownWidget(s).lyrics, ...p } });
// `m` is the monitor being edited; it only matters while monitors keep separate looks.
const setWall = (s: Settings, p: Partial<WallpaperStyle>, m?: number) => updateSettings(wallpaperPatch(s, { ...ownWallpaper(s, m), ...p }, m));
const setWallLyrics = (s: Settings, p: Partial<LyricStyle>, m?: number) => setWall(s, { lyrics: { ...ownWallpaper(s, m).lyrics, ...p } }, m);

const resetMain = () => updateSettings({ mainStyle: DEFAULT_MAIN });
const resetWidget = () => updateSettings({ widgetStyle: DEFAULT_WIDGET, widgetAcrylic: false });
const resetWall = () => updateSettings({ wallpaperStyle: DEFAULT_WALLPAPER, wallpaperStyles: null });
const resetAll = () =>
  updateSettings({
    mainStyle: DEFAULT_MAIN,
    widgetStyle: DEFAULT_WIDGET,
    wallpaperStyle: DEFAULT_WALLPAPER,
    wallpaperStyles: null,
    widgetAcrylic: false,
    widgetLinked: false,
    wallpaperLinked: false,
  });

// Presets restyle the text (and background) of what is being edited; size and placement stay.
const pickMain = (s: Settings, p: Preset) => {
  const m = ownMain(s);
  setMain(s, { ...presetScene(p), lyrics: presetLyrics(p, m.lyrics) });
};
const pickWidget = (s: Settings, p: Preset) => {
  const w = ownWidget(s);
  setWidget(s, { lyrics: presetLyrics(p, w.lyrics) });
};
const pickWall = (s: Settings, p: Preset, m?: number) => {
  const w = ownWallpaper(s, m);
  setWall(s, { ...presetScene(p), lyrics: presetLyrics(p, w.lyrics) }, m);
};

/** Monitors the wallpaper shows on, and which one is being edited when each has its own look. */
function useWallMonitors(s: Settings) {
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  useEffect(() => {
    listMonitors().then(setMonitors);
  }, []);
  // Stored picks may say -1 for "the primary monitor"; the UI works with real indexes.
  const primary = Math.max(0, monitors.findIndex((m) => m.primary));
  const picked = [...new Set(s.wallpaperMonitors.map((i) => (i < 0 ? primary : i)))].sort((a, b) => a - b);
  const multi = picked.length > 1;
  const split = s.wallpaperSplit && multi;
  const m = split ? (editing !== null && picked.includes(editing) ? editing : picked[0]) : undefined;
  const name = (i: number) => (monitors[i] ? `Монитор ${i + 1}${monitors[i].primary ? " (основной)" : ""}` : `Монитор ${i + 1}`);
  const switcher = split ? (
    <div className="st-switch">
      <span>Монитор</span>
      <Segmented<number> value={m!} onChange={setEditing} options={picked.map((i) => [i, name(i)] as [number, string])} />
    </div>
  ) : null;
  return { monitors, picked, multi, split, m, name, switcher };
}

// ---- Tabs ------------------------------------------------------------------

function General({ s }: { s: Settings }) {
  return (
    <>
      <Section title="Тема">
        <Row label="Оформление">
          <Segmented<ThemeSetting>
            value={s.theme}
            onChange={(theme) => updateSettings({ theme })}
            options={[
              ["dark", "Тёмная"],
              ["light", "Светлая"],
              ["system", "Как в системе"],
            ]}
          />
        </Row>
      </Section>
      <Section title="Части песни" hint="Подписи над куплетами и припевами: чья это часть. Разметку берём с Genius и сопоставляем с таймингами.">
        <Row label="Подписывать">
          <Segmented<PartsMode>
            value={s.songParts}
            onChange={(songParts) => updateSettings({ songParts })}
            options={[
              ["duets", "Дуэты и фиты"],
              ["all", "Все песни"],
              ["off", "Нет"],
            ]}
          />
        </Row>
      </Section>
      <Section
        title="Латиница"
        hint="Для японских и корейских песен: как читается строка. Для японского словарь чтений (около 12 МБ) скачается один раз, при первой такой песне."
      >
        <Row label="Показывать">
          <Segmented<RomajiMode>
            value={s.romaji}
            onChange={(romaji) => updateSettings({ romaji })}
            options={[
              ["under", "Под строкой"],
              ["instead", "Вместо текста"],
              ["off", "Нет"],
            ]}
          />
        </Row>
      </Section>
      <Section title="Обложка">
        <Toggle
          label="Живая обложка"
          hint="Пока играет музыка, обложка медленно движется, слегка наклоняется и ловит блик. На обоях вокруг неё ещё и мягкое свечение."
          value={s.liveCover}
          onChange={(liveCover) => updateSettings({ liveCover })}
        />
      </Section>
      <Section title="Производительность">
        <Toggle
          label="Простое размытие"
          hint="Вместо стекла с преломлением, бликами и подсветкой от курсора — только размытие. Меньше всего нагружает видеокарту"
          value={s.simpleGlass}
          onChange={(simpleGlass) => updateSettings({ simpleGlass })}
        />
        <Row label="Частота кадров" hint="Для всей анимации: текст, фон, обои. Меньше кадров — меньше нагрузка">
          <Segmented<number>
            value={s.fps}
            onChange={(fps) => updateSettings({ fps })}
            options={[
              [24, "24"],
              [30, "30"],
              [60, "60 fps"],
            ]}
          />
        </Row>
        <Row
          label="Игровой режим"
          hint="Обои засыпают, фон замирает, анимация идёт с частотой 24 кадра, а видеокарта достаётся игре. «Авто» — пока игра или видео на весь экран"
        >
          <Segmented<GameMode>
            value={s.gameMode}
            onChange={(gameMode) => updateSettings({ gameMode })}
            options={[
              ["auto", "Авто"],
              ["always", "Всегда"],
              ["off", "Выкл"],
            ]}
          />
        </Row>
        <Toggle
          label="Экономия на батарее"
          hint="Когда ноутбук работает от батареи — то же, что в игровом режиме"
          value={s.batterySaver}
          onChange={(batterySaver) => updateSettings({ batterySaver })}
        />
        <SavingStatus />
      </Section>
      <Section title="Система">
        <Row label="Кнопка закрытия" hint={s.closeToTray ? "MUSE продолжит работать в трее" : "Приложение полностью закроется"}>
          <Segmented<boolean>
            value={s.closeToTray}
            onChange={(closeToTray) => updateSettings({ closeToTray })}
            options={[
              [true, "Свернуть в трей"],
              [false, "Закрыть приложение"],
            ]}
          />
        </Row>
        <Toggle label="Запускать вместе с Windows" hint="Стартует свёрнутым в трей" value={s.autostart} onChange={(autostart) => updateSettings({ autostart })} />
      </Section>
      <Section title="Журнал" hint="Сюда MUSE записывает, что происходит и что пошло не так. Пригодится, если что-то сломалось: приложите файл к сообщению о проблеме.">
        <div className="st-actions">
          <ActionButton onClick={openLog}>Открыть журнал</ActionButton>
          <ActionButton onClick={openLogFolder}>Открыть папку</ActionButton>
        </div>
        <div className="keys">
          <div>
            <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>L</kbd> показать или скрыть окно
          </div>
          <div>
            <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>→</kbd> / <kbd>←</kbd> следующий или предыдущий трек
          </div>
          <div>
            <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>]</kbd> / <kbd>[</kbd> текст раньше или позже на 0.1 с
          </div>
          <div>
            <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>S</kbd> следующий источник музыки
          </div>
          <div>
            <kbd>Пробел</kbd> пауза · <kbd>→</kbd> / <kbd>←</kbd> трек · <kbd>F11</kbd> полный экран · <kbd>Esc</kbd> вернуться к тексту
          </div>
        </div>
      </Section>
    </>
  );
}

/** Whether saving mode is on right now, and why. */
function SavingStatus() {
  const saving = useSaving();
  const game = useStore((s) => s.power.game);
  const text =
    saving === "game"
      ? game
        ? "Сейчас: игровой режим, на весь экран открыта игра или видео"
        : "Сейчас: игровой режим включён всегда"
      : saving === "battery"
        ? "Сейчас: экономия, ноутбук работает от батареи"
        : "Сейчас: обычный режим";
  return <p className={`st-status ${saving ? "is-on" : ""}`}>{text}</p>;
}

type Surface = "main" | "widget" | "wallpaper";

/** "виджет", "виджет и обои"... */
function joinRu(parts: string[]): string {
  return parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} и ${parts[parts.length - 1]}`;
}

// Copies keep each surface's own size and line position.
const keepSize = (src: LyricStyle, dst: LyricStyle): LyricStyle => ({ ...src, fontSize: dst.fontSize, anchor: dst.anchor });

/**
 * Everything about the window, the widget and the wallpaper, one page each.
 * The widget and the wallpaper can look like the main window: then their own
 * text (and background) settings are not shown at all, so nothing repeats.
 */
function LookTab({ s }: { s: Settings }) {
  const [surface, setSurface] = useState<Surface>("main");
  return (
    <>
      <ThemesSection />
      <div className="st-surfaces">
        <Segmented<Surface>
          value={surface}
          onChange={setSurface}
          options={[
            ["main", "Главное окно"],
            ["widget", "Виджет"],
            ["wallpaper", "Живые обои"],
          ]}
        />
      </div>
      {surface === "main" && <MainPage s={s} />}
      {surface === "widget" && <WidgetPage s={s} />}
      {surface === "wallpaper" && <WallpaperPage s={s} />}
    </>
  );
}

function MainPage({ s }: { s: Settings }) {
  const m = ownMain(s);
  const followers = [...(s.widgetLinked ? ["виджет"] : []), ...(s.wallpaperLinked ? ["обои"] : [])];
  return (
    <>
      <Preview variant="main" look={m.lyrics} scene={m} />
      <PresetPicker current={m.lyrics} scene={m} onPick={(p) => pickMain(s, p)} />
      <LyricStyleEditor
        value={m.lyrics}
        allowAutoSize
        hint={followers.length ? `Так же выглядят ${joinRu(followers)}: они повторяют главное окно` : undefined}
        onChange={(p) => setMainLyrics(s, p)}
      />
      <SceneEditor value={m} hint={s.wallpaperLinked ? "Этот же фон и на обоях" : undefined} onChange={(p) => setMain(s, p)} />
      <Section title="Интерфейс">
        <Row label="Панель плеера">
          <Segmented
            value={m.player}
            onChange={(player) => setMain(s, { player })}
            options={[
              ["auto", "Прятать"],
              ["always", "Всегда"],
              ["hidden", "Скрыть"],
            ]}
          />
        </Row>
        <Toggle label="Обложка и название сверху" value={m.showHeader} onChange={(showHeader) => setMain(s, { showHeader })} />
        <Slider
          label="Прятать кнопки через"
          hint="Когда мышь не двигается и играет музыка"
          value={m.idleSeconds}
          min={1}
          max={15}
          format={(v) => `${v} с`}
          onChange={(idleSeconds) => setMain(s, { idleSeconds })}
        />
      </Section>
      <Section title="Сбросить" hint="Вернуть стандартный вид">
        <div className="st-actions">
          <ResetButton label="Главное окно" onReset={resetMain} />
          <ResetButton label="Всё: окно, виджет и обои" onReset={resetAll} />
        </div>
      </Section>
    </>
  );
}

function WidgetPage({ s }: { s: Settings }) {
  const w = ownWidget(s);
  const shown = resolveWidget(s);
  const linked = s.widgetLinked;
  // The window's blur follows the glass mode (Rust applies it).
  const setLook = (p: Partial<WidgetStyle>) => {
    const next = { ...w, ...p };
    updateSettings({ widgetStyle: next, widgetAcrylic: widgetBlur(next), widgetGlassRadius: next.radius });
  };
  const glass = widgetBlur(w);
  const copyMain = () => updateSettings({ widgetStyle: { ...w, lyrics: keepSize(ownMain(s).lyrics, w.lyrics) } });

  return (
    <>
      <Section title="Виджет на рабочем столе">
        <Toggle label="Показывать виджет" value={s.widgetEnabled} onChange={(v) => updateSettings({ widgetEnabled: v, widgetEdit: false })} />
        <Row label="Слой" hint="На обоях виджет не перекрывает окна" disabled={!s.widgetEnabled}>
          <Segmented
            value={s.widgetOnTop ? "top" : "desktop"}
            disabled={!s.widgetEnabled}
            onChange={(v) => updateSettings({ widgetOnTop: v === "top" })}
            options={[
              ["desktop", "На рабочем столе"],
              ["top", "Поверх окон"],
            ]}
          />
        </Row>
        <Toggle
          label="Клики проходят насквозь"
          hint="Выключите, чтобы управлять плеером с виджета"
          value={s.widgetClickThrough}
          disabled={!s.widgetEnabled}
          onChange={(widgetClickThrough) => updateSettings({ widgetClickThrough })}
        />
        <Toggle
          label="Режим перемещения"
          hint="Перетащите виджет мышью и потяните за угол"
          value={!!s.widgetEdit}
          disabled={!s.widgetEnabled}
          onChange={(widgetEdit) => updateSettings({ widgetEdit })}
        />
      </Section>

      {s.widgetEnabled && (
        <Section title="Расположение и размер" hint="Перетащите прямоугольник на схеме экрана, нажмите на точку или задайте точные значения">
          <WidgetPlacement enabled={s.widgetEnabled} />
        </Section>
      )}

      <Preview variant="widget" look={shown.lyrics} widget={shown} />

      <Section
        title="Формат"
        hint={w.format === "line" ? "Видна только строка, которая поётся; подсветка бежит по словам" : "Текст прокручивается, как в главном окне"}
      >
        <Row label="Показывать">
          <Segmented<WidgetFormat>
            value={w.format}
            onChange={(format) => setWidget(s, { format })}
            options={[
              ["lines", "Несколько строк"],
              ["line", "Одна строка"],
            ]}
          />
        </Row>
        {w.format === "line" && (
          <>
            <Row label="Цвет текущего слова" hint={w.wordColor === "auto" ? "Как цвет выделения текста" : "Свой цвет виджета"}>
              <ColorField value={w.wordColor} onChange={(wordColor) => setWidget(s, { wordColor })} />
            </Row>
            <Toggle
              label="Остальные слова как неактивные строки"
              hint="Яркость берётся из настроек текста"
              value={w.restBrightness === null}
              onChange={(v) => setWidget(s, { restBrightness: v ? null : shown.lyrics.unsung })}
            />
            {w.restBrightness !== null && (
              <Slider
                label="Яркость остальных слов"
                value={w.restBrightness}
                min={0.06}
                max={0.9}
                step={0.01}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(restBrightness) => setWidget(s, { restBrightness })}
              />
            )}
          </>
        )}
      </Section>

      <Section title="Вид текста">
        <Toggle
          label="Как главное окно"
          hint={linked ? "Шрифт, цвета, эффекты и анимация — из главного окна" : "У виджета своё оформление"}
          value={linked}
          onChange={(widgetLinked) => updateSettings({ widgetLinked })}
        />
        {!linked && (
          <div className="st-actions">
            <ActionButton onClick={copyMain}>Скопировать из главного окна</ActionButton>
          </div>
        )}
      </Section>
      {!linked && (
        <>
          <PresetPicker current={w.lyrics} onPick={(p) => pickWidget(s, p)} />
          <LyricStyleEditor part="look" value={w.lyrics} onChange={(p) => setWidgetLyrics(s, p)} />
        </>
      )}
      <LyricStyleEditor part="size" value={w.lyrics} onChange={(p) => setWidgetLyrics(s, p)} />

      <Section title="Подложка">
        <Row label="Тип">
          <Segmented<WidgetBackground>
            value={w.background}
            onChange={(background) => setLook({ background })}
            options={[
              ["tint", "Стекло"],
              ["cover", "Обложка"],
              ["none", "Нет"],
            ]}
          />
        </Row>
        {w.background === "tint" && (
          <Row
            label="Стекло"
            hint={glass ? "Windows размывает рабочий стол за виджетом" : "Только тонировка, без размытия: меньше нагрузка"}
          >
            <Segmented<WidgetGlass>
              value={w.glass}
              onChange={(g) => setLook({ glass: g })}
              options={[
                ["beauty", "Красиво"],
                ["fast", "Быстро"],
              ]}
            />
          </Row>
        )}
        {(w.background === "tint" || w.background === "cover") && (
          <>
            <Row label="Цвет подложки">
              <ColorField value={w.tint} allowAuto={false} allowCover={false} onChange={(tint) => setWidget(s, { tint })} />
            </Row>
            <Slider label="Непрозрачность" value={w.opacity} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(opacity) => setWidget(s, { opacity })} />
          </>
        )}
        {glass && (
          <Slider
            label="Мутность"
            hint="Матовая дымка поверх размытия: от чистого стекла до матового"
            value={w.frost}
            min={0}
            max={1}
            step={0.01}
            format={(v) => (v < 0.005 ? "Чистое" : `${Math.round(v * 100)}%`)}
            onChange={(frost) => setWidget(s, { frost })}
          />
        )}
        {w.background === "cover" && (
          <Slider label="Яркость обложки" value={w.coverOpacity} min={0.1} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(coverOpacity) => setWidget(s, { coverOpacity })} />
        )}
        <Slider
          label="Скругление углов"
          hint={glass && w.radius === 8 ? "8 px — углы скругляет сама Windows, края самые гладкие" : undefined}
          value={w.radius}
          min={0}
          max={40}
          format={(v) => `${v} px`}
          onChange={(radius) => setWidget(s, { radius })}
        />
        <Slider label="Тень под текстом" hint="Помогает читать на пёстрых обоях" value={w.shadow} min={0} max={2} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(shadow) => setWidget(s, { shadow })} />
      </Section>

      <Section title="Содержимое">
        <Toggle label="Название трека сверху" value={w.showCaption} onChange={(showCaption) => setWidget(s, { showCaption })} />
        <Toggle label="Мини-обложка" value={w.showCover} disabled={!w.showCaption} onChange={(showCover) => setWidget(s, { showCover })} />
        <Toggle
          label="Эквалайзер в такт музыке"
          hint="Полоски у названия двигаются под музыку. MUSE слушает только звук плеера, пока виджет виден; ничего не записывается"
          value={w.levels}
          disabled={!w.showCaption}
          onChange={(levels) => setWidget(s, { levels })}
        />
        <Toggle
          label="Кнопки плеера при наведении"
          hint={s.widgetClickThrough ? "Работают, когда клики не проходят насквозь" : undefined}
          value={w.controls}
          onChange={(controls) => setWidget(s, { controls })}
        />
      </Section>

      <Section title="Сбросить" hint="Вернуть стандартный вид виджета">
        <div className="st-actions">
          <ResetButton label="Виджет" onReset={resetWidget} />
        </div>
      </Section>
    </>
  );
}

function WallpaperPage({ s }: { s: Settings }) {
  const mon = useWallMonitors(s);
  const { m, picked } = mon;
  const w = ownWallpaper(s, m);
  const shown = resolveWallpaper(s, m);
  const linked = s.wallpaperLinked;
  const set = (p: Partial<WallpaperStyle>) => setWall(s, p, m);

  const toggleMonitor = (i: number) => {
    const next = picked.includes(i) ? picked.filter((x) => x !== i) : [...picked, i];
    if (next.length > 0) updateSettings({ wallpaperMonitors: next });
  };
  const setSplit = (on: boolean) => {
    if (on) {
      // Every monitor starts from the shared look, then goes its own way.
      const sharedLook = ownWallpaper({ ...s, wallpaperSplit: false });
      updateSettings({ wallpaperSplit: true, wallpaperStyles: Object.fromEntries(picked.map((i) => [String(i), sharedLook])) });
    } else {
      // Merging keeps the look of the monitor that was being edited.
      updateSettings({ wallpaperSplit: false, wallpaperStyle: ownWallpaper(s, m), wallpaperStyles: null });
    }
  };
  const copyMain = () => {
    const main = ownMain(s);
    set({
      background: main.background,
      bgColor: main.bgColor,
      bgBrightness: main.bgBrightness,
      bgSaturation: main.bgSaturation,
      bgSpeed: main.bgSpeed,
      bgBeat: main.bgBeat,
      lyrics: { ...keepSize(main.lyrics, w.lyrics), align: w.lyrics.align },
    });
  };

  return (
    <>
      <Section title="Живые обои" hint="Текст песни вместо обоев рабочего стола. Ярлыки остаются поверх, сами обои не реагируют на клики.">
        <Toggle label="Включить живые обои" value={s.wallpaperEnabled} onChange={(wallpaperEnabled) => updateSettings({ wallpaperEnabled })} />
        {mon.monitors.length > 1 && (
          <Row label="Мониторы" hint="Можно выбрать несколько">
            <div className="st-list">
              {mon.monitors.map((info, i) => (
                <button key={i} className={`st-chip ${picked.includes(i) ? "is-on" : ""}`} title={info.name} onClick={() => toggleMonitor(i)}>
                  {mon.name(i)}
                </button>
              ))}
            </div>
          </Row>
        )}
        {mon.multi && (
          <Row label="Настройки мониторов" hint={mon.split ? "У каждого монитора своё оформление и расположение" : "Все мониторы выглядят одинаково"}>
            <Segmented<boolean>
              value={mon.split}
              onChange={setSplit}
              options={[
                [false, "Общие"],
                [true, "Раздельные"],
              ]}
            />
          </Row>
        )}
        <Toggle
          label="Пауза под развёрнутыми окнами"
          hint="Анимация останавливается, когда обои не видно"
          value={s.wallpaperPauseCovered}
          onChange={(wallpaperPauseCovered) => updateSettings({ wallpaperPauseCovered })}
        />
      </Section>

      {mon.switcher}

      <Preview key={m ?? "shared"} variant="wallpaper" look={shown.lyrics} scene={shown} column={wallpaperColumn(shown)} />

      <Section title="Вид текста и фон">
        <Toggle
          label="Как главное окно"
          hint={linked ? "Шрифт, цвета, анимация и фон — из главного окна" : "У обоев своё оформление и свой фон"}
          value={linked}
          onChange={(wallpaperLinked) => updateSettings({ wallpaperLinked })}
        />
        {!linked && (
          <div className="st-actions">
            <ActionButton onClick={copyMain}>Скопировать из главного окна</ActionButton>
          </div>
        )}
      </Section>
      {!linked && (
        <>
          <PresetPicker current={w.lyrics} scene={w} onPick={(p) => pickWall(s, p, m)} />
          <LyricStyleEditor part="look" hideAlign value={w.lyrics} onChange={(p) => setWallLyrics(s, p, m)} />
          <SceneEditor value={w} onChange={(p) => set(p)} />
        </>
      )}

      <Section title="Расположение">
        <Row label="Текст на экране" hint={linked ? "Как выравнивание в главном окне" : "Колонка и выравнивание строк"} disabled={linked}>
          <Segmented
            value={shown.position}
            disabled={linked}
            onChange={(position) => set({ position, lyrics: { ...w.lyrics, align: position } })}
            options={[
              ["left", "Слева"],
              ["center", "По центру"],
              ["right", "Справа"],
            ]}
          />
        </Row>
        <Slider label="Ширина колонки" value={w.width} min={0.3} max={0.9} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(width) => set({ width })} />
        <Slider label="Затемнение" hint="Чтобы ярлыки читались лучше" value={w.dim} min={0} max={0.7} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(dim) => set({ dim })} />
      </Section>

      <LyricStyleEditor part="size" allowAutoSize value={w.lyrics} onChange={(p) => setWallLyrics(s, p, m)} />

      <Section title="Обложка трека">
        <Toggle label="Карточка с обложкой и названием" value={w.showTrack} onChange={(showTrack) => set({ showTrack })} />
        <Row label="Угол экрана" disabled={!w.showTrack}>
          <Segmented<Corner>
            value={w.trackCorner}
            disabled={!w.showTrack}
            onChange={(trackCorner) => set({ trackCorner })}
            options={[
              ["top-left", "↖"],
              ["top-right", "↗"],
              ["bottom-left", "↙"],
              ["bottom-right", "↘"],
            ]}
          />
        </Row>
        <Row label="Большая обложка" hint="Когда у песни нет текста">
          <Segmented
            value={w.artPosition}
            onChange={(artPosition) => set({ artPosition })}
            options={[
              ["left", "Слева"],
              ["center", "По центру"],
              ["right", "Справа"],
            ]}
          />
        </Row>
      </Section>

      <Section title="Сбросить" hint="Вернуть стандартный вид обоев">
        <div className="st-actions">
          <ResetButton label="Обои" onReset={resetWall} />
        </div>
      </Section>
    </>
  );
}

const LINKS: [string, string, ReactNode][] = [
  ["GitHub", REPO_URL, <GithubIcon size={16} key="g" />],
  ["Все версии", `${REPO_URL}/releases`, <DownloadIcon size={16} key="r" />],
  ["Сообщить о проблеме", `${REPO_URL}/issues/new`, <BugIcon size={16} key="b" />],
  ["lrclib.net", "https://lrclib.net", <LinkIcon size={15} key="l" />],
  ["Genius", "https://genius.com", <LinkIcon size={15} key="n" />],
];

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
const date = (iso: string) => (iso ? new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }) : "");

function About({ s }: { s: Settings }) {
  const u = useUpdate();
  const [version, setVersion] = useState("");
  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);
  const busy = u.status === "checking" || u.status === "downloading" || u.status === "installing";

  let status: ReactNode;
  switch (u.status) {
    case "checking":
      status = "Проверяем обновления…";
      break;
    case "latest":
      status = "У вас последняя версия";
      break;
    case "available":
      status = (
        <>
          Доступна версия <b>{u.info!.version}</b>
          {u.info!.published && <span className="sw-update-meta"> · {date(u.info!.published)}</span>}
          {u.info!.size > 0 && <span className="sw-update-meta"> · {mb(u.info!.size)}</span>}
        </>
      );
      break;
    case "downloading":
      status = `Скачиваем обновление… ${Math.round(u.progress * 100)}%`;
      break;
    case "installing":
      status = "Устанавливаем, MUSE сейчас перезапустится";
      break;
    case "error":
      status = <span className="sw-update-error">Не получилось: {u.error}</span>;
      break;
    default:
      status = "Обновления приходят с GitHub";
  }

  return (
    <>
      <div className="sw-about">
        <Logo size={112} className="sw-about-logo" />
        <h2>MUSE</h2>
        <p className="sw-about-version">Версия {version || "…"}</p>
        <p>Синхронизированный текст песен для Windows: в окне, на рабочем столе и вместо обоев.</p>
      </div>

      <Section title="Обновления">
        <div className={`sw-update is-${u.status}`}>
          <div className="sw-update-status">{status}</div>
          <div className="sw-update-buttons">
            {u.status === "available" ? (
              <button className="link-button link-button-primary" onClick={installUpdate}>
                <DownloadIcon size={15} /> Обновить
              </button>
            ) : (
              <button className="link-button" disabled={busy} onClick={checkForUpdate}>
                <RefreshIcon size={15} className={u.status === "checking" ? "is-spinning" : ""} /> Проверить
              </button>
            )}
          </div>
          {(u.status === "downloading" || u.status === "installing") && (
            <div className="sw-update-bar">
              <span style={{ transform: `scaleX(${u.progress})` }} />
            </div>
          )}
          {u.status === "available" && u.info!.notes && <div className="sw-update-notes">{u.info!.notes}</div>}
        </div>
        <Toggle
          label="Проверять обновления автоматически"
          hint="Раз в несколько часов; о новой версии появится уведомление"
          value={s.updateCheck}
          onChange={(updateCheck) => updateSettings({ updateCheck })}
        />
      </Section>

      <Section title="Ссылки">
        <div className="sw-links">
          {LINKS.map(([label, url, icon]) => (
            <button key={url} className="sw-link" onClick={() => openLink(url)}>
              {icon}
              {label}
            </button>
          ))}
        </div>
      </Section>

      <p className="sw-about-small sw-about-foot">
        Трек определяется через системные медиа-контролы Windows. Тексты: lrclib.net, затем Genius. Свои тексты и тайминги хранятся только на этом компьютере.
      </p>
    </>
  );
}

// ---- Small icons -----------------------------------------------------------

/** A brush over a palette: how things look. */
function LookIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z" />
      <circle cx="7.5" cy="11" r="1" fill="currentColor" />
      <circle cx="10.5" cy="7" r="1" fill="currentColor" />
      <circle cx="15" cy="7.5" r="1" fill="currentColor" />
    </svg>
  );
}
