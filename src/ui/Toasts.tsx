import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useT } from '../i18n';
import { cx } from './cx';
import styles from './feedback.module.css';
import { useToasts, type ToastTone } from './toast';

const ICONS = { info: Info, success: CheckCircle2, error: XCircle, warning: AlertTriangle } as const;
const TONE_CLASS: Record<ToastTone, string> = {
  info: styles.toastInfo!,
  success: styles.toastSuccess!,
  error: styles.toastError!,
  warning: styles.toastWarning!,
};

export function Toasts() {
  const t = useT();
  const toasts = useToasts((state) => state.toasts);
  const dismiss = useToasts((state) => state.dismiss);

  return (
    <div className={styles.toastRegion} role="region" aria-live="polite" aria-label={t('common.more')}>
      {toasts.map((toast) => {
        const Icon = ICONS[toast.tone];
        return (
          <div key={toast.id} className={cx(styles.toast, TONE_CLASS[toast.tone])} role="status">
            <Icon size={16} aria-hidden="true" style={{ marginTop: 2, flex: 'none' }} />
            <div className={styles.toastBody}>
              <p className={styles.toastTitle}>{toast.title}</p>
              {toast.text ? <p className={styles.toastText}>{toast.text}</p> : null}
            </div>
            <button type="button" onClick={() => dismiss(toast.id)} aria-label={t('common.close')}>
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
