import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './app/ErrorBoundary';
import { startTheme } from './app/theme';
import { useLocaleStore } from './i18n';
import './styles/base.css';

startTheme();
document.documentElement.lang = useLocaleStore.getState().locale;

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root');

// createRoot clears the container, which removes the static "serve this over
// HTTP" fallback that index.html paints when the bundle never runs.
createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
