import {
  AudioLines,
  Film,
  Image as ImageIcon,
  Repeat,
  ShieldCheck,
  Sparkles,
  UploadCloud,
} from 'lucide-react';
import { useRef } from 'react';
import { useT, type TranslationKey } from '../i18n';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Progress';
import { cx } from '../ui/cx';
import styles from './Home.module.css';
import { Wordmark } from './Wordmark';
import { RejectedFiles } from './RejectedFiles';
import { modifierLabel } from './useFileDrop';

const CAPABILITIES: ReadonlyArray<{
  icon: typeof Repeat;
  title: TranslationKey;
  desc: TranslationKey;
}> = [
  { icon: Repeat, title: 'home.capability.convert', desc: 'home.capability.convertDesc' },
  { icon: ImageIcon, title: 'home.capability.image', desc: 'home.capability.imageDesc' },
  { icon: AudioLines, title: 'home.capability.audio', desc: 'home.capability.audioDesc' },
  { icon: Film, title: 'home.capability.video', desc: 'home.capability.videoDesc' },
  { icon: Sparkles, title: 'home.capability.visualizer', desc: 'home.capability.visualizerDesc' },
];

export interface HomeProps {
  dragging: boolean;
  busy: boolean;
  onFiles: (files: File[]) => void;
  actions: React.ReactNode;
}

export function Home({ dragging, busy, onFiles, actions }: HomeProps) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const hint = t('home.dropHint', { shortcut: '\u0000' }).split('\u0000');

  return (
    <div className={styles.home}>
      <div className={styles.topline}>
        <Wordmark />
        {actions}
      </div>

      <main className={styles.center} id="main">
        <div>
          <h1 className={styles.headline}>{t('app.tagline')}</h1>
        </div>
        <p className={styles.sub}>{t('app.description')}</p>

        <button
          type="button"
          className={cx(styles.dropzone, dragging && styles.dragging)}
          onClick={() => input.current?.click()}
          aria-describedby="drop-hint"
        >
          {busy ? (
            <Spinner size={28} />
          ) : (
            <UploadCloud className={styles.dropIcon} size={34} aria-hidden="true" />
          )}
          <span className={styles.dropTitle}>
            {dragging ? t('home.dropActive') : t('home.dropTitle')}
          </span>
          <span className={styles.dropHint} id="drop-hint">
            {/* Split around the placeholder so the shortcut can be a styled key cap
                without the translation having to know about markup. */}
            {hint[0]}
            <span className={styles.kbd}>{modifierLabel()} + V</span>
            {hint[1]}
          </span>
          <span className={styles.kinds}>{t('home.supported')}</span>
        </button>

        <input
          ref={input}
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

        <RejectedFiles />

        <ul className={styles.capabilities}>
          {CAPABILITIES.map(({ icon: Icon, title, desc }) => (
            <li key={title} className={styles.capability}>
              <span className={styles.capabilityHead}>
                <Icon size={15} aria-hidden="true" />
                {t(title)}
              </span>
              <span className={styles.capabilityDesc}>{t(desc)}</span>
            </li>
          ))}
        </ul>
      </main>

      <footer className={styles.footer}>
        <span className={styles.privacy}>
          <ShieldCheck size={14} aria-hidden="true" />
          {t('home.privacy')}
        </span>
        <span>{t('home.privacyLong')}</span>
      </footer>
    </div>
  );
}

/** Exported so the shell can trigger the same picker from its toolbar. */
export function FilePickerButton({ onFiles }: { onFiles: (files: File[]) => void }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => input.current?.click()}>
        <UploadCloud size={14} aria-hidden="true" />
        {t('library.add')}
      </Button>
      <input
        ref={input}
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
    </>
  );
}
