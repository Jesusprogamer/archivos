import { useLibrary } from '../core/media/library';
import { supportedFormatsByKind, type MediaKind } from '../core/detect/formats';
import type { RejectedFile } from '../core/media/types';
import { useT, type TranslationKey } from '../i18n';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import styles from './RejectedFiles.module.css';

const KIND_LABEL: Record<MediaKind, TranslationKey> = {
  image: 'file.image',
  audio: 'file.audio',
  video: 'file.video',
};

/** The list the brief asks for: if we refuse a file, say what we do accept. */
function SupportedFormats() {
  const t = useT();
  return (
    <div className={styles.supported}>
      <p className={styles.supportedTitle}>{t('file.supportedList')}</p>
      {(['image', 'audio', 'video'] as const).map((kind) => (
        <p key={kind} className={styles.supportedRow}>
          <span className={styles.supportedKind}>{t(KIND_LABEL[kind])}</span>
          <span>
            {supportedFormatsByKind(kind)
              .flatMap((format) => format.extensions)
              .map((extension) => `.${extension}`)
              .join(' ')}
          </span>
        </p>
      ))}
    </div>
  );
}

function RejectedNotice({ file, onDismiss }: { file: RejectedFile; onDismiss: () => void }) {
  const t = useT();
  const recognised = file.reason === 'noBrowserDecoder' && file.format;

  return (
    <Notice tone="warning">
      <strong>{recognised ? file.format?.label : t('file.unsupported')}</strong>
      <p className={styles.body}>
        {recognised
          ? t('file.noDecoder', { name: file.name, format: file.format?.label ?? '' })
          : t('file.unsupportedDetail', { name: file.name })}
      </p>
      {recognised ? null : <SupportedFormats />}
      <Button variant="ghost" size="sm" onClick={onDismiss} className={styles.dismiss}>
        {t('common.close')}
      </Button>
    </Notice>
  );
}

/** Rejected files, shown wherever the user happens to be when they drop one. */
export function RejectedFiles() {
  const rejected = useLibrary((state) => state.rejected);
  const dismiss = useLibrary((state) => state.dismissRejected);
  if (rejected.length === 0) return null;
  return (
    <div className={styles.stack}>
      {rejected.map((file) => (
        <RejectedNotice key={file.id} file={file} onDismiss={() => dismiss(file.id)} />
      ))}
    </div>
  );
}
