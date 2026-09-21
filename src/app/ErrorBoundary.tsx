import { Component, type CSSProperties, type ErrorInfo, type ReactNode } from 'react';

/**
 * Deliberately self-contained: no i18n, no CSS modules, no icon library.
 * Anything this boundary imports is something that could itself be the
 * crash it has to report, and a black page with no message is exactly the
 * failure mode this exists to prevent. Colours fall back to literals so the
 * message is readable even if the stylesheet never loaded.
 */

interface Copy {
  title: string;
  body: string;
  detail: string;
  reload: string;
  reset: string;
  resetHint: string;
}

const COPY: Record<'es' | 'en', Copy> = {
  es: {
    title: 'Forja se ha roto',
    body: 'Algo ha fallado al dibujar la interfaz. Tus archivos siguen en tu dispositivo: nunca se enviaron a ningún sitio.',
    detail: 'Detalle técnico',
    reload: 'Recargar la página',
    reset: 'Borrar datos locales y recargar',
    resetHint:
      'Si recargar no arregla nada, esto descarta ajustes y proyectos guardados en este navegador.',
  },
  en: {
    title: 'Forja broke',
    body: 'Something failed while drawing the interface. Your files are still on your device: they were never sent anywhere.',
    detail: 'Technical detail',
    reload: 'Reload the page',
    reset: 'Clear local data and reload',
    resetHint:
      'If reloading does not help, this discards settings and projects saved in this browser.',
  },
};

function copy(): Copy {
  const lang = typeof document !== 'undefined' ? document.documentElement.lang : 'es';
  return lang.startsWith('en') ? COPY.en : COPY.es;
}

async function clearLocalData(): Promise<void> {
  try {
    localStorage.clear();
  } catch {
    // Private mode or blocked storage: nothing to clear.
  }
  try {
    const databases = await indexedDB.databases?.();
    for (const database of databases ?? []) {
      if (database.name) indexedDB.deleteDatabase(database.name);
    }
  } catch {
    // Firefox before 126 has no databases(); the reload alone will have to do.
  }
  location.reload();
}

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  stack: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, stack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The console is where a user can copy this from; we have no server to send it to.
    console.error('[forja] render crash', error, info.componentStack);
    this.setState({ stack: info.componentStack ?? null });
  }

  override render(): ReactNode {
    const { error, stack } = this.state;
    if (!error) return this.props.children;

    const text = copy();
    const detail = [error.stack ?? `${error.name}: ${error.message}`, stack]
      .filter(Boolean)
      .join('\n');

    return (
      <div role="alert" style={SHELL}>
        <div style={CARD}>
          <h1 style={TITLE}>{text.title}</h1>
          <p style={BODY}>{text.body}</p>
          <div style={ACTIONS}>
            <button type="button" style={PRIMARY} onClick={() => location.reload()}>
              {text.reload}
            </button>
            <button type="button" style={SECONDARY} onClick={() => void clearLocalData()}>
              {text.reset}
            </button>
          </div>
          <p style={HINT}>{text.resetHint}</p>
          <details style={DETAILS}>
            <summary style={SUMMARY}>{text.detail}</summary>
            <pre style={PRE}>{detail}</pre>
          </details>
        </div>
      </div>
    );
  }
}

const SHELL: CSSProperties = {
  minHeight: '100%',
  display: 'grid',
  placeItems: 'center',
  padding: '24px',
  background: 'var(--bg-canvas, #0a0c0f)',
  color: 'var(--fg, #e9edf3)',
  fontFamily: 'var(--font-ui, system-ui, sans-serif)',
};

const CARD: CSSProperties = {
  width: 'min(560px, 100%)',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  padding: '24px',
  borderRadius: 'var(--r-lg, 12px)',
  border: '1px solid var(--border, #2b323c)',
  background: 'var(--bg-raised, #1a1f26)',
};

const TITLE: CSSProperties = { fontSize: '20px', fontWeight: 600, margin: 0 };
const BODY: CSSProperties = { color: 'var(--fg-secondary, #a7b1bf)', margin: 0 };
const ACTIONS: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '4px' };
const HINT: CSSProperties = { fontSize: '13px', color: 'var(--fg-muted, #858d9b)', margin: 0 };

const BUTTON: CSSProperties = {
  padding: '8px 14px',
  borderRadius: 'var(--r-md, 8px)',
  fontSize: '14px',
  fontWeight: 500,
  cursor: 'pointer',
};

const PRIMARY: CSSProperties = {
  ...BUTTON,
  border: '1px solid var(--accent, #ff7a2f)',
  background: 'var(--accent, #ff7a2f)',
  color: 'var(--fg-onaccent, #1c0c01)',
};

const SECONDARY: CSSProperties = {
  ...BUTTON,
  border: '1px solid var(--border, #2b323c)',
  background: 'transparent',
  color: 'inherit',
};

const DETAILS: CSSProperties = { marginTop: '4px' };
const SUMMARY: CSSProperties = {
  cursor: 'pointer',
  fontSize: '13px',
  color: 'var(--fg-muted, #858d9b)',
};

const PRE: CSSProperties = {
  marginTop: '8px',
  maxHeight: '240px',
  overflow: 'auto',
  padding: '12px',
  borderRadius: 'var(--r-md, 8px)',
  background: 'var(--bg-sunken, #0e1116)',
  border: '1px solid var(--border-subtle, #1d222b)',
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  fontSize: '12px',
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};
