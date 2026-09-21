import type { BrushMode, BrushSettings } from '../../../core/image/brush';
import { useT } from '../../../i18n';
import { Field } from '../../../ui/Field';
import { Notice } from '../../../ui/Notice';
import { SegmentedControl } from '../../../ui/SegmentedControl';
import { Slider } from '../../../ui/Slider';
import panel from '../../../app/Panel.module.css';

export interface BrushToolProps {
  settings: BrushSettings;
  onChange: (settings: BrushSettings) => void;
  mode: BrushMode;
  onModeChange: (mode: BrushMode) => void;
}

export function BrushTool({ settings, onChange, mode, onModeChange }: BrushToolProps) {
  const t = useT();
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
      <h3 className={panel.sectionTitle}>{t('image.brush.title')}</h3>

      <SegmentedControl<BrushMode>
        block
        value={mode}
        label={t('image.brush.title')}
        onChange={onModeChange}
        segments={[
          { value: 'erase', label: t('image.brush.erase') },
          { value: 'restore', label: t('image.brush.restore') },
        ]}
      />

      <Field label={t('image.brush.size')}>
        {(id) => (
          <Slider
            id={id}
            min={1}
            max={400}
            value={settings.size}
            suffix="px"
            aria-label={t('image.brush.size')}
            onChange={(size) => onChange({ ...settings, size })}
          />
        )}
      </Field>
      <Field label={t('image.brush.hardness')}>
        {(id) => (
          <Slider
            id={id}
            min={0}
            max={100}
            value={settings.hardness}
            aria-label={t('image.brush.hardness')}
            onChange={(hardness) => onChange({ ...settings, hardness })}
          />
        )}
      </Field>
      <Field label={t('image.brush.opacity')}>
        {(id) => (
          <Slider
            id={id}
            min={1}
            max={100}
            value={settings.opacity}
            aria-label={t('image.brush.opacity')}
            onChange={(opacity) => onChange({ ...settings, opacity })}
          />
        )}
      </Field>

      <Notice tone="info">{t('image.brush.hint')}</Notice>
    </section>
  );
}
