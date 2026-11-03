import { useId, type ReactNode } from "react";

export function Section({ title, hint, children, aside }: { title: string; hint?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="st-section">
      <div className="st-section-head">
        <div>
          <h3>{title}</h3>
          {hint && <p>{hint}</p>}
        </div>
        {aside}
      </div>
      <div className="st-card">{children}</div>
    </section>
  );
}

export function Row({ label, hint, children, disabled }: { label: string; hint?: string; children: ReactNode; disabled?: boolean }) {
  return (
    <div className={`st-row ${disabled ? "is-disabled" : ""}`}>
      <div className="st-row-label">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="st-row-control">{children}</div>
    </div>
  );
}

export function Switch({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button className={`switch ${value ? "is-on" : ""}`} role="switch" aria-checked={value} disabled={disabled} onClick={() => onChange(!value)}>
      <span className="switch-knob" />
    </button>
  );
}

export function Toggle({
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
    <Row label={label} hint={hint} disabled={disabled}>
      <Switch value={value} onChange={onChange} disabled={disabled} />
    </Row>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  const idx = Math.max(0, options.findIndex(([v]) => v === value));
  return (
    <div className={`segmented ${disabled ? "is-disabled" : ""}`} style={{ ["--n" as string]: options.length, ["--i" as string]: idx }}>
      <span className="segmented-thumb" />
      {options.map(([v, label]) => (
        <button key={String(v)} className={v === value ? "is-on" : ""} disabled={disabled} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function Slider({
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  format = (v) => String(v),
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div className={`st-slider ${disabled ? "is-disabled" : ""}`}>
      <label htmlFor={id} className="st-row-label">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </label>
      <div className="st-slider-control">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          style={{ ["--fill" as string]: `${Math.min(100, Math.max(0, fill))}%` }}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="st-slider-value">{format(value)}</span>
      </div>
    </div>
  );
}

const SWATCHES = ["#ffffff", "#ff6b8b", "#ff9f5a", "#ffd65a", "#7cf29c", "#4fd8ff", "#7d8bff", "#c77dff", "#ff7ad9"];

/** Accent picker: automatic, from the cover, presets, or any custom color. */
export function ColorField({
  value,
  onChange,
  allowAuto = true,
  allowCover = true,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  allowAuto?: boolean;
  allowCover?: boolean;
  disabled?: boolean;
}) {
  const custom = value.startsWith("#") && !SWATCHES.includes(value.toLowerCase());
  return (
    <div className={`st-colors ${disabled ? "is-disabled" : ""}`}>
      {allowAuto && (
        <button className={`st-chip ${value === "auto" ? "is-on" : ""}`} disabled={disabled} onClick={() => onChange("auto")}>
          Авто
        </button>
      )}
      {allowCover && (
        <button className={`st-chip st-chip-cover ${value === "cover" ? "is-on" : ""}`} disabled={disabled} onClick={() => onChange("cover")}>
          Из обложки
        </button>
      )}
      {SWATCHES.map((c) => (
        <button
          key={c}
          className={`st-swatch ${value.toLowerCase() === c ? "is-on" : ""}`}
          style={{ background: c }}
          disabled={disabled}
          aria-label={c}
          onClick={() => onChange(c)}
        />
      ))}
      <label className={`st-swatch st-swatch-custom ${custom ? "is-on" : ""}`} style={custom ? { background: value } : undefined} title="Свой цвет">
        <input type="color" disabled={disabled} value={value.startsWith("#") ? value : "#ffffff"} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
}

export function ActionButton({
  children,
  onClick,
  primary,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button className={`ed-btn ${primary ? "ed-btn-primary" : "ed-btn-ghost"}`} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}
