import { Download, Pause, Play, Save, SkipBack, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { durationOf, type AudioData } from '../../core/audio/buffer';
import { decodeAudio } from '../../core/audio/render';
import { downloadBlob } from '../../core/convert/zip';
import { FFmpegCancelled } from '../../core/ffmpeg/client';
import type { MediaItem } from '../../core/media/types';
import { loadFonts } from '../../core/video/fonts';
import { analyse, type Frame } from '../../core/visualizer/analysis';
import { drawScene, type DrawAssets } from '../../core/visualizer/draw';
import {
  exportVisualizer,
  type VisualizerFormat,
  type VisualizerProgress,
} from '../../core/visualizer/exporter';
import {
  DEFAULT_SCENE,
  deletePreset,
  frameSize,
  listPresets,
  savePreset,
  type Preset,
  type VisualizerScene,
} from '../../core/visualizer/scene';
import { createId } from '../../core/util/id';
import { baseName, formatDuration, formatTimecode, safeFileName } from '../../core/util/format';
import { useT } from '../../i18n';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { Field } from '../../ui/Field';
import { Notice } from '../../ui/Notice';
import { cx } from '../../ui/cx';
import { Progress, Spinner } from '../../ui/Progress';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Slider } from '../../ui/Slider';
import { toast } from '../../ui/toast';
import panel from '../../app/Panel.module.css';
import { SceneControls } from './SceneControls';
import styles from './Visualizer.module.css';

