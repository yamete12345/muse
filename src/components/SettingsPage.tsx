import { useEffect, useState, type ReactNode } from "react";

import { Glass } from "./Glass/Glass";
import { BackIcon, GearIcon, NoteIcon, WidgetIcon } from "./Icons";
import { Logo } from "./Logo";
import { ActionButton, Row, Section, Segmented, Slider, Toggle, ColorField } from "./settings/controls";
import { LyricStyleEditor, SceneEditor } from "./settings/editors";
import { Preview } from "./settings/Preview";
import { PresetPicker, ResetButton, WidgetPlacement } from "./settings/presets";
import { listMonitors, updateSettings } from "../core/api";
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
  type WidgetStyle,
} from "../core/style";
import type { MonitorInfo, Settings, ThemeSetting } from "../core/types";
import { openView, useView } from "../core/ui";

type Tab = "general" | "main" | "widget" | "wallpaper" | "sync" | "about";

const TABS: [Tab, string, ReactNode][] = [
  ["general", "Общие", <GearIcon size={17} key="g" />],
  ["main", "Главное окно", <WindowIcon key="m" />],
  ["widget", "Виджет", <WidgetIcon size={17} key="w" />],
  ["wallpaper", "Живые обои", <WallpaperIcon key="p" />],
  ["sync", "Синхронизация", <SyncIcon key="s" />],
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
  const [tab, setTab] = useState<Tab>("main");
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
            {RESETS[tab] && <ResetButton key={tab} label="Сбросить оформление" onReset={RESETS[tab]!} />}
            <button className="link-button" onClick={() => openView("lyrics")}>
              <BackIcon size={15} />
              К тексту
            </button>
          </div>
        </header>
        <div className="sw-scroll">
          <div className="sw-content" key={tab}>
            {tab === "general" && <General s={settings} />}
            {tab === "main" && <MainTab s={settings} />}
            {tab === "widget" && <WidgetTab s={settings} />}
            {tab === "wallpaper" && <WallpaperTab s={settings} />}
            {tab === "sync" && <SyncTab s={settings} />}
            {tab === "about" && <About />}
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

const RESETS: Partial<Record<Tab, () => void>> = { main: resetMain, widget: resetWidget, wallpaper: resetWall };

// Presets restyle a surface; a linked one is unlinked first, or the main window would override it.
const pickMain = (s: Settings, p: Preset) => {
  const m = ownMain(s);
  setMain(s, { ...presetScene(p), lyrics: presetLyrics(p, m.lyrics) });
};
const pickWidget = (s: Settings, p: Preset) => {
  const w = ownWidget(s);
  updateSettings({ widgetLinked: false, widgetStyle: { ...w, lyrics: presetLyrics(p, w.lyrics) } });
};
const pickWall = (s: Settings, p: Preset, m?: number) => {
  const w = ownWallpaper(s, m);
  updateSettings({ wallpaperLinked: false, ...wallpaperPatch(s, { ...w, ...presetScene(p), lyrics: presetLyrics(p, w.lyrics) }, m) });
};

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
      <Section title="Производительность">
        <Toggle label="Упрощённое стекло" hint="Без преломления по краям: меньше нагрузка на видеокарту" value={s.simpleGlass} onChange={(simpleGlass) => updateSettings({ simpleGlass })} />
        <Row label="Частота анимации фона">
          <Segmented<number>
            value={s.bgFps}
            onChange={(bgFps) => updateSettings({ bgFps })}
            options={[
              [24, "24"],
              [30, "30"],
              [60, "60 fps"],
            ]}
          />
        </Row>
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
        <div className="st-actions">
          <ResetButton label="Сбросить всё оформление" onReset={resetAll} />
        </div>
        <div className="keys">
          <div>
            <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>L</kbd> показать или скрыть окно
          </div>
          <div>
            <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>]</kbd> / <kbd>[</kbd> текст раньше или позже на 0.1 с
          </div>
          <div>
            <kbd>Пробел</kbd> пауза · <kbd>F11</kbd> полный экран · <kbd>Esc</kbd> вернуться к тексту
          </div>
        </div>
      </Section>
    </>
  );
}

function MainTab({ s }: { s: Settings }) {
  const m = ownMain(s);
  return (
    <>
      <Preview variant="main" look={m.lyrics} scene={m} />
      <PresetPicker current={m.lyrics} scene={m} onPick={(p) => pickMain(s, p)} />
      <LyricStyleEditor value={m.lyrics} allowAutoSize onChange={(p) => setMainLyrics(s, p)} />
      <SceneEditor value={m} onChange={(p) => setMain(s, p)} />
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
    </>
  );
}

