import { HelpCircle, PanelLeftOpen, Settings as SettingsIcon, UploadCloud } from 'lucide-react';
import { Suspense, useState } from 'react';
import { useLibrary } from '../core/media/library';
import type { MediaItem } from '../core/media/types';
import { workspacesFor, type WorkspaceId } from '../core/registry/workspaces';
import { useT } from '../i18n';
import { Button } from '../ui/Button';
import { InstallButton } from '../pwa/InstallButton';
import { EmptyState } from '../ui/EmptyState';
import { Spinner } from '../ui/Progress';
import { cx } from '../ui/cx';
import { Inspector } from './Inspector';
import { Library } from './Library';
import { Wordmark } from './Wordmark';
import styles from './Studio.module.css';
import { WORKSPACE_VIEWS } from './workspaceViews';

export interface StudioProps {
  item: MediaItem;
  dragging: boolean;
  onFiles: (files: File[]) => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  libraryCollapsed: boolean;
  onToggleLibrary: () => void;
}

export function Studio({
  item,
  dragging,
  onFiles,
  onOpenSettings,
  onOpenHelp,
  libraryCollapsed,
  onToggleLibrary,
}: StudioProps) {
  const t = useT();
  const workspace = useLibrary((state) => state.workspace);
  const setWorkspace = useLibrary((state) => state.setWorkspace);
  const [fileInput, setFileInput] = useState<HTMLInputElement | null>(null);

  // Only workspaces that exist are offered — an unimplemented tab would be a
  // promise the app cannot keep.
  const available = workspacesFor(item.format).filter((w) => w.id in WORKSPACE_VIEWS);
  const current: WorkspaceId | undefined =
    workspace && available.some((w) => w.id === workspace) ? workspace : available[0]?.id;
  const View = current ? WORKSPACE_VIEWS[current] : undefined;

  return (
    <div className={styles.studio}>
      <header className={styles.topbar} aria-label={t('a11y.mainToolbar')}>
        <span className={styles.brand}>
          <Wordmark size={18} showText={false} />
        </span>
        {libraryCollapsed ? (
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={t('help.shortcut.library')}
            onClick={onToggleLibrary}
          >
            <PanelLeftOpen size={15} aria-hidden="true" />
          </Button>
        ) : null}
        <span className={styles.divider} aria-hidden="true" />

        <nav className={styles.tabs} aria-label={t('a11y.workspaceTabs')}>
          {available.map((definition) => (
            <button
              key={definition.id}
              type="button"
              className={cx(styles.tab, definition.id === current && styles.tabActive)}
              aria-current={definition.id === current ? 'page' : undefined}
              onClick={() => setWorkspace(definition.id)}
            >
              {t(definition.labelKey)}
            </button>
          ))}
        </nav>

        <span className={styles.spacer} />
        <span className={styles.fileName} title={item.name}>
          {item.name}
        </span>

        <span className={styles.topActions}>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={t('library.add')}
            onClick={() => fileInput?.click()}
          >
            <UploadCloud size={15} aria-hidden="true" />
          </Button>
          <InstallButton iconOnly />
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={t('common.help')}
            onClick={onOpenHelp}
          >
            <HelpCircle size={15} aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={t('common.settings')}
            onClick={onOpenSettings}
          >
            <SettingsIcon size={15} aria-hidden="true" />
          </Button>
        </span>
        <input
          ref={setFileInput}
          type="file"
          multiple
          className="file-trigger"
          tabIndex={-1}
          aria-label={t('a11y.fileInput')}
          onChange={(event) => {
            onFiles([...(event.target.files ?? [])]);
            event.target.value = '';
          }}
        />
      </header>

      <div className={styles.body}>
        <Library collapsed={libraryCollapsed} onCollapse={onToggleLibrary} />
        <main className={styles.main} id="main">
          {View ? (
            // Each workspace is a separate chunk, so a spinner covers the few
            // hundred milliseconds it takes to arrive the first time.
            <Suspense
              fallback={<EmptyState icon={<Spinner size={26} />} title={t('common.loading')} />}
            >
              <View item={item} />
            </Suspense>
          ) : (
            // No editor exists for this file yet; show what we actually know
            // about it rather than an empty frame.
            <Inspector item={item} />
          )}
        </main>
      </div>

      {dragging ? (
        <div className={styles.dropOverlay}>
          <div className={styles.dropOverlayInner}>
            <UploadCloud size={32} aria-hidden="true" />
            {t('home.dropActive')}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export { EmptyState };
