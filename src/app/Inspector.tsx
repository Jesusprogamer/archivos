import { AudioLines } from 'lucide-react';
import type { MediaItem } from '../core/media/types';
import { formatBytes, formatDuration } from '../core/util/format';
import { useLocaleStore, useT } from '../i18n';
import styles from './Inspector.module.css';
import panel from './Panel.module.css';

/**
 * What Forja knows about a file, read from the file itself.
 *
 * Every row here is measured: dimensions and duration come from the browser's
 * own decoder, the format from the magic bytes. Nothing is inferred from the
 * file name except where the row says so.
 */
export function Inspector({ item }: { item: MediaItem }) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);

  return (
    <div className={styles.inspector}>
      <div className={styles.preview}>
        {item.format.kind === 'image' ? <img src={item.url} alt={item.name} /> : null}
        {item.format.kind === 'video' ? (
          <video src={item.url} controls preload="metadata" playsInline />
        ) : null}
        {item.format.kind === 'audio' ? (
          <div className={styles.audioPreview}>
            <AudioLines size={40} aria-hidden="true" />
            <audio src={item.url} controls preload="metadata" />
          </div>
        ) : null}
      </div>

      <div className={styles.details}>
        <p className={styles.detailsTitle}>{item.name}</p>
        <dl className={panel.specs}>
          <dt>{t('file.format')}</dt>
          <dd>
            {item.format.label}{' '}
            <span style={{ color: 'var(--fg-muted)' }}>
              (
              {item.detectedBy === 'extension'
                ? t('file.detectedByExtension')
                : t('file.detectedBySignature')}
              )
            </span>
          </dd>
          <dt>{t('file.size')}</dt>
          <dd>{formatBytes(item.size, locale)}</dd>
          {item.meta?.kind === 'image' || item.meta?.kind === 'video' ? (
            <>
              <dt>{t('file.dimensions')}</dt>
              <dd>
                {item.meta.width} × {item.meta.height}
              </dd>
            </>
          ) : null}
          {item.meta && item.meta.kind !== 'image' ? (
            <>
              <dt>{t('file.duration')}</dt>
              <dd>{formatDuration(item.meta.duration)}</dd>
            </>
          ) : null}
          {item.meta?.kind === 'video' ? (
            <>
              <dt>{t('file.hasAudio')}</dt>
              <dd>{item.meta.hasAudio ? t('common.yes') : t('common.no')}</dd>
            </>
          ) : null}
        </dl>
      </div>
    </div>
  );
}