function WidgetTab({ s }: { s: Settings }) {
  const w = ownWidget(s);
  const shown = resolveWidget(s);
  const setBackground = (background: WidgetBackground) => {
    updateSettings({ widgetStyle: { ...w, background }, widgetAcrylic: background === "acrylic" });
  };

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
      <PresetPicker
        current={shown.lyrics}
        onPick={(p) => pickWidget(s, p)}
        hint={s.widgetLinked ? "Выбор пресета отвяжет виджет от главного окна" : undefined}
      />

      <Section title="Подложка">
        <Row label="Тип">
          <Segmented<WidgetBackground>
            value={w.background}
            onChange={setBackground}
            options={[
              ["none", "Нет"],
              ["tint", "Стекло"],
              ["acrylic", "Акрил Windows"],
              ["cover", "Обложка"],
            ]}
          />
        </Row>
        {(w.background === "tint" || w.background === "cover") && (
          <>
            <Row label="Цвет подложки">
              <ColorField value={w.tint} allowAuto={false} allowCover={false} onChange={(tint) => setWidget(s, { tint })} />
            </Row>
            <Slider label="Непрозрачность" value={w.opacity} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(opacity) => setWidget(s, { opacity })} />
          </>
        )}
        {w.background === "cover" && (
          <Slider label="Яркость обложки" value={w.coverOpacity} min={0.1} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(coverOpacity) => setWidget(s, { coverOpacity })} />
        )}
        <Slider label="Скругление углов" value={w.radius} min={0} max={40} format={(v) => `${v} px`} onChange={(radius) => setWidget(s, { radius })} />
        <Slider label="Тень под текстом" hint="Помогает читать на пёстрых обоях" value={w.shadow} min={0} max={2} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(shadow) => setWidget(s, { shadow })} />
      </Section>

      <Section title="Содержимое">
        <Toggle label="Название трека сверху" value={w.showCaption} onChange={(showCaption) => setWidget(s, { showCaption })} />
        <Toggle label="Мини-обложка" value={w.showCover} disabled={!w.showCaption} onChange={(showCover) => setWidget(s, { showCover })} />
        <Toggle
          label="Кнопки плеера при наведении"
          hint={s.widgetClickThrough ? "Работают, когда клики не проходят насквозь" : undefined}
          value={w.controls}
          onChange={(controls) => setWidget(s, { controls })}
        />
      </Section>

      <LyricStyleEditor value={s.widgetLinked ? shown.lyrics : w.lyrics} linked={s.widgetLinked} onChange={(p) => setWidgetLyrics(s, p)} />
    </>
  );
}

