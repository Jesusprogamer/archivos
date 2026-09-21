import type { CropRect } from '../../../core/image/transform';
import { ASPECTS, type AspectId } from './cropGeometry';
import { useT } from '../../../i18n';
import { Button } from '../../../ui/Button';
import { Field } from '../../../ui/Field';
import { Notice } from '../../../ui/Notice';
import { Select } from '../../../ui/Select';
import panel from '../../../app/Panel.module.css';
import styles from '../Image.module.css';

export interface CropToolProps {
  aspect: AspectId;
  onAspectChange: (aspect: AspectId) => void;
  rect: CropRect | undefined;
  onApply: () => void;
}

export function CropTool({ aspect, onAspectChange, rect, onApply }: CropToolProps) {
  const t = useT();
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
      <h3 className={panel.sectionTitle}>{t('image.crop.title')}</h3>

      <Field label={t('image.crop.aspect')} inline>
        {(id) => (
          <Select<AspectId>
            id={id}
            value={aspect}
            onChange={onAspectChange}
            options={ASPECTS.map((candidate) => ({
              value: candidate.id,
              label: candidate.id === 'free' ? t('image.crop.free') : candidate.id,
            }))}
          />
        )}
      </Field>

      <Notice tone="info">{t('image.crop.hint')}</Notice>

      {rect && rect.width >= 1 ? (
        <p className={styles.sizeReadout}>
          {t('image.export.size', { width: Math.round(rect.width), height: Math.round(rect.height) })}
        </p>
      ) : null}

      <Button
        variant="primary"
        block
        disabled={!rect || rect.width < 1 || rect.height < 1}
        onClick={onApply}
      >
        {t('image.crop.apply')}
      </Button>
    </section>
  );
}
