import { create } from 'zustand';
import { createId } from '../core/util/id';

export type ToastTone = 'info' | 'success' | 'error' | 'warning';

export interface Toast {
  readonly id: string;
  readonly tone: ToastTone;
  readonly title: string;
  readonly text?: string;
  /** An optional thing to do about it, shown as a button inside the toast. */
  readonly action?: { readonly label: string; readonly onClick: () => void };
  /** Milliseconds before it disappears; errors stay until dismissed. */
  readonly duration: number;
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id' | 'duration'> & { duration?: number }) => string;
  dismiss: (id: string) => void;
}

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: ({ duration, ...toast }) => {
    const id = createId('toast');
    const ms = duration ?? (toast.tone === 'error' ? 0 : 5000);
    set((state) => ({ toasts: [...state.toasts, { ...toast, id, duration: ms }] }));
    if (ms > 0) {
      setTimeout(() => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })), ms);
    }
    return id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

/** Convenience for non-React code (workers, engines) to surface a message. */
export const toast = {
  info: (title: string, text?: string) => useToasts.getState().push({ tone: 'info', title, ...(text ? { text } : {}) }),
  success: (title: string, text?: string) => useToasts.getState().push({ tone: 'success', title, ...(text ? { text } : {}) }),
  warning: (title: string, text?: string) => useToasts.getState().push({ tone: 'warning', title, ...(text ? { text } : {}) }),
  error: (title: string, text?: string) => useToasts.getState().push({ tone: 'error', title, ...(text ? { text } : {}) }),
};
