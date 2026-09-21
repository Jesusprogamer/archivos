import type { ReactNode } from 'react';
import { cx } from './cx';
import styles from './controls.module.css';

export interface Segment<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  title?: string;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  segments: ReadonlyArray<Segment<T>>;
  onChange: (value: T) => void;
  label: string;
  block?: boolean;
  /** Shows icons only, with the label as the accessible name. */
  compact?: boolean;
}

export function SegmentedControl<T extends string>({
  value,
  segments,
  onChange,
  label,
  block = false,
  compact = false,
}: SegmentedControlProps<T>) {
  return (
    <div className={cx(styles.segmented, block && styles.segmentBlock)} role="group" aria-label={label}>
      {segments.map((segment) => (
        <button
          key={segment.value}
          type="button"
          className={styles.segment}
          aria-pressed={segment.value === value}
          title={segment.title ?? segment.label}
          {...(compact ? { 'aria-label': segment.label } : {})}
          onClick={() => onChange(segment.value)}
        >
          {segment.icon}
          {compact ? null : segment.label}
        </button>
      ))}
    </div>
  );
}
