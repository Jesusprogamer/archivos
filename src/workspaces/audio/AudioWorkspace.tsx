import {
  Clipboard,
  Copy,
  Download,
  Maximize2,
  Pause,
  Play,
  Repeat,
  Scissors,
  SkipBack,
  Square,
  Trash2,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { durationOf, toDecibels, type AudioData } from '../../core/audio/buffer';
import { DEFAULT_SETTINGS, type EffectId, type EffectSettings } from '../../core/audio/effects';
import { EXPORT_TARGETS, exportAudio } from '../../core/audio/exportAudio';
import { decodeAudio } from '../../core/audio/render';
import {
  DEFAULT_OPTIONS,
  AUDIO_BITRATES,
  type ConversionOptions,
} from '../../core/convert/options';
import { downloadBlob } from '../../core/convert/zip';
import type { MediaItem } from '../../core/media/types';
import { baseName, formatBytes, formatTimecode, safeFileName } from '../../core/util/format';
import { useLocaleStore, useT, type TranslationKey } from '../../i18n';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { Field } from '../../ui/Field';
import { Notice } from '../../ui/Notice';
import { Progress, Spinner } from '../../ui/Progress';
import { Select } from '../../ui/Select';
import { Slider } from '../../ui/Slider';
import { cx } from '../../ui/cx';
import { toast } from '../../ui/toast';
import panel from '../../app/Panel.module.css';
import { EffectParams } from './EffectParams';
import { Waveform, type WaveformView } from './Waveform';
import { useAnimationTick, useAudioEditor, useAudioPlayer } from './useAudioEditor';
import styles from './Audio.module.css';

const EFFECT_ORDER: readonly EffectId[] = [
  'gain',
  'normalize',
  'fadeIn',
  'fadeOut',
  'reverse',
  'silence',
  'speed',
  'pitch',
  'equalizer',
  'reverb',
  'echo',
  'compressor',
  'highpass',
  'lowpass',
];

const EFFECT_LABEL: Record<EffectId, TranslationKey> = {
  gain: 'audio.effect.gain',
  normalize: 'audio.effect.normalize',
  fadeIn: 'audio.effect.fadeIn',
  fadeOut: 'audio.effect.fadeOut',
  reverse: 'audio.effect.reverse',
  silence: 'audio.effect.silence',
  speed: 'audio.effect.speed',
  pitch: 'audio.effect.pitch',
  equalizer: 'audio.effect.equalizer',
  reverb: 'audio.effect.reverb',
  echo: 'audio.effect.echo',
  compressor: 'audio.effect.compressor',
  highpass: 'audio.effect.highpass',
  lowpass: 'audio.effect.lowpass',
};

export function AudioWorkspace({ item }: { item: MediaItem }) {
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

  if (error) return <EmptyState title={t('audio.decodeFailed')} body={error} />;
  if (!audio) return <EmptyState icon={<Spinner size={26} />} title={t('audio.decoding')} />;
  return <Editor key={item.id} item={item} audio={audio} />;
}

function Editor({ item, audio }: { item: MediaItem; audio: AudioData }) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const { editor } = useAudioEditor(audio);
  const { player } = useAudioPlayer();

  const duration = editor.duration;
  const [view, setView] = useState<WaveformView>({ start: 0, end: durationOf(audio) });
  const [loop, setLoop] = useState(false);
  const [effectId, setEffectId] = useState<EffectId | undefined>();
  const [effect, setEffect] = useState<EffectSettings>(DEFAULT_SETTINGS.gain);
  const [silenceSeconds, setSilenceSeconds] = useState(1);
  const [targetId, setTargetId] = useState('mp3');
  const [options, setOptions] = useState<ConversionOptions>(DEFAULT_OPTIONS);
  const [exporting, setExporting] = useState<number | undefined>();

  useAnimationTick(player.playing);

  const selection = editor.getSelection();
  const position = player.playing ? player.position : editor.getPlayhead();
  const level = player.level;

  /**
   * Mantiene el cabezal a la vista mientras suena.
   *
   * Sin zoom se ve la onda entera y esto no hace nada. Con zoom, el cabezal se
   * salía por la derecha a los pocos segundos y ya no se veía por dónde iba.
   * La ventana avanza de golpe, conservando el zoom, en lugar de desplazarse
   * continuamente: con la onda dibujada en un canvas, un desplazamiento suave
   * obligaría a recalcular los picos en cada fotograma.
   *
   * Ajuste durante el render, no en un efecto: React vuelve a renderizar antes
   * de pintar, así que la onda nunca llega a dibujarse con la ventana vieja.
   */
  if (player.playing && (position < view.start || position > view.end)) {
    const span = view.end - view.start;
    const start = Math.max(0, Math.min(Math.max(0, duration - span), position - span * 0.1));
    setView({ start, end: start + span });
  }
  const target =
    EXPORT_TARGETS.find((candidate) => candidate.id === targetId) ?? EXPORT_TARGETS[0]!;

  // The preview is recomputed whenever its parameters change, so the waveform
  // and playback always show the effect exactly as it would be applied. The
  // engine owns the "computing" flag and drops stale results itself.
  useEffect(() => {
    if (!effectId) return;
    void editor.previewEffect(effect);
  }, [editor, effectId, effect]);

  const computing = editor.isComputing;

  const play = useCallback(() => {
    if (player.playing) {
      player.stop();
      return;
    }
    const start = selection ? selection.start : editor.getPlayhead();
    const end = selection ? selection.end : duration;
    player.play(editor.current, { start, end, loop });
  }, [player, editor, selection, duration, loop]);

  const stop = useCallback(() => {
    player.stop();
    editor.setPlayhead(selection?.start ?? 0);
  }, [player, editor, selection]);

  const zoom = (factor: number) => {
    const span = Math.max(0.01, Math.min(duration, (view.end - view.start) * factor));
    const centre = (view.start + view.end) / 2;
    const start = Math.max(0, Math.min(duration - span, centre - span / 2));
    setView({ start, end: start + span });
  };

  // Keyboard shortcuts, matching what the help dialog advertises.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const node = event.target as HTMLElement | null;
      if (node?.closest('input, textarea, select, [contenteditable]')) return;
      const mod = event.metaKey || event.ctrlKey;

      if (event.code === 'Space') {
        event.preventDefault();
        play();
      } else if (mod && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        editor.undo();
      } else if (
        mod &&
        (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey))
      ) {
        event.preventDefault();
        editor.redo();
      } else if (mod && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        editor.selectAll();
      } else if (mod && event.key.toLowerCase() === 'x') {
        event.preventDefault();
        editor.cut();
      } else if (mod && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        editor.copy();
      } else if (mod && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        editor.paste();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        editor.deleteRange();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editor, play]);

  const doExport = async () => {
    setExporting(0);
    try {
      const blob = await exportAudio(editor.committed, target, options, {
        onProgress: setExporting,
      });
      downloadBlob(blob, safeFileName(`${baseName(item.name)}.${target.extension}`));
      toast.success(t('audio.exportDone'), formatBytes(blob.size, locale));
    } catch (cause) {
      toast.error(t('common.error'), cause instanceof Error ? cause.message : String(cause));
    } finally {
      setExporting(undefined);
    }
  };

  const levelDb = toDecibels(level);
  const clipping = level >= 0.999;

  const lossless = target.id === 'wav' || target.id === 'flac';

  return (
    <div className={styles.workspace}>
      <div className={styles.stage}>
        <div className={styles.transport}>
          <Button variant="ghost" size="sm" iconOnly aria-label={t('audio.toStart')} onClick={stop}>
            <SkipBack size={15} aria-hidden="true" />
          </Button>
          <Button
            variant="primary"
            size="sm"
            iconOnly
            aria-label={player.playing ? t('audio.pause') : t('audio.play')}
            onClick={play}
          >
            {player.playing ? (
              <Pause size={15} aria-hidden="true" />
            ) : (
              <Play size={15} aria-hidden="true" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={t('audio.stop')}
            onClick={() => player.stop()}
          >
            <Square size={14} aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            pressed={loop}
            aria-label={t('audio.loop')}
            onClick={() => setLoop(!loop)}
          >
            <Repeat size={15} aria-hidden="true" />
          </Button>

          <span className={styles.time}>
            <span className={styles.timeCurrent}>{formatTimecode(position)}</span>
            {' / '}
            {formatTimecode(duration)}
          </span>

          <span className={styles.spacer} />

          <span className={styles.meter}>
            {t('audio.level')}
            <span className={styles.meterTrack}>
              <span
                className={styles.meterBar}
                style={{ transform: `scaleX(${Math.min(1, level)})` }}
              />
            </span>
            <span className={cx(styles.meterPeak, clipping && styles.clipping)}>
              {clipping
                ? t('audio.clipping')
                : Number.isFinite(levelDb)
                  ? `${levelDb.toFixed(1)}`
                  : '−∞'}
            </span>
          </span>

          <span className={styles.spacer} />

          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={t('common.undo')}
            disabled={!editor.canUndo}
            onClick={() => editor.undo()}
          >
            <Undo2 size={15} aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={t('common.redo')}
            disabled={!editor.canRedo}
            onClick={() => editor.redo()}
          >
            <Redo2 size={15} aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={t('audio.zoomOut')}
            onClick={() => zoom(1.6)}
          >
            <ZoomOut size={15} aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={t('audio.zoomIn')}
            onClick={() => zoom(1 / 1.6)}
          >
            <ZoomIn size={15} aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={t('audio.zoomFit')}
            onClick={() => setView({ start: 0, end: duration })}
          >
            <Maximize2 size={15} aria-hidden="true" />
          </Button>
        </div>

        <Waveform
          audio={editor.current}
          revision={editor.revision}
          view={view}
          selection={selection}
          playhead={position}
          onSelectionChange={(next) => editor.setSelection(next)}
          onPlayheadChange={(seconds) => editor.setPlayhead(seconds)}
          onViewChange={setView}
        />
      </div>

      <aside className={styles.panel} aria-label={t('audio.effects')}>
        <div className={styles.panelBody}>
          <section>
            <h3 className={panel.sectionTitle}>{t('audio.selection')}</h3>
            <p className={styles.selectionInfo}>
              {selection
                ? t('audio.selectionRange', {
                    start: formatTimecode(selection.start),
                    end: formatTimecode(selection.end),
                    length: formatTimecode(selection.end - selection.start),
                  })
                : t('audio.noSelection')}
            </p>
          </section>

          <section>
            <h3 className={panel.sectionTitle}>{t('audio.edit')}</h3>
            <div className={styles.editGrid}>
              <Button size="sm" onClick={() => editor.cut()} disabled={!selection}>
                <Scissors size={13} aria-hidden="true" />
                {t('audio.cut')}
              </Button>
              <Button size="sm" onClick={() => editor.copy()} disabled={!selection}>
                <Copy size={13} aria-hidden="true" />
                {t('audio.copy')}
              </Button>
              <Button size="sm" onClick={() => editor.paste()} disabled={!editor.hasClipboard}>
                <Clipboard size={13} aria-hidden="true" />
                {t('audio.paste')}
              </Button>
              <Button size="sm" onClick={() => editor.deleteRange()} disabled={!selection}>
                <Trash2 size={13} aria-hidden="true" />
                {t('audio.delete')}
              </Button>
              <Button size="sm" onClick={() => editor.trimToSelection()} disabled={!selection}>
                {t('audio.trim')}
              </Button>
              <Button size="sm" onClick={() => editor.selectAll()}>
                {t('audio.selectAll')}
              </Button>
            </div>
            <Field label={t('audio.silenceSeconds')} className={cx(panel.spaced)}>
              {(id) => (
                <Slider
                  id={id}
                  min={0.1}
                  max={10}
                  step={0.1}
                  value={silenceSeconds}
                  suffix="s"
                  aria-label={t('audio.silenceSeconds')}
                  onChange={setSilenceSeconds}
                />
              )}
            </Field>
            <Button size="sm" block onClick={() => editor.insertSilence(silenceSeconds)}>
              {t('audio.insertSilence')}
            </Button>
          </section>

          <section>
            <h3 className={panel.sectionTitle}>{t('audio.effects')}</h3>
            <div className={styles.effectGrid}>
              {EFFECT_ORDER.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={styles.effectButton}
                  aria-pressed={effectId === id}
                  onClick={() => {
                    if (effectId === id) {
                      setEffectId(undefined);
                      editor.discardPreview();
                    } else {
                      setEffectId(id);
                      setEffect(DEFAULT_SETTINGS[id]);
                    }
                  }}
                >
                  {t(EFFECT_LABEL[id])}
                </button>
              ))}
            </div>
          </section>

          {effectId ? (
            <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
              <EffectParams effect={effect} onChange={setEffect} />
              <span className={styles.previewBar}>
                <span>{computing ? t('audio.computing') : t('audio.previewPending')}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEffectId(undefined);
                    editor.discardPreview();
                  }}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={computing}
                  onClick={() => {
                    editor.applyPreview();
                    setEffectId(undefined);
                  }}
                >
                  {t('common.apply')}
                </Button>
              </span>
            </section>
          ) : null}

          <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
            <h3 className={panel.sectionTitle}>{t('audio.export')}</h3>
            <Field label={t('convert.outputFormat')} inline>
              {(id) => (
                <Select
                  id={id}
                  value={target.id}
                  onChange={setTargetId}
                  options={EXPORT_TARGETS.map((candidate) => ({
                    value: candidate.id,
                    label: candidate.format.label,
                  }))}
                />
              )}
            </Field>
            {lossless ? null : (
              <Field label={t('convert.bitrate')} inline>
                {(id) => (
                  <Select
                    id={id}
                    value={String(options.audio.bitrateKbps)}
                    onChange={(next) =>
                      setOptions({
                        ...options,
                        audio: { ...options.audio, bitrateKbps: Number(next) },
                      })
                    }
                    options={AUDIO_BITRATES.map((rate) => ({
                      value: String(rate),
                      label: `${rate} kbit/s`,
                    }))}
                  />
                )}
              </Field>
            )}
            {exporting !== undefined ? (
              <Progress value={exporting} label={t('audio.exporting')} />
            ) : null}
            <Button
              variant="primary"
              block
              disabled={exporting !== undefined}
              onClick={() => void doExport()}
            >
              <Download size={14} aria-hidden="true" />
              {t('audio.export')}
            </Button>
            {editor.hasPreview ? (
              <Notice tone="warning">{t('audio.previewNotExported')}</Notice>
            ) : null}
          </section>
        </div>
      </aside>
    </div>
  );
}
