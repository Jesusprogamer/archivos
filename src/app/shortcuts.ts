import type { TranslationKey } from '../i18n';

export interface Shortcut {
  readonly keys: readonly string[];
  readonly labelKey: TranslationKey;
}

export interface ShortcutGroup {
  readonly titleKey: TranslationKey;
  readonly shortcuts: readonly Shortcut[];
}

/**
 * The single source of truth for shortcuts: the help dialog renders this list,
 * so a shortcut that is not implemented cannot be advertised by accident.
 */
export const GLOBAL_SHORTCUTS: ShortcutGroup = {
  titleKey: 'help.global',
  shortcuts: [
    { keys: ['?'], labelKey: 'help.shortcut.help' },
    { keys: ['Mod', 'O'], labelKey: 'help.shortcut.open' },
    { keys: ['Mod', 'B'], labelKey: 'help.shortcut.library' },
    { keys: ['Esc'], labelKey: 'help.shortcut.escape' },
  ],
};

export function shortcutGroups(): readonly ShortcutGroup[] {
  return [GLOBAL_SHORTCUTS];
}