function WallpaperTab({ s }: { s: Settings }) {
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  useEffect(() => {
    listMonitors().then(setMonitors);
  }, []);

  // Stored picks may say -1 for "the primary monitor"; the UI works with real indexes.
  const primary = Math.max(0, monitors.findIndex((m) => m.primary));
  const picked = [...new Set(s.wallpaperMonitors.map((i) => (i < 0 ? primary : i)))].sort((a, b) => a - b);
  const multi = picked.length > 1;
  const split = s.wallpaperSplit && multi;
  const [editing, setEditing] = useState<number | null>(null);
  const m = split ? (editing !== null && picked.includes(editing) ? editing : picked[0]) : undefined;

  const w = ownWallpaper(s, m);
  const shown = resolveWallpaper(s, m);
  const set = (p: Partial<WallpaperStyle>) => setWall(s, p, m);

  const toggleMonitor = (i: number) => {
    const next = picked.includes(i) ? picked.filter((x) => x !== i) : [...picked, i];
    if (next.length > 0) updateSettings({ wallpaperMonitors: next });
  };
  const setSplit = (on: boolean) => {
    if (on) {
      // Every monitor starts from the shared look, then goes its own way.
      const shared = ownWallpaper({ ...s, wallpaperSplit: false });
      updateSettings({ wallpaperSplit: true, wallpaperStyles: Object.fromEntries(picked.map((i) => [String(i), shared])) });
    } else {
      // Merging keeps the look of the monitor that was being edited.
      updateSettings({ wallpaperSplit: false, wallpaperStyle: ownWallpaper(s, m), wallpaperStyles: null });
    }
  };
  const name = (i: number) => (monitors[i] ? `Монитор ${i + 1}${monitors[i].primary ? " (основной)" : ""}` : `Монитор ${i + 1}`);

  return (
    <>
      <Section title="Живые обои" hint="Текст песни вместо обоев рабочего стола. Ярлыки остаются поверх, сами обои не реагируют на клики.">
        <Toggle label="Включить живые обои" value={s.wallpaperEnabled} onChange={(wallpaperEnabled) => updateSettings({ wallpaperEnabled })} />
        {monitors.length > 1 && (
          <Row label="Мониторы" hint="Можно выбрать несколько">
            <div className="st-list">
              {monitors.map((mon, i) => (
                <button key={i} className={`st-chip ${picked.includes(i) ? "is-on" : ""}`} title={mon.name} onClick={() => toggleMonitor(i)}>
                  {name(i)}
                </button>
              ))}
            </div>
          </Row>
        )}
        {multi && (
          <Row label="Настройки мониторов" hint={split ? "У каждого монитора своё оформление" : "Все мониторы выглядят одинаково"}>
            <Segmented<boolean>
              value={split}
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

      {split && (
        <div className="st-monitor-switch">
          <span>Настраиваете</span>
          <Segmented<number> value={m!} onChange={setEditing} options={picked.map((i) => [i, name(i)] as [number, string])} />
        </div>
      )}

      <Preview key={m ?? "shared"} variant="wallpaper" look={shown.lyrics} scene={shown} column={wallpaperColumn(w)} />
      <PresetPicker
        current={shown.lyrics}
        scene={shown}
        onPick={(p) => pickWall(s, p, m)}
        hint={s.wallpaperLinked ? "Выбор пресета отвяжет обои от главного окна" : undefined}
      />

      <Section title="Расположение">
        <Row label="Текст на экране" hint="Колонка и выравнивание строк">
          <Segmented
            value={w.position}
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

      <SceneEditor value={s.wallpaperLinked ? shown : w} linked={s.wallpaperLinked} onChange={(p) => set(p)} />
      <LyricStyleEditor value={s.wallpaperLinked ? shown.lyrics : w.lyrics} allowAutoSize hideAlign linked={s.wallpaperLinked} onChange={(p) => setWallLyrics(s, p, m)} />
    </>
  );
}

function SyncTab({ s }: { s: Settings }) {
  const main = ownMain(s);
  const widget = ownWidget(s);
  const wall = ownWallpaper(s);
  // Copies keep each surface's own size and line position.
  const keep = (src: LyricStyle, dst: LyricStyle): LyricStyle => ({ ...src, fontSize: dst.fontSize, anchor: dst.anchor });

  return (
    <>
      <Section title="Связать оформление" hint="Связанные поверхности повторяют шрифт, цвета, эффекты и анимацию главного окна. Размер и положение текста у каждой свои.">
        <Toggle label="Виджет повторяет главное окно" value={s.widgetLinked} onChange={(widgetLinked) => updateSettings({ widgetLinked })} />
        <Toggle label="Обои повторяют главное окно" hint="Вместе с фоном" value={s.wallpaperLinked} onChange={(wallpaperLinked) => updateSettings({ wallpaperLinked })} />
      </Section>

      <Section title="Скопировать один раз" hint="Перенести текущее оформление, не связывая">
        <div className="st-actions">
          <ActionButton onClick={() => updateSettings({ widgetStyle: { ...widget, lyrics: keep(main.lyrics, widget.lyrics) } })}>Окно → виджет</ActionButton>
          <ActionButton
            onClick={() =>
              updateSettings({
                wallpaperStyles: null,
                wallpaperStyle: {
                  ...wall,
                  background: main.background,
                  bgColor: main.bgColor,
                  bgBrightness: main.bgBrightness,
                  bgSaturation: main.bgSaturation,
                  bgSpeed: main.bgSpeed,
                  lyrics: keep(main.lyrics, wall.lyrics),
                },
              })
            }
          >
            Окно → обои
          </ActionButton>
          <ActionButton onClick={() => updateSettings({ mainStyle: { ...main, lyrics: keep(widget.lyrics, main.lyrics) } })}>Виджет → окно</ActionButton>
          <ActionButton onClick={() => updateSettings({ mainStyle: { ...main, lyrics: keep(wall.lyrics, main.lyrics) } })}>Обои → окно</ActionButton>
        </div>
      </Section>

      <Section title="Сбросить оформление" hint="Вернуть стандартный вид">
        <div className="st-actions">
          <ResetButton label="Главное окно" onReset={resetMain} />
          <ResetButton label="Виджет" onReset={resetWidget} />
          <ResetButton label="Обои" onReset={resetWall} />
          <ResetButton label="Всё сразу" onReset={resetAll} />
        </div>
      </Section>
    </>
  );
}

function About() {
  return (
    <div className="sw-about">
      <Logo size={112} className="sw-about-logo" />
      <h2>MUSE</h2>
      <p className="sw-about-version">Версия 0.2.1</p>
      <p>Синхронизированный текст песен для Windows: в окне, на рабочем столе и вместо обоев.</p>
      <p className="sw-about-small">
        Трек определяется через системные медиа-контролы Windows. Тексты: lrclib.net, затем Genius. Свои тексты и тайминги хранятся локально.
      </p>
    </div>
  );
}

// ---- Small icons -----------------------------------------------------------

function WindowIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <path d="M3.5 9h17" />
    </svg>
  );
}

function WallpaperIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="13" rx="2.5" />
      <path d="M3.5 14l5-4.5 4 3.5 3-2.5 5 4M8 21h8" />
    </svg>
  );
}

function SyncIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.6L4 15.5M4 20v-4.5h4.5" />
    </svg>
  );
}
