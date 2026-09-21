import { ImagePlus } from 'lucide-react';
import { useRef } from 'react';
import { BACKDROP_SWATCHES, type Backdrop } from '../backdrop';
import { useT } from '../../../i18n';
import { Button } from '../../../ui/Button';
import { ColorInput } from '../../../ui/ColorInput';
import { Notice } from '../../../ui/Notice';
import { SegmentedControl } from '../../../ui/SegmentedControl';
import panel from '../../../app/Panel.module.css';
import styles from '../Image.module.css';

export interface BackdropToolProps {
  backdrop: Backdrop;
  onChange: (backdrop: Backdrop) => void;
}

export function BackdropTool({ backdrop, onChange }: BackdropToolProps) {
  const t = useT();
  const fileInput = useRef<HTMLInputElement>(null);

  const chooseImage = async (file: File) => {
    const image = await createImageBitmap(file);
    onChange({ kind: 'image', image, name: file.name });
  };

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
      <h3 className={panel.sectionTitle}>{t('image.backdrop.title')}</h3>

      <SegmentedControl<Backdrop['kind']>
        block
        value={backdrop.kind}
        label={t('image.backdrop.title')}
        onChange={(kind) => {
          if (kind === 'none') onChange({ kind: 'none' });
          else if (kind === 'color') onChange({ kind: 'color', color: '#ffffff' });
          else fileInput.current?.click();
        }}
        segments={[
          { value: 'none', label: t('image.backdrop.none') },
          { value: 'color', label: t('image.backdrop.color') },
          { value: 'image', label: t('image.backdrop.image') },
        ]}
      />

      {backdrop.kind === 'color' ? (
        <>
          <div className={styles.swatchRow}>
            {BACKDROP_SWATCHES.map((color) => (
              <button
                key={color}
                type="button"
                className={styles.swatch}
                style={{ background: color }}
                aria-label={color}
                aria-pressed={backdrop.color === color}
                onClick={() => onChange({ kind: 'color', color })}
              />
            ))}
          </div>
          <ColorInput
            label={t('image.backdrop.color')}
            value={backdrop.color}
            onChange={(color) => onChange({ kind: 'color', color })}
          />
        </>
      ) : null}

      {backdrop.kind === 'image' ? (
        <Button variant="secondary" block onClick={() => fileInput.current?.click()}>
          <ImagePlus size={14} aria-hidden="true" />
          {backdrop.name || t('image.backdrop.choose')}
        </Button>
      ) : null}

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="file-trigger"
        tabIndex={-1}
        aria-label={t('image.backdrop.choose')}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void chooseImage(file);
          event.target.value = '';
        }}
      />

      <Notice tone="info">{t('image.backdrop.hint')}</Notice>
    </section>
  );
}
