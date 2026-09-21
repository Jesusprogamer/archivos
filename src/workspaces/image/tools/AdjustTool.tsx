import { NEUTRAL_ADJUSTMENTS, type Adjustments } from '../../../core/image/editor';
import { useT } from '../../../i18n';
import { Button } from '../../../ui/Button';
import { Field } from '../../../ui/Field';
import { Notice } from '../../../ui/Notice';
import { Slider } from '../../../ui/Slider';
import panel from '../../../app/Panel.module.css';

export interface AdjustToolProps {
  adjustments: Adjustments;
  onChange: (adjustments: Adjustments) => void;
}

export function AdjustTool({ adjustments, onChange }: AdjustToolProps) {
  const t = useT();
  const slider = (
    key: keyof Adjustments,
    label: string,
    min: number,
    max: number,
  ) => (
    <Field label={label}>
      {(id) => (
        <Slider
          id={id}
          min={min}
          max={max}
          value={adjustments[key]}
          suffix="%"
          aria-label={label}
          onChange={(value) => onChange({ ...adjustments, [key]: value })}
        />
      )}
    </Field>
  );

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
      <h3 className={panel.sectionTitle}>{t('image.adjust.title')}</h3>
      {slider('brightness', t('image.adjust.brightness'), 0, 200)}
      {slider('contrast', t('image.adjust.contrast'), 0, 200)}
      {slider('saturation', t('image.adjust.saturation'), 0, 200)}
      <Button variant="ghost" size="sm" onClick={() => onChange(NEUTRAL_ADJUSTMENTS)}>
        {t('common.reset')}
      </Button>
      <Notice tone="info">{t('image.adjust.livePreview')}</Notice>
    </section>
  );
}
