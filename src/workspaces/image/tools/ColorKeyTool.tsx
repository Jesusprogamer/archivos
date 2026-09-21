import { Pipette } from 'lucide-react';
import type { ColorKeyParams } from '../../../core/image/colorKey';
import { useT } from '../../../i18n';
import { Button } from '../../../ui/Button';
import { ColorInput } from '../../../ui/ColorInput';
import { Field } from '../../../ui/Field';
import { Notice } from '../../../ui/Notice';
import { Slider } from '../../../ui/Slider';
import { Switch } from '../../../ui/Switch';
import panel from '../../../app/Panel.module.css';
import styles from '../Image.module.css';

export interface ColorKeyToolProps {
  params: ColorKeyParams;
  onChange: (params: ColorKeyParams) => void;
  picking: boolean;
  onPickingChange: (picking: boolean) => void;
}

export function ColorKeyTool({ params, onChange, picking, onPickingChange }: ColorKeyToolProps) {
  const t = useT();

  return (
    <section>
      <h3 className={panel.sectionTitle}>{t('image.colorKey.title')}</h3>
      <div className={styles.panelBody} style={{ padding: 0, gap: 'var(--s-3)' }}>
        <Button
          variant={picking ? 'primary' : 'secondary'}
          block
          pressed={picking}
          onClick={() => onPickingChange(!picking)}
        >
          <Pipette size={14} aria-hidden="true" />
          {picking ? t('image.colorKey.picking') : t('image.colorKey.pick')}
        </Button>

        <Field label={t('image.colorKey.color')} inline>
          {(id) => (
            <ColorInput
              id={id}
              label={t('image.colorKey.color')}
              value={params.color}
              onChange={(color) => onChange({ ...params, color })}
            />
          )}
        </Field>

        <Field label={t('image.colorKey.tolerance')}>
          {(id) => (
            <Slider
              id={id}
              min={0}
              max={100}
              value={params.tolerance}
              aria-label={t('image.colorKey.tolerance')}
              onChange={(tolerance) => onChange({ ...params, tolerance })}
            />
          )}
        </Field>

        <Field label={t('image.colorKey.softness')}>
          {(id) => (
            <Slider
              id={id}
              min={0}
              max={100}
              value={params.softness}
              aria-label={t('image.colorKey.softness')}
              onChange={(softness) => onChange({ ...params, softness })}
            />
          )}
        </Field>

        <Switch
          label={t('image.colorKey.contiguous')}
          checked={params.contiguous}
          onChange={(contiguous) => onChange({ ...params, contiguous })}
        />
        <p className={panel.specs} style={{ display: 'block', color: 'var(--fg-muted)' }}>
          {t('image.colorKey.contiguousHelp')}
        </p>

        {params.contiguous && !params.seed ? (
          <Notice tone="info">{t('image.colorKey.needSeed')}</Notice>
        ) : null}
      </div>
    </section>
  );
}
