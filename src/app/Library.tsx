import { AudioLines, Film, Image as ImageIcon, PanelLeftClose, Trash2 } from 'lucide-react';
import { useLibrary } from '../core/media/library';
import type { MediaItem } from '../core/media/types';
import { formatBytes, formatDuration } from '../core/util/format';
import { useLocaleStore, useT } from '../i18n';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { cx } from '../ui/cx';
import { FilePickerButton } from './Home';
import { RejectedFiles } from './RejectedFiles';
import styles from './Library.module.css';

const KIND_ICON = { image: ImageIcon, audio: AudioLines, video: Film } as const;

function Thumb({ item }: { item: MediaItem }) {
  const Icon = KIND_ICON[item.format.kind];
  if (item.format.kind === 'image') {
    return (
      <span className={styles.thumb}>
        <img src={item.url} alt="" loading="lazy" decoding="async" />
      </span>
    );
  }
  if (item.format.kind === 'video') {
    return (
      <span className={styles.thumb}>
        {/* A media fragment nudges the browser past the first (often black)
            frame, so the thumbnail shows something recognisable. */}
        <video src={`${item.url}#t=0.2`} preload="metadata" muted playsInline aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className={styles.thumb}>
      <Icon size={16} aria-hidden="true" />
    </span>
  );
}

function ItemMeta({ item }: { item: MediaItem }) {
  const locale = useLocaleStore((state) => state.locale);
  const parts: string[] = [formatBytes(item.size, locale)];
  if (item.meta?.kind === 'image') parts.push(`${item.meta.width}×${item.meta.height}`);
  if (item.meta?.kind === 'video') parts.push(`${item.meta.width}×${item.meta.height}`);
  if (item.meta && item.meta.kind !== 'image') parts.push(formatDuration(item.meta.duration));
  return (
    <span className={styles.itemMeta}>
      <span className={styles.badge}>{item.format.label}</span>
      <span>{parts.join(' · ')}</span>
    </span>
  );
}

export function Library({ collapsed, onCollapse }: { collapsed: boolean; onCollapse: () => void }) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const items = useLibrary((state) => state.items);
  const activeId = useLibrary((state) => state.activeId);
  const setActive = useLibrary((state) => state.setActive);
  const remove = useLibrary((state) => state.remove);
  const addFiles = useLibrary((state) => state.addFiles);

  const totalBytes = items.reduce((sum, item) => sum + item.size, 0);

  return (
    <aside className={cx(styles.panel, collapsed && styles.collapsed)} aria-label={t('library.title')}>
      <div className={styles.head}>
        <h2 className={styles.title}>{t('library.title')}</h2>
        <FilePickerButton onFiles={(files) => void addFiles(files)} />
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label={t('help.shortcut.library')}
          onClick={onCollapse}
        >
          <PanelLeftClose size={15} aria-hidden="true" />
        </Button>
      </div>

      <div className={styles.rejected}>
        <RejectedFiles />
      </div>

      {items.length === 0 ? (
        <EmptyState title={t('library.empty')} body={t('library.emptyHint')} />
      ) : (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.id} className={styles.row}>
              {/* Selection and removal are siblings, never nested: a button
                  inside a button is unreachable by keyboard and ambiguous to
                  assistive technology. */}
              <button
                type="button"
                className={cx(styles.item, item.id === activeId && styles.itemActive)}
                aria-current={item.id === activeId}
                onClick={() => setActive(item.id)}
              >
                <Thumb item={item} />
                <span className={styles.itemBody}>
                  <span className={styles.itemName} title={item.name}>
                    {item.name}
                  </span>
                  <ItemMeta item={item} />
                </span>
              </button>
              <Button
                className={styles.itemRemove}
                variant="ghost"
                size="sm"
                iconOnly
                aria-label={t('library.removeConfirm', { name: item.name })}
                onClick={() => remove(item.id)}
              >
                <Trash2 size={14} aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 ? (
        <div className={styles.foot}>
          <span>
            {items.length === 1
              ? t('library.count', { n: items.length })
              : t('library.countPlural', { n: items.length })}
          </span>
          <span>{formatBytes(totalBytes, locale)}</span>
        </div>
      ) : null}
    </aside>
  );
}
