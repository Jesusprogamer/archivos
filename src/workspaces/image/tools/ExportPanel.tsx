import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { DocumentState } from '../../../core/image/document';
import { exportImage } from '../../../core/image/export';
import { downloadBlob } from '../../../core/convert/zip';
import { canvasEncodeSupport } from '../../../core/util/capabilities';
import { baseName, formatBytes, safeFileName } from '../../../core/util/format';
import { useLocaleStore, useT } from '../../../i18n';
import { Button } from '../../../ui/Button';
import { ColorInput } from '../../../ui/ColorInput';
import { Field } from '../../../ui/Field';
import { Notice } from '../../../ui/Notice';
import { SegmentedControl } from '../../../ui/SegmentedControl';
import { Slider } from '../../../ui/Slider';
import { toast } from '../../../ui/toast';
import type { Backdrop } from '../backdrop';
import panel from '../../../app/Panel.module.css';
import styles from '../Image.module.css';

const FORMATS = [
  { id: 'png', mime: 'image/png', label: 'PNG', extension: 'png', lossy: false, alpha: true },
  { id: 'webp', mime: 'image/webp', label: 'WebP', extension: 'webp', lossy: true, alpha: true },
  { id: 'jpeg', mime: 'image/jpeg', label: 'JPG', extension: 'jpg', lossy: true, alpha: false },
] as const;

type FormatId = (typeof FORMATS)[number]['id'];

export interface ExportPanelProps {
  state: DocumentState;
  sourceName: string;
  filter: string;
  backdrop: Backdrop;
}

export function ExportPanel({ state, sourceName, filter, backdrop }: ExportPanelProps) {
  const t = useT();
  const locale = useLocaleStore((state_) => state_.locale);
  const [formatId, setFormatId] = useState<FormatId>('png');
  const [quality, setQuality] = useState(90);
  const [flattenTo, setFlattenTo] = useState('#ffffff');
  const [supported, setSupported] = useState<ReadonlySet<string> | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void canvasEncodeSupport().then(setSupported);
  }, []);

  const available = FORMATS.filter((format) => !supported || supported.has(format.mime));
  const format = available.find((candidate) => candidate.id === formatId) ?? available[0];

  const download = async () => {
    if (!format) return;
    setBusy(true);
    try {
      const result = await exportImage(state, {
        mime: format.mime,
        quality,
        filter,
        backdrop,
        // Only a format without alpha needs a fill behind the subject.
        ...(format.alpha ? {} : { flattenTo }),
      });
      downloadBlob(result.blob, safeFileName(`${baseName(sourceName)}.${format.extension}`));
      toast.success(t('common.done'), formatBytes(result.blob.size, locale));
    } catch (error) {
      toast.error(t('common.error'), error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
      <h3 className={panel.sectionTitle}>{t('image.export.title')}</h3>

      <SegmentedControl<FormatId>
        block
        value={format?.id ?? 'png'}
        label={t('image.export.format')}
        onChange={setFormatId}
        segments={available.map((candidate) => ({ value: candidate.id, label: candidate.label }))}
      />

      {format?.lossy ? (
        <Field label={t('image.export.quality')}>
          {(id) => (
            <Slider
              id={id}
              min={1}
              max={100}
              value={quality}
              aria-label={t('image.export.quality')}
              onChange={setQuality}
            />
          )}
        </Field>
      ) : null}

      {format && !format.alpha ? (
        <>
          <Notice tone="warning">{t('image.export.jpegWarning')}</Notice>
          <Field label={t('image.backdrop.color')} inline>
            {(id) => (
              <ColorInput
                id={id}
                label={t('image.backdrop.color')}
                value={flattenTo}
                onChange={setFlattenTo}
              />
            )}
          </Field>
        </>
      ) : null}

      <p className={styles.sizeReadout}>
        {t('image.export.size', { width: state.width, height: state.height })}
      </p>

      <Button variant="primary" block disabled={busy || !format} onClick={() => void download()}>
        <Download size={14} aria-hidden="true" />
        {t('image.export.download')}
      </Button>
    </section>
  );
}