export function VisualizerWorkspace({ item }: { item: MediaItem }) {
  const t = useT();
  const [audio, setAudio] = useState<AudioData | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [decodedFile, setDecodedFile] = useState(item.file);

  if (decodedFile !== item.file) {
    setDecodedFile(item.file);
    setAudio(undefined);
    setError(undefined);
  }

  useEffect(() => {
    void loadFonts();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void decodeAudio(item.file).then(
      (result) => {
        if (!cancelled) setAudio(result);
      },
      (cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [item.file]);

  if (error) return <EmptyState title={t('vis.decodeFailed')} body={error} />;
  if (!audio) return <EmptyState icon={<Spinner size={26} />} title={t('audio.decoding')} />;
  return <Editor key={item.id} item={item} audio={audio} />;
}

function Editor({ item, audio }: { item: MediaItem; audio: AudioData }) {
  const t = useT();
  const [scene, setScene] = useState<VisualizerScene>(DEFAULT_SCENE);
  const [assets, setAssets] = useState<DrawAssets>({});
  const [presets, setPresets] = useState<readonly Preset[]>(() => listPresets());
  const [presetName, setPresetName] = useState('');
  const [format, setFormat] = useState<VisualizerFormat>('mp4');
  const [progress, setProgress] = useState<VisualizerProgress | undefined>();
  const [controller, setController] = useState<AbortController | undefined>();
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef(0);

  const duration = durationOf(audio);
  const size = frameSize(scene);
  const transparent = scene.background.kind === 'transparent';

  /**
   * The whole track is analysed up front, and only re-analysed when a setting
   * that changes the numbers changes — not when a colour does.
   */
  const frames: Frame[] = useMemo(
    () =>
      analyse(audio, {
        fftSize: 2048,
        fps: scene.fps,
        smoothing: scene.visual.smoothing,
        bands: scene.visual.bars,
        minFrequency: scene.visual.minFrequency,
        maxFrequency: scene.visual.maxFrequency,
      }),
    [
      audio,
      scene.fps,
      scene.visual.smoothing,
      scene.visual.bars,
      scene.visual.minFrequency,
      scene.visual.maxFrequency,
    ],
  );

  const draw = useCallback(
    (seconds: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (canvas.width !== size.width || canvas.height !== size.height) {
        canvas.width = size.width;
        canvas.height = size.height;
      }
      // Una vez creado, el contexto ignora nuevas opciones, así que el lienzo
      // se remonta (ver la `key` de abajo) cuando cambia la transparencia.
      const context = canvas.getContext('2d', { alpha: transparent });
      if (!context) return;
      const index = Math.max(0, Math.min(frames.length - 1, Math.round(seconds * scene.fps)));
      drawScene(context, scene, frames[index], index, size, assets);
    },
    [frames, scene, size, assets, transparent],
  );

  // Redraw whenever anything about the look changes, even while paused.
  useEffect(() => draw(time), [draw, time]);

  // While playing, the audio element is the clock — the same reasoning as the
  // audio editor: a timer drifts against the sound and the bars lose sync.
  useEffect(() => {
    if (!playing) {
      cancelAnimationFrame(rafRef.current);
      return;
    }
    const tick = () => {
      const element = audioRef.current;
      if (element) setTime(element.currentTime);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing]);

  const loadImage = (file: File, into: 'background' | 'logo') => {
    void createImageBitmap(file).then((bitmap) => {
      setAssets((current) => ({ ...current, [into]: bitmap }));
      if (into === 'background') {
        setScene((current) => ({
          ...current,
          background: { ...current.background, kind: 'image', imageName: file.name },
        }));
      } else {
        setScene((current) => ({ ...current, logo: { ...current.logo, show: true, name: file.name } }));
      }
    });
  };

  const startExport = async () => {
    const abort = new AbortController();
    setController(abort);
    setProgress({ progress: 0, stage: 'frames', frame: 0, totalFrames: frames.length });
    try {
      const blob = await exportVisualizer(
        scene,
        frames,
        audio,
        assets,
        { format, quality: 'balanced' },
        { signal: abort.signal, onProgress: setProgress },
      );
      downloadBlob(blob, safeFileName(`${baseName(item.name)}-visualizador.${format}`));
      toast.success(t('vis.exportDone'));
    } catch (cause) {
      if (!(cause instanceof FFmpegCancelled)) {
        toast.error(t('common.error'), cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      setController(undefined);
      setProgress(undefined);
    }
  };

  const seek = (seconds: number) => {
    const element = audioRef.current;
    if (element) element.currentTime = seconds;
    setTime(seconds);
  };

  return (
    <div className={styles.workspace}>
      <div className={styles.stage}>
        <div className={styles.previewArea}>
          <canvas
            key={transparent ? 'alpha' : 'opaque'}
            ref={canvasRef}
            className={cx(styles.previewCanvas, transparent && 'checkerboard')}
            style={{ aspectRatio: `${size.width} / ${size.height}` }}
            aria-label={t('vis.title')}
          />
        </div>

        <div className={styles.transport}>
          <Button variant="ghost" size="sm" iconOnly aria-label={t('audio.toStart')} onClick={() => seek(0)}>
            <SkipBack size={15} aria-hidden="true" />
          </Button>
          <Button
            variant="primary"
            size="sm"
            iconOnly
            aria-label={playing ? t('audio.pause') : t('audio.play')}
            onClick={() => {
              const element = audioRef.current;
              if (!element) return;
              if (playing) {
                element.pause();
                setPlaying(false);
              } else {
                void element.play();
                setPlaying(true);
              }
            }}
          >
            {playing ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
          </Button>
          <span className={styles.time}>
            <span className={styles.timeCurrent}>{formatTimecode(time)}</span>
            {' / '}
            {formatTimecode(duration)}
          </span>
          <span className={styles.scrub}>
            <Slider
              min={0}
              max={Math.max(0.1, duration)}
              step={0.05}
              value={Math.min(time, duration)}
              showNumber={false}
              aria-label={t('vis.title')}
              onChange={seek}
            />
          </span>
          <audio
            ref={audioRef}
            src={item.url}
            onEnded={() => setPlaying(false)}
            style={{ display: 'none' }}
          />
        </div>
      </div>

      <aside className={styles.panel} aria-label={t('vis.title')}>
        <div className={styles.panelBody}>
          <SceneControls
            scene={scene}
            onChange={setScene}
            onBackgroundImage={(file) => loadImage(file, 'background')}
            onLogoImage={(file) => loadImage(file, 'logo')}
          />

          <section className={styles.group}>
            <h3 className={panel.sectionTitle}>{t('vis.presets')}</h3>
            <Field label={t('vis.presetName')}>
              {(id) => (
                <input
                  id={id}
                  className="forja-input"
                  value={presetName}
                  onChange={(event) => setPresetName(event.target.value)}
                />
              )}
            </Field>
            <Button
              size="sm"
              block
              disabled={presetName.trim() === ''}
              onClick={() => {
                savePreset({
                  id: createId('preset'),
                  name: presetName.trim(),
                  scene,
                  savedAt: Date.now(),
                });
                setPresets(listPresets());
                setPresetName('');
                toast.success(t('vis.presetSaved'));
              }}
            >
              <Save size={13} aria-hidden="true" />
              {t('vis.savePreset')}
            </Button>

            {presets.length === 0 ? (
              <p className={panel.specs} style={{ display: 'block', color: 'var(--fg-muted)' }}>
                {t('vis.noPresets')}
              </p>
            ) : (
              <ul className={styles.presetList}>
                {presets.map((preset) => (
                  <li key={preset.id} className={styles.presetRow}>
                    <span className={styles.presetName}>{preset.name}</span>
                    <Button size="sm" variant="ghost" onClick={() => setScene(preset.scene)}>
                      {t('vis.applyPreset')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      iconOnly
                      aria-label={t('vis.deletePreset')}
                      onClick={() => {
                        deletePreset(preset.id);
                        setPresets(listPresets());
                      }}
                    >
                      <Trash2 size={13} aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.group}>
            <h3 className={panel.sectionTitle}>{t('vis.export')}</h3>
            <SegmentedControl<VisualizerFormat>
              block
              value={format}
              label={t('vis.format')}
              onChange={setFormat}
              segments={[
                { value: 'mp4', label: 'MP4 (H.264)' },
                { value: 'webm', label: 'WebM (VP8)' },
              ]}
            />
            {transparent && format === 'mp4' ? (
              <Notice tone="warning">{t('vis.background.mp4NoAlpha')}</Notice>
            ) : null}
            <p className={panel.specs} style={{ display: 'block', color: 'var(--fg-muted)' }}>
              {size.width} × {size.height} · {formatDuration(duration)} · {frames.length}{' '}
              {t('video.fps').toLowerCase()}
            </p>

            {progress ? (
              <>
                <Progress
                  value={progress.progress}
                  label={
                    progress.stage === 'frames'
                      ? t('vis.exporting', { frame: progress.frame, total: progress.totalFrames })
                      : t('video.muxing')
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
              <Button variant="primary" block onClick={() => void startExport()}>
                <Download size={14} aria-hidden="true" />
                {t('vis.export')}
              </Button>
            )}
            <Notice tone="info">{t('video.exportSlowNote')}</Notice>
          </section>
        </div>
      </aside>
    </div>
  );
}
