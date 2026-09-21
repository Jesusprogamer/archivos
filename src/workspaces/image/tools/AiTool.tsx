import { Download, FolderOpen, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ByteArray } from '../../../core/image/bytes';
import { fetchModel, type DownloadProgress } from '../../../core/image/modelCache';
import { MODELS, customModel, modelById, type SegmentationModel } from '../../../core/image/models';
import { segmentImage } from '../../../core/image/segmentClient';
import { formatBytes } from '../../../core/util/format';
import { useLocaleStore, useT } from '../../../i18n';
import { Button } from '../../../ui/Button';
import { Field } from '../../../ui/Field';
import { Notice } from '../../../ui/Notice';
import { Progress } from '../../../ui/Progress';
import { Select } from '../../../ui/Select';
import panel from '../../../app/Panel.module.css';
import styles from '../Image.module.css';

export interface AiToolProps {
  pixels: ByteArray;
  width: number;
  height: number;
  onMask: (mask: ByteArray) => void;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'downloading'; progress: DownloadProgress | undefined }
  | { kind: 'ready' }
  | { kind: 'running' }
  | { kind: 'done'; ms: number }
  | { kind: 'error'; message: string };

/**
 * Automatic subject detection.
 *
 * Two honest details shape this panel. First, the weights are not bundled —
 * they are fetched once, with visible progress, and the size is shown before
 * anything is downloaded. Second, if that fetch fails (a blocked network, an
 * offline machine), the panel says so plainly and offers to load an `.onnx`
 * file from disk instead, which works with no network at all.
 */
export function AiTool({ pixels, width, height, onMask }: AiToolProps) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const [modelId, setModelId] = useState(MODELS[0]!.id);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  // Which weights are loaded drives what the panel offers, so it is state
  // rather than a ref, even though the buffer itself is never rendered.
  const [weights, setWeights] = useState<ArrayBuffer | undefined>(undefined);
  const [localModel, setLocalModel] = useState<SegmentationModel | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);

  const model = localModel ?? modelById(modelId) ?? MODELS[0]!;

  const load = async () => {
    setStatus({ kind: 'downloading', progress: undefined });
    try {
      setWeights(
        await fetchModel(model.url, (progress) => setStatus({ kind: 'downloading', progress })),
      );
      setStatus({ kind: 'ready' });
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const loadLocal = async (file: File) => {
    try {
      setWeights(await file.arrayBuffer());
      setLocalModel(customModel(file.name));
      setStatus({ kind: 'ready' });
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const run = async () => {
    if (!weights) return;
    setStatus({ kind: 'running' });
    try {
      const result = await segmentImage(weights, model, pixels, width, height);
      onMask(result.mask);
      setStatus({ kind: 'done', ms: result.ms });
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const hasWeights = weights !== undefined;

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
      <h3 className={panel.sectionTitle}>{t('image.ai.title')}</h3>

      {localModel ? null : (
        <Field label={t('image.ai.model')} inline>
          {(id) => (
            <Select
              id={id}
              value={modelId}
              onChange={(next) => {
                setModelId(next);
                setWeights(undefined);
                setStatus({ kind: 'idle' });
              }}
              options={MODELS.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
            />
          )}
        </Field>
      )}

      <div className={styles.modelCard}>
        <strong>{model.name}</strong>
        <span className={styles.modelMeta}>
          {localModel ? (
            <span>{t('image.ai.localLoaded', { name: model.name })}</span>
          ) : (
            <>
              <span>{t('image.ai.license', { license: model.license })}</span>
              <span>{formatBytes(model.sizeBytes, locale)}</span>
            </>
          )}
        </span>
      </div>

      {status.kind === 'downloading' ? (
        <Progress
          value={
            status.progress && status.progress.total > 0
              ? status.progress.received / status.progress.total
              : undefined
          }
          label={t('image.ai.downloading')}
        />
      ) : null}

      {!hasWeights && status.kind !== 'downloading' ? (
        <Button variant="secondary" block onClick={() => void load()}>
          <Download size={14} aria-hidden="true" />
          {t('image.ai.download', { size: formatBytes(model.sizeBytes, locale) })}
        </Button>
      ) : null}

      {hasWeights ? (
        <Button
          variant="primary"
          block
          disabled={status.kind === 'running'}
          onClick={() => void run()}
        >
          <Sparkles size={14} aria-hidden="true" />
          {status.kind === 'running' ? t('image.ai.running') : t('image.ai.run')}
        </Button>
      ) : null}

      <Button variant="ghost" size="sm" block onClick={() => fileInput.current?.click()}>
        <FolderOpen size={13} aria-hidden="true" />
        {t('image.ai.useLocal')}
      </Button>
      <input
        ref={fileInput}
        type="file"
        accept=".onnx,application/octet-stream"
        className="sr-only"
        aria-label={t('image.ai.useLocal')}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void loadLocal(file);
          event.target.value = '';
        }}
      />

      {status.kind === 'done' ? (
        <Notice tone="success">
          {t('image.ai.tookMs', { ms: status.ms })} — {t('image.ai.refineHint')}
        </Notice>
      ) : null}

      {status.kind === 'error' ? (
        <Notice tone="error">
          <strong>{t('image.ai.failed')}</strong>
          <p style={{ marginTop: 4 }}>{t('image.ai.failedHelp')}</p>
          <p style={{ marginTop: 4, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)' }}>
            {status.message}
          </p>
        </Notice>
      ) : null}

      <Notice tone="info">{t('image.ai.privacy')}</Notice>
    </section>
  );
}
