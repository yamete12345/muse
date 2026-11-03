import { useEffect, useState, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { Background } from "../components/Background";
import { Glass } from "../components/Glass/Glass";
import { CloseIcon, GearIcon, MinimizeIcon, NoteIcon, WidgetIcon } from "../components/Icons";
import { Logo } from "../components/Logo";
import { ActionButton, Row, Section, Segmented, Slider, Toggle, ColorField } from "../components/settings/controls";
import { LyricStyleEditor, SceneEditor } from "../components/settings/editors";
import { Preview } from "../components/settings/Preview";
import { getWidgetSize, listMonitors, setWidgetSize, updateSettings } from "../core/api";
import { useStore } from "../core/store";
import {
  DEFAULT_MAIN,
  DEFAULT_WALLPAPER,
  DEFAULT_WIDGET,
  ownMain,
  ownWallpaper,
  ownWidget,
  resolveWallpaper,
  resolveWidget,
  type LyricStyle,
  type MainStyle,
  type WallpaperStyle,
  type WidgetBackground,
  type WidgetStyle,
} from "../core/style";
import { useResolvedTheme } from "../core/theme";
import type { Settings, ThemeSetting } from "../core/types";

const win = getCurrentWindow();

type Tab = "general" | "main" | "widget" | "wallpaper" | "sync" | "about";

const TABS: [Tab, string, ReactNode][] = [
  ["general", "Общие", <GearIcon size={17} key="g" />],
  ["main", "Главное окно", <WindowIcon key="m" />],
  ["widget", "Виджет", <WidgetIcon size={17} key="w" />],
  ["wallpaper", "Живые обои", <WallpaperIcon key="p" />],
  ["sync", "Синхронизация", <SyncIcon key="s" />],
  ["about", "О программе", <NoteIcon size={16} key="a" />],
];

export function SettingsWindow() {
  const theme = useResolvedTheme();
  const settings = useStore((s) => s.settings);
  const [tab, setTab] = useState<Tab>("main");
  const main = ownMain(settings);
  const idx = TABS.findIndex(([t]) => t === tab);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && win.close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="sw">
      <Background light={theme === "light"} scene={{ ...main, bgBrightness: main.bgBrightness * 0.8 }} />

      <Glass variant="panel" radius={26} className="sw-nav" large>
        <div className="sw-nav-inner" data-tauri-drag-region="deep">
          <div className="sw-brand">
            <Logo size={34} />
            <div>
              <div className="sw-brand-name">mutxt</div>
              <div className="sw-brand-sub">Настройки</div>
            </div>
          </div>
          <nav className="sw-tabs" style={{ ["--i" as string]: idx }}>
            <span className="sw-tab-thumb" />
            {TABS.map(([t, label, icon]) => (
              <button key={t} className={`sw-tab ${t === tab ? "is-on" : ""}`} onClick={() => setTab(t)}>
                <span className="sw-tab-icon">{icon}</span>
                {label}
              </button>
            ))}
          </nav>
        </div>
      </Glass>

      <main className="sw-main">
        <header className="sw-head" data-tauri-drag-region="deep">
          <h1 key={tab}>{TABS[idx][1]}</h1>
          <div className="sw-head-buttons">
            <Glass as="button" variant="button" className="icon-btn icon-btn-sm" aria-label="Свернуть" onClick={() => win.minimize()}>
              <MinimizeIcon size={14} />
            </Glass>
            <Glass as="button" variant="button" className="icon-btn icon-btn-sm icon-btn-close" aria-label="Закрыть" onClick={() => win.close()}>
              <CloseIcon size={14} />
            </Glass>
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
const setWall = (s: Settings, p: Partial<WallpaperStyle>) => updateSettings({ wallpaperStyle: { ...ownWallpaper(s), ...p } });
const setWallLyrics = (s: Settings, p: Partial<LyricStyle>) => setWall(s, { lyrics: { ...ownWallpaper(s).lyrics, ...p } });

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
        <Toggle label="Запускать вместе с Windows" hint="Стартует свёрнутым в трей" value={s.autostart} onChange={(autostart) => updateSettings({ autostart })} />
        <div className="keys">
          <div>
            <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>L</kbd> показать или скрыть окно
          </div>
          <div>
            <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>]</kbd> / <kbd>[</kbd> текст раньше или позже на 0.1 с
          </div>
          <div>
            <kbd>Пробел</kbd> пауза · <kbd>F11</kbd> полный экран · <kbd>Esc</kbd> закрыть панель
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
  const [size, setSize] = useState<[number, number] | null>(null);
  useEffect(() => {
    if (s.widgetEnabled) getWidgetSize().then(setSize);
  }, [s.widgetEnabled]);
  const resize = (next: [number, number]) => {
    setSize(next);
    setWidgetSize(next[0], next[1]);
  };
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
        {size && (
          <>
            <Slider label="Ширина" value={Math.round(size[0])} min={240} max={1600} step={10} format={(v) => `${v} px`} onChange={(v) => resize([v, size[1]])} />
            <Slider label="Высота" value={Math.round(size[1])} min={110} max={1000} step={10} format={(v) => `${v} px`} onChange={(v) => resize([size[0], v])} />
          </>
        )}
      </Section>

      <Preview variant="widget" look={shown.lyrics} widget={shown} />

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
  const w = ownWallpaper(s);
  const shown = resolveWallpaper(s);
  const [monitors, setMonitors] = useState<string[]>([]);
  useEffect(() => {
    listMonitors().then(setMonitors);
  }, []);

  return (
    <>
      <Section title="Живые обои" hint="Текст песни вместо обоев рабочего стола. Ярлыки остаются поверх, сами обои не реагируют на клики.">
        <Toggle label="Включить живые обои" value={s.wallpaperEnabled} onChange={(wallpaperEnabled) => updateSettings({ wallpaperEnabled })} />
        {monitors.length > 1 && (
          <Row label="Монитор">
            <div className="st-list">
              <button className={`st-chip ${s.wallpaperMonitor < 0 ? "is-on" : ""}`} onClick={() => updateSettings({ wallpaperMonitor: -1 })}>
                Основной
              </button>
              {monitors.map((m, i) => (
                <button key={m + i} className={`st-chip ${s.wallpaperMonitor === i ? "is-on" : ""}`} onClick={() => updateSettings({ wallpaperMonitor: i })}>
                  {m}
                </button>
              ))}
            </div>
          </Row>
        )}
        <Toggle
          label="Пауза под развёрнутыми окнами"
          hint="Анимация останавливается, когда обои не видно"
          value={s.wallpaperPauseCovered}
          onChange={(wallpaperPauseCovered) => updateSettings({ wallpaperPauseCovered })}
        />
      </Section>

      <Preview variant="wallpaper" look={shown.lyrics} scene={shown} />

      <Section title="Расположение">
        <Row label="Колонка текста">
          <Segmented
            value={w.position}
            onChange={(position) => setWall(s, { position })}
            options={[
              ["left", "Слева"],
              ["center", "По центру"],
              ["right", "Справа"],
            ]}
          />
        </Row>
        <Slider label="Ширина колонки" value={w.width} min={0.3} max={0.9} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(width) => setWall(s, { width })} />
        <Toggle label="Трек и обложка внизу" value={w.showTrack} onChange={(showTrack) => setWall(s, { showTrack })} />
        <Slider label="Затемнение" hint="Чтобы ярлыки читались лучше" value={w.dim} min={0} max={0.7} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(dim) => setWall(s, { dim })} />
      </Section>

      <SceneEditor value={s.wallpaperLinked ? shown : w} linked={s.wallpaperLinked} onChange={(p) => setWall(s, p)} />
      <LyricStyleEditor value={s.wallpaperLinked ? shown.lyrics : w.lyrics} allowAutoSize linked={s.wallpaperLinked} onChange={(p) => setWallLyrics(s, p)} />
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

      <Section title="Сбросить оформление">
        <div className="st-actions">
          <ActionButton onClick={() => updateSettings({ mainStyle: DEFAULT_MAIN })}>Главное окно</ActionButton>
          <ActionButton onClick={() => updateSettings({ widgetStyle: DEFAULT_WIDGET, widgetAcrylic: false })}>Виджет</ActionButton>
          <ActionButton onClick={() => updateSettings({ wallpaperStyle: DEFAULT_WALLPAPER })}>Обои</ActionButton>
        </div>
      </Section>
    </>
  );
}

function About() {
  return (
    <div className="sw-about">
      <Logo size={112} className="sw-about-logo" />
      <h2>mutxt</h2>
      <p className="sw-about-version">Версия 0.1.0</p>
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
