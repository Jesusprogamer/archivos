import { create } from 'zustand';
import { es, type Dictionary, type TranslationKey } from './es';
import { en } from './en';

export type Locale = 'es' | 'en';

const DICTIONARIES: Record<Locale, Dictionary> = { es, en };
const STORAGE_KEY = 'forja.locale';

export const LOCALES: ReadonlyArray<{ value: Locale; label: string }> = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' },
];

function readStoredLocale(): Locale {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'es' || stored === 'en') return stored;
  }
  // Spanish is the default; only a clearly English browser flips it.
  if (typeof navigator !== 'undefined' && navigator.language.startsWith('en')) return 'en';
  return 'es';
}

export type Vars = Record<string, string | number>;

/** Replaces `{name}` placeholders. Unknown placeholders are left untouched. */
function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: readStoredLocale(),
  setLocale: (locale) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, locale);
    if (typeof document !== 'undefined') document.documentElement.lang = locale;
    set({ locale });
  },
}));

export type Translate = (key: TranslationKey, vars?: Vars) => string;

export function translateWith(locale: Locale): Translate {
  const dictionary = DICTIONARIES[locale];
  return (key, vars) => interpolate(dictionary[key], vars);
}

/** The hook every component uses. Re-renders when the locale changes. */
export function useT(): Translate {
  const locale = useLocaleStore((state) => state.locale);
  return translateWith(locale);
}

/**
 * Pluralisation, deliberately minimal: Spanish and English share the
 * one/other split, so a full CLDR plural engine would be dead weight.
 */
export function usePlural(): (
  one: TranslationKey,
  other: TranslationKey,
  count: number,
  vars?: Vars,
) => string {
  const t = useT();
  return (one, other, count, vars) => t(count === 1 ? one : other, { ...vars, n: count });
}

export type { TranslationKey };
