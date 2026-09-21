import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from './cx';
import styles from './feedback.module.css';

export type NoticeTone = 'info' | 'warning' | 'error' | 'success';

const ICONS = {
  info: Info,
  warning: AlertTriangle,
  error: XCircle,
  success: CheckCircle2,
} as const;

const TONE_CLASS = {
  info: styles.noticeInfo,
  warning: styles.noticeWarning,
  error: styles.noticeError,
  success: styles.noticeSuccess,
} as const;

/** An inline explanation attached to the thing it is about. */
export function Notice({
  tone = 'info',
  children,
  className,
}: {
  tone?: NoticeTone;
  children: ReactNode;
  className?: string;
}) {
  const Icon = ICONS[tone];
  return (
    <div className={cx(styles.notice, TONE_CLASS[tone], className)} role={tone === 'error' ? 'alert' : undefined}>
      <Icon className={styles.noticeIcon} size={15} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}
