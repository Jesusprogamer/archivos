import { useT } from '../i18n';
import { Dialog } from '../ui/Dialog';
import { modifierLabel } from './useFileDrop';
import { shortcutGroups } from './shortcuts';
import panel from './Panel.module.css';

export function Help({
  open,
  onClose,
  workspace,
}: {
  open: boolean;
  onClose: () => void;
  workspace?: string | undefined;
}) {
  const t = useT();
  const mod = modifierLabel();

  return (
    <Dialog open={open} onClose={onClose} title={t('help.title')} width={520}>
      {shortcutGroups(workspace).map((group) => (
        <section key={group.titleKey}>
          <h3 className={panel.sectionTitle}>{t(group.titleKey)}</h3>
          <dl className={panel.shortcuts}>
            {group.shortcuts.map((shortcut) => (
              <div key={shortcut.labelKey} style={{ display: 'contents' }}>
                <dt>{t(shortcut.labelKey)}</dt>
                <dd>
                  {shortcut.keys.map((key) => (
                    <kbd key={key} className={panel.key}>
                      {key === 'Mod' ? mod : key}
                    </kbd>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </Dialog>
  );
}
