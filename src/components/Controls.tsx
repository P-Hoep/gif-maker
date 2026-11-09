import type { CSSProperties, ReactNode } from "react";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

interface SegmentedProps<T extends string> {
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  label: string;
  compact?: boolean;
  disabled?: boolean;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  compact = false,
  disabled = false,
}: SegmentedProps<T>) {
  return (
    <div
      className={`segmented${compact ? " segmented--compact" : ""}`}
      role="radiogroup"
      aria-label={label}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={`segment${value === option.value ? " is-active" : ""}`}
          onClick={() => onChange(option.value)}
          disabled={disabled}
        >
          {option.icon}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  help?: string;
  disabled?: boolean;
}

export function Switch({ checked, onChange, label, help, disabled = false }: SwitchProps) {
  return (
    <div className={`switch-row${disabled ? " is-disabled" : ""}`}>
      <div className="switch-copy">
        <span className="field-label">{label}</span>
        {help && <span className="field-help">{help}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`switch${checked ? " is-on" : ""}`}
        onClick={() => onChange(!checked)}
        disabled={disabled}
      >
        <span className="switch-knob" />
      </button>
    </div>
  );
}

interface SliderFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
  help?: string;
}

export function SliderField({
  label,
  value,
  min,
  max,
  step,
  unit = "",
  onChange,
  help,
}: SliderFieldProps) {
  const progress = ((value - min) / (max - min)) * 100;
  return (
    <div className="slider-field">
      <div className="slider-heading">
        <span className="field-label">{label}</span>
        <span className="value-pill">
          {value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        className="range-input"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ "--range-progress": `${progress}%` } as CSSProperties}
      />
      {help && <span className="field-help">{help}</span>}
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string;
  title?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <span className="section-eyebrow">{eyebrow}</span>
        {title && <h2>{title}</h2>}
      </div>
      {action}
    </div>
  );
}
