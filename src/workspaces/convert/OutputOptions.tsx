import {
  AUDIO_BITRATES,
  FRAME_RATES,
  SAMPLE_RATES,
  VIDEO_HEIGHTS,
  type AudioOptions,
  type ConversionOptions,
  type QualityLevel,
} from '../../core/convert/options';
import type { Target } from '../../core/convert/targets';
import { useT } from '../../i18n';
import { Field } from '../../ui/Field';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Select } from '../../ui/Select';
import { Slider } from '../../ui/Slider';
import styles from './Convert.module.css';

/** Targets that encode losslessly, where a bit-rate control would be a lie. */
const LOSSLESS = new Set(['wav', 'flac']);

function AudioControls({
  value,
  onChange,
  lossless,
}: {
  value: AudioOptions;
  onChange: (next: AudioOptions) => void;
  lossless: boolean;
}) {
  const t = useT();
  return (
    <>
      {lossless ? null : (
        <Field label={t('convert.bitrate')} inline>
          {(id) => (
            <Select
              id={id}
              value={String(value.bitrateKbps)}
              onChange={(next) => onChange({ ...value, bitrateKbps: Number(next) })}
              options={AUDIO_BITRATES.map((rate) => ({
                value: String(rate),
                label: `${rate} kbit/s`,
              }))}
            />
          )}
        </Field>
      )}
      <Field label={t('convert.sampleRate')} inline>
        {(id) => (
          <Select
            id={id}
            value={String(value.sampleRate)}
            onChange={(next) =>
              onChange({ ...value, sampleRate: next === 'source' ? 'source' : Number(next) })
            }
            options={[
              { value: 'source', label: t('convert.keepSource') },
              ...SAMPLE_RATES.map((rate) => ({ value: String(rate), label: `${rate} Hz` })),
            ]}
          />
        )}
      </Field>
      <Field label={t('convert.channels')} inline>
        {(id) => (
          <Select
            id={id}
            value={String(value.channels)}
            onChange={(next) =>
              onChange({ ...value, channels: next === 'source' ? 'source' : (Number(next) as 1 | 2) })
            }
            options={[
              { value: 'source', label: t('convert.keepSource') },
              { value: '1', label: t('file.mono') },
              { value: '2', label: t('file.stereo') },
            ]}
          />
        )}
      </Field>
    </>
  );
}

export function OutputOptions({
  target,
  options,
  onChange,
}: {
  target: Target;
  options: ConversionOptions;
  onChange: (next: ConversionOptions) => void;
}) {
  const t = useT();
  const quality = (
    <Field label={t('convert.quality')}>
      {() => (
        <SegmentedControl<QualityLevel>
          block
          value={options.video.quality}
          label={t('convert.quality')}
          onChange={(level) =>
            onChange({ ...options, video: { ...options.video, quality: level } })
          }
          segments={[
            { value: 'high', label: t('convert.quality.high') },
            { value: 'balanced', label: t('convert.quality.balanced') },
            { value: 'small', label: t('convert.quality.small') },
          ]}
        />
      )}
    </Field>
  );

  if (target.outputKind === 'audio') {
    return (
      <div className={styles.optionGroup}>
        <AudioControls
          value={options.audio}
          lossless={LOSSLESS.has(target.id)}
          onChange={(audio) => onChange({ ...options, audio })}
        />
      </div>
    );
  }

  if (target.outputKind === 'video') {
    return (
      <div className={styles.optionGroup}>
        {quality}
        <Field label={t('convert.resolution')} inline>
          {(id) => (
            <Select
              id={id}
              value={String(options.video.height)}
              onChange={(next) =>
                onChange({
                  ...options,
                  video: { ...options.video, height: next === 'source' ? 'source' : Number(next) },
                })
              }
              options={[
                { value: 'source', label: t('convert.keepSource') },
                ...VIDEO_HEIGHTS.map((height) => ({ value: String(height), label: `${height}p` })),
              ]}
            />
          )}
        </Field>
        <Field label={t('convert.fps')} inline>
          {(id) => (
            <Select
              id={id}
              value={String(options.video.fps)}
              onChange={(next) =>
                onChange({
                  ...options,
                  video: { ...options.video, fps: next === 'source' ? 'source' : Number(next) },
                })
              }
              options={[
                { value: 'source', label: t('convert.keepSource') },
                ...FRAME_RATES.map((fps) => ({ value: String(fps), label: `${fps}` })),
              ]}
            />
          )}
        </Field>
        <AudioControls
          value={options.video.audio}
          lossless={false}
          onChange={(audio) => onChange({ ...options, video: { ...options.video, audio } })}
        />
      </div>
    );
  }

  // GIF from a video is an image output but uses the video timing controls.
  if (target.id === 'gif') {
    return (
      <div className={styles.optionGroup}>
        <Field label={t('convert.resolution')} inline>
          {(id) => (
            <Select
              id={id}
              value={String(options.video.height)}
              onChange={(next) =>
                onChange({
                  ...options,
                  video: { ...options.video, height: next === 'source' ? 'source' : Number(next) },
                })
              }
              options={[
                { value: 'source', label: `${t('convert.keepSource')} (360p)` },
                ...VIDEO_HEIGHTS.filter((height) => height <= 720).map((height) => ({
                  value: String(height),
                  label: `${height}p`,
                })),
              ]}
            />
          )}
        </Field>
        <Field label={t('convert.fps')} inline>
          {(id) => (
            <Select
              id={id}
              value={String(options.video.fps)}
              onChange={(next) =>
                onChange({
                  ...options,
                  video: { ...options.video, fps: next === 'source' ? 'source' : Number(next) },
                })
              }
              options={[
                { value: 'source', label: `${t('convert.keepSource')} (12)` },
                ...FRAME_RATES.filter((fps) => fps <= 25).map((fps) => ({
                  value: String(fps),
                  label: `${fps}`,
                })),
              ]}
            />
          )}
        </Field>
      </div>
    );
  }

  const lossy = target.id === 'jpeg' || target.id === 'webp' || target.id === 'avif';
  return (
    <div className={styles.optionGroup}>
      {lossy ? (
        <Field label={t('convert.imageQuality')}>
          {(id) => (
            <Slider
              id={id}
              min={1}
              max={100}
              value={options.image.quality}
              aria-label={t('convert.imageQuality')}
              onChange={(quality) => onChange({ ...options, image: { ...options.image, quality } })}
            />
          )}
        </Field>
      ) : null}
      <Field label={t('convert.maxSize')} inline>
        {(id) => (
          <Select
            id={id}
            value={String(options.image.maxSize)}
            onChange={(next) =>
              onChange({
                ...options,
                image: { ...options.image, maxSize: next === 'source' ? 'source' : Number(next) },
              })
            }
            options={[
              { value: 'source', label: t('convert.keepSource') },
              ...[4096, 2560, 1920, 1280, 1024, 640].map((size) => ({
                value: String(size),
                label: `${size} px`,
              })),
            ]}
          />
        )}
      </Field>
    </div>
  );
}
