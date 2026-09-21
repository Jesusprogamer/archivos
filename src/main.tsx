import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startTheme } from './app/theme';
import { useLocaleStore } from './i18n';
import './styles/base.css';

startTheme();
document.documentElement.lang = useLocaleStore.getState().locale;

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
