import { cx } from './cx';
import styles from './feedback.module.css';

export interface ProgressProps {
  /** 0–1, or `undefined` when the work cannot report progress. */
  value?: number;
  label?: string;
  /** Free text on the right, typically the time remaining. */
  detail?: string;
}

export function Progress({ value, label, detail }: ProgressProps) {
  const indeterminate = value === undefined || !Number.isFinite(value);
  const pct = indeterminate ? 0 : Math.round(Math.max(0, Math.min(1, value)) * 100);

  return (
    <div className={styles.progress}>
      {label || detail ? (
        <div className={styles.progressHead}>
          <span className={styles.progressLabel}>{label}</span>
          <span className={styles.progressValue}>{detail ?? (indeterminate ? '' : `${pct} %`)}</span>
        </div>
      ) : null}
      <div
        className={styles.track}
        role="progressbar"
        aria-label={label}
        {...(indeterminate ? {} : { 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 })}
      >
        <div
          className={cx(styles.bar, indeterminate && styles.indeterminate)}
          style={{ width: indeterminate ? undefined : `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cx(styles.spinner, className)}
      style={{ width: size, height: size, borderWidth: Math.max(2, Math.round(size / 8)) }}
      role="status"
      aria-live="polite"
    />
  );
}
