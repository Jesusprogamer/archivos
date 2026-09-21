import {
  EQ_BANDS,
  type EffectSettings,
  type FadeShape,
} from '../../core/audio/effects';
import { useT } from '../../i18n';
import { Field } from '../../ui/Field';
import { Notice } from '../../ui/Notice';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Slider } from '../../ui/Slider';
import { Switch } from '../../ui/Switch';

/**
 * Controls for whichever effect is selected.
 *
 * Every parameter here maps to something the renderer genuinely uses; there are
 * no decorative knobs. The ranges are the useful ones rather than the ones the
 * underlying node technically accepts — a compressor ratio of 20:1 is a limiter
 * and 40:1 is nothing anyone reaches for.
 */
export function EffectParams({
  effect,
  onChange,
}: {
  effect: EffectSettings;
  onChange: (effect: EffectSettings) => void;
}) {
  const t = useT();

  const slider = (
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    apply: (next: number) => EffectSettings,
    suffix?: string,
  ) => (
    <Field label={label} key={label}>
      {(id) => (
        <Slider
          id={id}
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={label}
          {...(suffix ? { suffix } : {})}
          onChange={(next) => onChange(apply(next))}
        />
      )}
    </Field>
  );

  switch (effect.id) {
    case 'gain':
      return slider(t('audio.param.gainDb'), effect.db, -40, 20, 0.5, (db) => ({ id: 'gain', db }), 'dB');

    case 'normalize':
      return slider(
        t('audio.param.targetDb'),
        effect.targetDb,
        -12,
        0,
        0.5,
        (targetDb) => ({ id: 'normalize', targetDb }),
        'dB',
      );

    case 'fadeIn':
    case 'fadeOut':
      return (
        <Field label={t('audio.param.shape')}>
          {() => (
            <SegmentedControl<FadeShape>
              block
              value={effect.shape}
              label={t('audio.param.shape')}
              onChange={(shape) => onChange({ id: effect.id, shape })}
              segments={[
                { value: 'equalPower', label: t('audio.param.shape.equalPower') },
                { value: 'linear', label: t('audio.param.shape.linear') },
              ]}
            />
          )}
        </Field>
      );

    case 'speed':
      return (
        <>
          {slider(
            t('audio.param.rate'),
            effect.settings.rate,
            0.25,
            4,
            0.05,
            (rate) => ({ id: 'speed', settings: { ...effect.settings, rate } }),
            '×',
          )}
          <Switch
            label={t('audio.param.keepPitch')}
            checked={effect.settings.keepPitch}
            onChange={(keepPitch) =>
              onChange({ id: 'speed', settings: { ...effect.settings, keepPitch } })
            }
          />
          {effect.settings.keepPitch ? <Notice tone="info">{t('audio.stretchNote')}</Notice> : null}
        </>
      );

    case 'pitch':
      return (
        <>
          {slider(
            t('audio.param.semitones'),
            effect.settings.semitones,
            -12,
            12,
            1,
            (semitones) => ({ id: 'pitch', settings: { semitones } }),
          )}
          <Notice tone="info">{t('audio.stretchNote')}</Notice>
        </>
      );

    case 'equalizer':
      return (
        <>
          {EQ_BANDS.map((hz, index) =>
            slider(
              t('audio.param.band', { hz }),
              effect.settings.gains[index] ?? 0,
              -18,
              18,
              0.5,
              (gain) => ({
                id: 'equalizer',
                settings: {
                  gains: effect.settings.gains.map((value, i) => (i === index ? gain : value)),
                },
              }),
              'dB',
            ),
          )}
        </>
      );

    case 'reverb':
      return (
        <>
          {slider(
            t('audio.param.decay'),
            effect.settings.decay,
            0.2,
            6,
            0.1,
            (decay) => ({ id: 'reverb', settings: { ...effect.settings, decay } }),
            's',
          )}
          {slider(
            t('audio.param.mix'),
            effect.settings.mix,
            0,
            1,
            0.05,
            (mix) => ({ id: 'reverb', settings: { ...effect.settings, mix } }),
          )}
        </>
      );

    case 'echo':
      return (
        <>
          {slider(
            t('audio.param.delay'),
            effect.settings.delay,
            0.02,
            2,
            0.01,
            (delay) => ({ id: 'echo', settings: { ...effect.settings, delay } }),
            's',
          )}
          {slider(
            t('audio.param.feedback'),
            effect.settings.feedback,
            0,
            0.95,
            0.05,
            (feedback) => ({ id: 'echo', settings: { ...effect.settings, feedback } }),
          )}
          {slider(
            t('audio.param.mix'),
            effect.settings.mix,
            0,
            1,
            0.05,
            (mix) => ({ id: 'echo', settings: { ...effect.settings, mix } }),
          )}
        </>
      );

    case 'compressor':
      return (
        <>
          {slider(
            t('audio.param.threshold'),
            effect.settings.threshold,
            -60,
            0,
            1,
            (threshold) => ({ id: 'compressor', settings: { ...effect.settings, threshold } }),
            'dB',
          )}
          {slider(
            t('audio.param.ratio'),
            effect.settings.ratio,
            1,
            20,
            0.5,
            (ratio) => ({ id: 'compressor', settings: { ...effect.settings, ratio } }),
            ':1',
          )}
          {slider(
            t('audio.param.attack'),
            effect.settings.attack,
            0,
            0.5,
            0.001,
            (attack) => ({ id: 'compressor', settings: { ...effect.settings, attack } }),
            's',
          )}
          {slider(
            t('audio.param.release'),
            effect.settings.release,
            0.01,
            1,
            0.01,
            (release) => ({ id: 'compressor', settings: { ...effect.settings, release } }),
            's',
          )}
        </>
      );

    case 'highpass':
    case 'lowpass':
      return (
        <>
          {slider(
            t('audio.param.frequency'),
            effect.settings.frequency,
            20,
            18000,
            10,
            (frequency) => ({ id: effect.id, settings: { ...effect.settings, frequency } }),
            'Hz',
          )}
          {slider(
            t('audio.param.q'),
            effect.settings.q,
            0.1,
            8,
            0.1,
            (q) => ({ id: effect.id, settings: { ...effect.settings, q } }),
          )}
        </>
      );

    default:
      // Reverse and silence take no parameters; saying so beats an empty box.
      return null;
  }
}
