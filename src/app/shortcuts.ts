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

/** Only listed while the audio editor is open, because that is where they work. */
export const AUDIO_SHORTCUTS: ShortcutGroup = {
  titleKey: 'workspace.audio',
  shortcuts: [
    { keys: ['Space'], labelKey: 'audio.play' },
    { keys: ['Mod', 'A'], labelKey: 'audio.selectAll' },
    { keys: ['Mod', 'X'], labelKey: 'audio.cut' },
    { keys: ['Mod', 'C'], labelKey: 'audio.copy' },
    { keys: ['Mod', 'V'], labelKey: 'audio.paste' },
    { keys: ['Supr'], labelKey: 'audio.delete' },
  ],
};

/** Only listed while the video editor is open, because that is where they work. */
export const VIDEO_SHORTCUTS: ShortcutGroup = {
  titleKey: 'workspace.video',
  shortcuts: [
    { keys: ['Space'], labelKey: 'audio.play' },
    { keys: ['S'], labelKey: 'video.split' },
    { keys: ['Mod', 'D'], labelKey: 'video.duplicate' },
    { keys: ['Supr'], labelKey: 'video.delete' },
    { keys: ['Mod', 'Z'], labelKey: 'common.undo' },
  ],
};

export function shortcutGroups(workspace?: string): readonly ShortcutGroup[] {
  if (workspace === 'audio') return [GLOBAL_SHORTCUTS, AUDIO_SHORTCUTS];
  if (workspace === 'video') return [GLOBAL_SHORTCUTS, VIDEO_SHORTCUTS];
  return [GLOBAL_SHORTCUTS];
}
