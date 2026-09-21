import { Download } from 'lucide-react';
import { useState } from 'react';
import { toDecibels } from '../../core/audio/buffer';
import type { AudioSourceLookup } from '../../core/video/mixdown';
import type { VideoEditor } from '../../core/video/editor';
import {
  EXPORT_FRAME_RATES,
  EXPORT_RESOLUTIONS,
  exportProject,
  type ExportFormat,
  type ExportProgress,
  type ExportQuality,
} from '../../core/video/exporter';
import { projectDuration } from '../../core/video/project';
import type { SourceManager } from '../../core/video/sources';
import { FFmpegCancelled } from '../../core/ffmpeg/client';
import { formatDuration } from '../../core/util/format';
import { useT } from '../../i18n';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Notice } from '../../ui/Notice';
import { Progress } from '../../ui/Progress';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Select } from '../../ui/Select';
import { toast } from '../../ui/toast';
import panel from '../../app/Panel.module.css';
import styles from './Video.module.css';

export interface ExportPanelProps {
  editor: VideoEditor;
  sources: SourceManager;
  audioLookup: AudioSourceLookup;
  prepareAudio: () => Promise<void>;
  onExported: (blob: Blob, extension: string) => void;
}

export function ExportPanel({
  editor,
  sources,
  audioLookup,
  prepareAudio,
  onExported,
}: ExportPanelProps) {
  const t = useT();
  const project = editor.getProject();
  const [format, setFormat] = useState<ExportFormat>('mp4');
  const [height, setHeight] = useState(720);
  const [fps, setFps] = useState(project.fps);
  const [quality, setQuality] = useState<ExportQuality>('balanced');
  const [progress, setProgress] = useState<ExportProgress | undefined>();
  const [controller, setController] = useState<AbortController | undefined>();
  const [clipping, setClipping] = useState<number | undefined>();

  const duration = projectDuration(project);
  const empty = duration <= 0;
  // The project's aspect ratio decides the width, rounded to an even number
  // because H.264 and VP9 both insist on it.
  const width = Math.round((height * project.width) / project.height / 2) * 2;

  const start = async () => {
    const abort = new AbortController();
    setController(abort);
    setClipping(undefined);
    setProgress({ progress: 0, stage: 'frames', frame: 0, totalFrames: 0 });
    try {
      await prepareAudio();
      const result = await exportProject(
        project,
        sources,
        audioLookup,
        { format, width, height, fps, quality },
        { signal: abort.signal, onProgress: setProgress },
      );
      onExported(result.blob, format);
      if (result.audioPeak > 1) setClipping(toDecibels(result.audioPeak));
      toast.success(t('video.exportDone'));
    } catch (error) {
      if (!(error instanceof FFmpegCancelled)) {
        toast.error(t('common.error'), error instanceof Error ? error.message : String(error));
      }
    } finally {
      setController(undefined);
      setProgress(undefined);
    }
  };

  return (
    <section className={styles.group}>
      <h3 className={panel.sectionTitle}>{t('video.exportSettings')}</h3>

      <Field label={t('video.format')}>
        {() => (
          <SegmentedControl<ExportFormat>
            block
            value={format}
            label={t('video.format')}
            onChange={setFormat}
            segments={[
              { value: 'mp4', label: 'MP4 (H.264)' },
              { value: 'webm', label: 'WebM (VP8)' },
            ]}
          />
        )}
      </Field>

      <Field label={t('video.resolution')} inline>
        {(id) => (
          <Select
            id={id}
            value={String(height)}
            onChange={(next) => setHeight(Number(next))}
            options={EXPORT_RESOLUTIONS.map((entry) => ({
              value: String(entry.height),
              label: entry.label,
            }))}
          />
        )}
      </Field>

      <Field label={t('video.fps')} inline>
        {(id) => (
          <Select
            id={id}
            value={String(fps)}
            onChange={(next) => setFps(Number(next))}
            options={EXPORT_FRAME_RATES.map((rate) => ({ value: String(rate), label: String(rate) }))}
          />
        )}
      </Field>

      <Field label={t('video.quality')}>
        {() => (
          <SegmentedControl<ExportQuality>
            block
            value={quality}
            label={t('video.quality')}
            onChange={setQuality}
            segments={[
              { value: 'high', label: t('convert.quality.high') },
              { value: 'balanced', label: t('convert.quality.balanced') },
              { value: 'small', label: t('convert.quality.small') },
            ]}
          />
        )}
      </Field>

      <p className={panel.specs} style={{ display: 'block', color: 'var(--fg-muted)' }}>
        {width} × {height} · {formatDuration(duration)} · {Math.ceil(duration * fps)}{' '}
        {t('video.fps').toLowerCase()}
      </p>

      {empty ? <Notice tone="warning">{t('video.exportEmpty')}</Notice> : null}

      {progress ? (
        <>
          <Progress
            value={progress.progress}
            label={
              progress.stage === 'frames'
                ? t('video.exporting', { frame: progress.frame, total: progress.totalFrames })
                : progress.stage === 'muxing'
                  ? t('video.muxing')
                  : t('video.encodingSegment')
            }
            {...(progress.remaining !== undefined
              ? { detail: t('convert.eta', { time: formatDuration(progress.remaining) }) }
              : {})}
          />
          <Button variant="ghost" block onClick={() => controller?.abort()}>
            {t('common.cancel')}
          </Button>
        </>
      ) : (
        <Button variant="primary" block disabled={empty} onClick={() => void start()}>
          <Download size={14} aria-hidden="true" />
          {t('video.export')}
        </Button>
      )}

      {clipping !== undefined ? (
        <Notice tone="warning">
          {t('video.clippingWarning', { peak: clipping.toFixed(1) })}
        </Notice>
      ) : null}

      <Notice tone="info">{t('video.exportSlowNote')}</Notice>
    </section>
  );
}
