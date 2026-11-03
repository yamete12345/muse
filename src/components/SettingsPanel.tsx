import { updateSettings } from "../core/api";
import { useStore } from "../core/store";
import type { Settings, ThemeSetting } from "../core/types";

export function SettingsContent() {
  const s = useStore((st) => st.settings);
  const set = (patch: Partial<Settings>) => updateSettings(patch);

  return (
    <>
      <Section title="Тема">
        <Segmented<ThemeSetting>
          value={s.theme}
          onChange={(theme) => set({ theme })}
          options={[
            ["dark", "Тёмная"],
            ["light", "Светлая"],
            ["system", "Системная"],
          ]}
        />
      </Section>

      <Section title="Виджет на рабочем столе">
        <Toggle label="Показывать виджет" value={s.widgetEnabled} onChange={(v) => set({ widgetEnabled: v, widgetEdit: false })} />
        <Toggle
          label="Режим перемещения"
          hint="Перетащите виджет и потяните за угол, чтобы изменить размер"
          value={!!s.widgetEdit}
          disabled={!s.widgetEnabled}
          onChange={(v) => set({ widgetEdit: v })}
        />
        <Toggle label="Стеклянная подложка Windows" value={s.widgetAcrylic} disabled={!s.widgetEnabled} onChange={(v) => set({ widgetAcrylic: v })} />
        <label className={`slider-row ${s.widgetEnabled ? "" : "is-disabled"}`}>
          <span>Размер текста</span>
          <input
            type="range"
            min={16}
            max={48}
            step={1}
            value={s.widgetFontSize}
            disabled={!s.widgetEnabled}
            onChange={(e) => set({ widgetFontSize: Number(e.target.value) })}
          />
          <span className="slider-value">{s.widgetFontSize}</span>
        </label>
      </Section>

      <Section title="Производительность">
        <Toggle label="Упрощённое стекло" hint="Без преломления: меньше нагрузка на видеокарту" value={s.simpleGlass} onChange={(v) => set({ simpleGlass: v })} />
        <div className="row">
          <span>Частота фона</span>
          <Segmented<number>
            value={s.bgFps}
            onChange={(bgFps) => set({ bgFps })}
            options={[
              [30, "30 fps"],
              [60, "60 fps"],
            ]}
          />
        </div>
      </Section>

      <Section title="Система">
        <Toggle label="Запускать вместе с Windows" value={s.autostart} onChange={(v) => set({ autostart: v })} />
        <div className="keys">
          <div>
            <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>L</kbd> показать или скрыть окно
          </div>
          <div>
            <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>]</kbd> / <kbd>[</kbd> текст раньше или позже
          </div>
          <div>
            <kbd>Пробел</kbd> пауза · <kbd>F11</kbd> полный экран · <kbd>Esc</kbd> закрыть панель
          </div>
        </div>
      </Section>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="settings-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Toggle({
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button className={`toggle-row ${disabled ? "is-disabled" : ""}`} disabled={disabled} onClick={() => onChange(!value)} role="switch" aria-checked={value}>
      <span className="toggle-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      <span className={`switch ${value ? "is-on" : ""}`}>
        <span className="switch-knob" />
      </span>
    </button>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  const idx = Math.max(0, options.findIndex(([v]) => v === value));
  return (
    <div className="segmented" style={{ ["--n" as string]: options.length, ["--i" as string]: idx }}>
      <span className="segmented-thumb" />
      {options.map(([v, label]) => (
        <button key={String(v)} className={v === value ? "is-on" : ""} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}
