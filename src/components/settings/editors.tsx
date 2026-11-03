import type { FillMode, FontChoice, LyricStyle, Motion, SceneStyle } from "../../core/style";
import { ColorField, Row, Section, Segmented, Slider, Toggle } from "./controls";

const pct = (v: number) => `${Math.round(v * 100)}%`;
const times = (v: number) => `${v.toFixed(2)}×`;

interface LyricEditorProps {
  value: LyricStyle;
  onChange: (patch: Partial<LyricStyle>) => void;
  /** Size 0 = fit to the window; the widget always has an explicit size. */
  allowAutoSize?: boolean;
  /** When the surface follows the main window, only its own layout stays editable. */
  linked?: boolean;
}

export function LyricStyleEditor({ value: l, onChange, allowAutoSize, linked }: LyricEditorProps) {
  const auto = l.fontSize === 0;
  return (
    <>
      <Section title="Текст" hint={linked ? "Шрифт, цвета и анимация берутся из главного окна" : undefined}>
        <Row label="Шрифт" disabled={linked}>
          <Segmented<FontChoice>
            value={l.font}
            disabled={linked}
            onChange={(font) => onChange({ font })}
            options={[
              ["inter", "Inter"],
              ["segoe", "Segoe"],
              ["rounded", "Округлый"],
              ["serif", "С засечками"],
              ["mono", "Моно"],
            ]}
          />
        </Row>
        {allowAutoSize && <Toggle label="Размер по окну" hint="Текст подстраивается под размер окна" value={auto} onChange={(v) => onChange({ fontSize: v ? 0 : 48 })} />}
        {!auto && <Slider label="Размер текста" value={l.fontSize} min={12} max={110} format={(v) => `${v} px`} onChange={(fontSize) => onChange({ fontSize })} />}
        <Slider label="Жирность" value={l.fontWeight} min={350} max={900} step={10} disabled={linked} onChange={(fontWeight) => onChange({ fontWeight })} />
        <Row label="Выравнивание">
          <Segmented<"left" | "center">
            value={l.align}
            onChange={(align) => onChange({ align })}
            options={[
              ["left", "Слева"],
              ["center", "По центру"],
            ]}
          />
        </Row>
        <Slider label="Межстрочный интервал" value={l.lineSpacing} min={0.3} max={2.4} step={0.05} format={times} disabled={linked} onChange={(lineSpacing) => onChange({ lineSpacing })} />
        <Slider label="Положение активной строки" hint="Сверху вниз" value={l.anchor} min={0.12} max={0.7} step={0.01} format={pct} onChange={(anchor) => onChange({ anchor })} />
      </Section>

      <Section title="Цвет и эффекты">
        <Row label="Цвет выделения" hint="Цвет пропетых слов и свечения" disabled={linked}>
          <ColorField value={l.accent} disabled={linked} onChange={(accent) => onChange({ accent })} />
        </Row>
        <Slider label="Яркость неактивных строк" value={l.unsung} min={0.06} max={0.85} step={0.01} format={pct} disabled={linked} onChange={(unsung) => onChange({ unsung })} />
        <Slider label="Размытие соседних строк" value={l.blur} min={0} max={2.5} step={0.05} format={times} disabled={linked} onChange={(blur) => onChange({ blur })} />
        <Slider label="Свечение" value={l.glow} min={0} max={2.5} step={0.05} format={times} disabled={linked} onChange={(glow) => onChange({ glow })} />
      </Section>

      <Section title="Анимация">
        <Row label="Заливка слов" disabled={linked}>
          <Segmented<FillMode>
            value={l.fill}
            disabled={linked}
            onChange={(fill) => onChange({ fill })}
            options={[
              ["smooth", "Плавно"],
              ["word", "По словам"],
              ["line", "Строкой"],
            ]}
          />
        </Row>
        <Row label="Прокрутка" disabled={linked}>
          <Segmented<Motion>
            value={l.motion}
            disabled={linked}
            onChange={(motion) => onChange({ motion })}
            options={[
              ["soft", "Мягко"],
              ["normal", "Обычно"],
              ["snappy", "Быстро"],
            ]}
          />
        </Row>
        <Slider label="Волна" hint="Задержка между строками при прокрутке" value={l.wave} min={0} max={110} format={(v) => `${v} мс`} disabled={linked} onChange={(wave) => onChange({ wave })} />
        <Toggle label="Акценты на долгих нотах" hint="Слово подсвечивается и приподнимается по буквам" value={l.emphasis} disabled={linked} onChange={(emphasis) => onChange({ emphasis })} />
        <Toggle label="Уменьшать неактивные строки" value={l.scaleInactive} disabled={linked} onChange={(scaleInactive) => onChange({ scaleInactive })} />
      </Section>
    </>
  );
}

export function SceneEditor({ value: s, onChange, linked }: { value: SceneStyle; onChange: (p: Partial<SceneStyle>) => void; linked?: boolean }) {
  const solid = s.background === "solid";
  return (
    <Section title="Фон" hint={linked ? "Фон берётся из главного окна" : undefined}>
      <Row label="Тип фона" disabled={linked}>
        <Segmented
          value={s.background}
          disabled={linked}
          onChange={(background) => onChange({ background })}
          options={[
            ["animated", "Живая обложка"],
            ["static", "Статичная"],
            ["solid", "Цвет"],
          ]}
        />
      </Row>
      {solid && (
        <Row label="Цвет фона" disabled={linked}>
          <ColorField value={s.bgColor} allowAuto={false} allowCover={false} disabled={linked} onChange={(bgColor) => onChange({ bgColor })} />
        </Row>
      )}
      <Slider label="Яркость" value={s.bgBrightness} min={0.3} max={1.8} step={0.02} format={pct} disabled={linked} onChange={(bgBrightness) => onChange({ bgBrightness })} />
      {!solid && (
        <>
          <Slider label="Насыщенность" value={s.bgSaturation} min={0} max={2} step={0.02} format={pct} disabled={linked} onChange={(bgSaturation) => onChange({ bgSaturation })} />
          {s.background === "animated" && (
            <Slider label="Скорость движения" value={s.bgSpeed} min={0.1} max={3} step={0.05} format={times} disabled={linked} onChange={(bgSpeed) => onChange({ bgSpeed })} />
          )}
        </>
      )}
    </Section>
  );
}
