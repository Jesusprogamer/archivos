import { cx } from './cx';
import styles from './controls.module.css';

export interface SliderProps {
  id?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** Shows an editable numeric box next to the track. */
  showNumber?: boolean;
  /** Rendered after the number, e.g. `%` or `px`. */
  suffix?: string;
  disabled?: boolean;
  'aria-label'?: string;
  className?: string;
}

/**
 * A range input whose filled portion is drawn with a CSS custom property, so
 * the track reflects the value without a second element to keep in sync.
 */
export function Slider({
  id,
  value,
  min,
  max,
  step = 1,
  onChange,
  showNumber = true,
  suffix,
  disabled = false,
  className,
  ...aria
}: SliderProps) {
  const fill = max === min ? 0 : ((value - min) / (max - min)) * 100;
  const decimals = step < 1 ? String(step).split('.')[1]?.length ?? 2 : 0;

  return (
    <div className={cx(styles.sliderRow, className)}>
      <input
        id={id}
        className={styles.slider}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={{ '--fill': `${fill}%` } as React.CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
        {...aria}
      />
      {showNumber ? (
        <input
          className={cx(styles.input, styles.number)}
          type="number"
          min={min}
          max={max}
          step={step}
          value={Number(value.toFixed(decimals))}
          disabled={disabled}
          aria-label={aria['aria-label']}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
          }}
        />
      ) : null}
      {suffix ? <span className={styles.hint}>{suffix}</span> : null}
    </div>
  );
}
