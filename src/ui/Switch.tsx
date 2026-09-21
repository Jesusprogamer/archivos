import { cx } from './cx';
import styles from './controls.module.css';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  /** Hides the visible text but keeps it for screen readers. */
  hideLabel?: boolean;
}

/**
 * A real checkbox with `role="switch"`, hidden visually but left in the tab
 * order. The track next to it is painted from the input's `:checked` and
 * `:focus-visible` states, so keyboard focus is visible without extra script.
 */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  hideLabel = false,
}: SwitchProps) {
  return (
    <label className={styles.switch}>
      <input
        className={cx(styles.switchInput, 'sr-only')}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={styles.switchTrack} aria-hidden="true" />
      <span className={hideLabel ? 'sr-only' : styles.label}>{label}</span>
    </label>
  );
}
