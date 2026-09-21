import { create } from 'zustand';

export type ThemePreference = 'dark' | 'light' | 'system';

const STORAGE_KEY = 'forja.theme';

function readStored(): ThemePreference {
  if (typeof localStorage === 'undefined') return 'dark';
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'dark';
}

function resolve(preference: ThemePreference): 'dark' | 'light' {
  if (preference !== 'system') return preference;
  if (typeof matchMedia === 'undefined') return 'dark';
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function apply(preference: ThemePreference): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset['theme'] = resolve(preference);
}

interface ThemeState {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

export const useTheme = create<ThemeState>((set) => ({
  preference: readStored(),
  setPreference: (preference) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, preference);
    apply(preference);
    set({ preference });
  },
}));

/** Applies the stored preference and keeps `system` in step with the OS. */
export function startTheme(): () => void {
  apply(useTheme.getState().preference);
  if (typeof matchMedia === 'undefined') return () => {};
  const query = matchMedia('(prefers-color-scheme: light)');
  const onChange = () => {
    if (useTheme.getState().preference === 'system') apply('system');
  };
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
