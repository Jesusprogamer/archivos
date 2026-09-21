import type { ReactNode } from 'react';
import { useId } from 'react';
import { cx } from './cx';
import styles from './controls.module.css';

export interface FieldProps {
  label: string;
  hint?: string;
  /** Lays the control out beside the label instead of under it. */
  inline?: boolean;
  children: (id: string) => ReactNode;
  className?: string;
}

/**
 * Pairs a label with its control and an optional hint, wiring the ids so the
 * label is announced and clicking it focuses the control.
 */
export function Field({ label, hint, inline = false, children, className }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className={cx(inline ? styles.fieldRow : styles.field, className)}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {hint ? (
        <p className={styles.hint} id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
