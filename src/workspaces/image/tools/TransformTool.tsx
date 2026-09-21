import { FlipHorizontal, FlipVertical, RotateCcw, RotateCw } from 'lucide-react';
import { useState } from 'react';
import { fitSize } from '../../../core/image/transform';
import { useT } from '../../../i18n';
import { Button } from '../../../ui/Button';
import { Field } from '../../../ui/Field';
import { Switch } from '../../../ui/Switch';
import panel from '../../../app/Panel.module.css';
import controls from '../../../ui/controls.module.css';
import styles from '../Image.module.css';

export interface TransformToolProps {
  width: number;
  height: number;
  onRotate: (turns: 1 | 3) => void;
  onFlip: (axis: 'x' | 'y') => void;
  onResize: (size: { width: number; height: number }) => void;
}

export function TransformTool({ width, height, onRotate, onFlip, onResize }: TransformToolProps) {
  const t = useT();
  const [lock, setLock] = useState(true);
  const [draft, setDraft] = useState({ width, height });
  const [lastSize, setLastSize] = useState(`${width}x${height}`);

  // The document can change size under us — a crop, an undo — so the boxes
  // follow it rather than showing a stale number.
  if (lastSize !== `${width}x${height}`) {
    setLastSize(`${width}x${height}`);
    setDraft({ width, height });
  }

  const setWidth = (value: number) =>
    setDraft(lock ? fitSize(width, height, { width: value }) : { ...draft, width: value });
  const setHeight = (value: number) =>
    setDraft(lock ? fitSize(width, height, { height: value }) : { ...draft, height: value });

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
      <h3 className={panel.sectionTitle}>{t('image.transform.title')}</h3>

      <div className={styles.iconRow}>
        <Button iconOnly aria-label={t('image.transform.rotateLeft')} onClick={() => onRotate(3)}>
          <RotateCcw size={15} aria-hidden="true" />
        </Button>
        <Button iconOnly aria-label={t('image.transform.rotateRight')} onClick={() => onRotate(1)}>
          <RotateCw size={15} aria-hidden="true" />
        </Button>
        <Button iconOnly aria-label={t('image.transform.flipH')} onClick={() => onFlip('x')}>
          <FlipHorizontal size={15} aria-hidden="true" />
        </Button>
        <Button iconOnly aria-label={t('image.transform.flipV')} onClick={() => onFlip('y')}>
          <FlipVertical size={15} aria-hidden="true" />
        </Button>
      </div>

      <Field label={t('image.transform.width')} inline>
        {(id) => (
          <input
            id={id}
            className={`${controls.input} ${controls.number}`}
            type="number"
            min={1}
            max={20000}
            value={draft.width}
            onChange={(event) => setWidth(Math.max(1, Number(event.target.value) || 1))}
          />
        )}
      </Field>
      <Field label={t('image.transform.height')} inline>
        {(id) => (
          <input
            id={id}
            className={`${controls.input} ${controls.number}`}
            type="number"
            min={1}
            max={20000}
            value={draft.height}
            onChange={(event) => setHeight(Math.max(1, Number(event.target.value) || 1))}
          />
        )}
      </Field>

      <Switch label={t('image.transform.lockRatio')} checked={lock} onChange={setLock} />

      <Button
        variant="primary"
        block
        disabled={draft.width === width && draft.height === height}
        onClick={() => onResize(draft)}
      >
        {t('image.transform.resize')}
      </Button>
    </section>
  );
}
