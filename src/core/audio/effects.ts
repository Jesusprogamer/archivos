import { createAudio, frameCount, fromDecibels, peakOf, type AudioData } from './buffer';

/**
 * Sample-level effects.
 *
 * These are the ones that are better written directly than built out of Web
 * Audio nodes: gain, reverse, fades and normalising are a handful of lines each
 * and run identically in a test, in a worker and on the main thread. The
 * effects that genuinely need a filter graph — equaliser, reverb, echo,
 * compressor, filters — go through `OfflineAudioContext` in `render.ts`.
 *
 * Every function here returns a new buffer and leaves its input untouched, so
 * the editor can offer a preview before anything is committed.
 */

export type EffectId =
  | 'gain'
  | 'normalize'
  | 'fadeIn'
  | 'fadeOut'
  | 'reverse'
  | 'silence'
  | 'speed'
  | 'pitch'
  | 'equalizer'
  | 'reverb'
  | 'echo'
  | 'compressor'
  | 'highpass'
  | 'lowpass';

/** Applies `transform` to one frame range, copying the rest unchanged. */
function mapRange(
  audio: AudioData,
  from: number,
  to: number,
  transform: (value: number, positionInRange: number, rangeLength: number) => number,
): AudioData {
  const length = to - from;
  return {
    sampleRate: audio.sampleRate,
    channels: audio.channels.map((channel) => {
      const out = new Float32Array(channel);
      for (let i = from; i < to; i += 1) {
        out[i] = transform(channel[i]!, i - from, length);
      }
      return out;
    }),
  };
}

export function applyGain(audio: AudioData, from: number, to: number, db: number): AudioData {
  const factor = fromDecibels(db);
  return mapRange(audio, from, to, (value) => value * factor);
}

/**
 * Scales the range so its loudest sample reaches `targetDb`.
 *
 * Peak normalising, not loudness normalising: it cannot make anything clip, and
 * it is what people expect from a button called "normalise". Silence is left
 * alone rather than amplified into noise.
 */
export function normalize(
  audio: AudioData,
  from: number,
  to: number,
  targetDb = -1,
): AudioData {
  const peak = peakOf(audio, from, to);
  if (peak <= 1e-6) return audio;
  const factor = fromDecibels(targetDb) / peak;
  return mapRange(audio, from, to, (value) => value * factor);
}

export type FadeShape = 'linear' | 'equalPower';

/**
 * Equal-power is the default for a reason: a linear fade sounds like it dips in
 * the middle, because loudness follows amplitude squared rather than amplitude.
 */
function fadeCurve(position: number, shape: FadeShape): number {
  return shape === 'linear' ? position : Math.sin((position * Math.PI) / 2);
}

export function fadeIn(
  audio: AudioData,
  from: number,
  to: number,
  shape: FadeShape = 'equalPower',
): AudioData {
  return mapRange(audio, from, to, (value, index, length) =>
    length <= 1 ? value : value * fadeCurve(index / (length - 1), shape),
  );
}

export function fadeOut(
  audio: AudioData,
  from: number,
  to: number,
  shape: FadeShape = 'equalPower',
): AudioData {
  return mapRange(audio, from, to, (value, index, length) =>
    length <= 1 ? value : value * fadeCurve(1 - index / (length - 1), shape),
  );
}

export function reverse(audio: AudioData, from: number, to: number): AudioData {
  return {
    sampleRate: audio.sampleRate,
    channels: audio.channels.map((channel) => {
      const out = new Float32Array(channel);
      for (let i = from, j = to - 1; i < to; i += 1, j -= 1) out[i] = channel[j]!;
      return out;
    }),
  };
}

export function silenceRange(audio: AudioData, from: number, to: number): AudioData {
  return mapRange(audio, from, to, () => 0);
}

/**
 * Resamples a range, which changes both its speed and its pitch.
 *
 * Linear interpolation is enough here: the ratios people actually use are
 * modest, and a polyphase resampler would be a lot of code for a difference
 * nobody would hear on a 0.8x or 1.25x change.
 */
export function changeSpeed(audio: AudioData, from: number, to: number, rate: number): AudioData {
  if (rate === 1 || rate <= 0) return audio;
  const length = to - from;
  const resampled = Math.max(1, Math.round(length / rate));
  const total = frameCount(audio) - length + resampled;
  const out = createAudio(audio.channels.length, total, audio.sampleRate);

  audio.channels.forEach((channel, index) => {
    const target = out.channels[index]!;
    target.set(channel.subarray(0, from), 0);
    for (let i = 0; i < resampled; i += 1) {
      const source = from + i * rate;
      const base = Math.floor(source);
      const fraction = source - base;
      const a = channel[Math.min(to - 1, base)] ?? 0;
      const b = channel[Math.min(to - 1, base + 1)] ?? a;
      target[from + i] = a + (b - a) * fraction;
    }
    target.set(channel.subarray(to), from + resampled);
  });

  return out;
}

export function semitonesToRatio(semitones: number): number {
  return 2 ** (semitones / 12);
}

/** Frequency bands for the graphic equaliser, in Hz. */
export const EQ_BANDS = [60, 170, 350, 1000, 3500, 10000] as const;

export interface EqualizerSettings {
  /** Gain in dB for each band in `EQ_BANDS`. */
  readonly gains: readonly number[];
}

export interface ReverbSettings {
  /** Seconds of tail. */
  readonly decay: number;
  /** 0–1 wet/dry balance. */
  readonly mix: number;
}

export interface EchoSettings {
  readonly delay: number;
  readonly feedback: number;
  readonly mix: number;
}

export interface CompressorSettings {
  readonly threshold: number;
  readonly ratio: number;
  readonly attack: number;
  readonly release: number;
}

export interface FilterSettings {
  readonly frequency: number;
  readonly q: number;
}

export interface PitchSettings {
  /** Semitones, positive or negative. */
  readonly semitones: number;
}

export interface SpeedSettings {
  readonly rate: number;
  /** When false, the pitch is corrected back after the speed change. */
  readonly keepPitch: boolean;
}

export type EffectSettings =
  | { readonly id: 'gain'; readonly db: number }
  | { readonly id: 'normalize'; readonly targetDb: number }
  | { readonly id: 'fadeIn'; readonly shape: FadeShape }
  | { readonly id: 'fadeOut'; readonly shape: FadeShape }
  | { readonly id: 'reverse' }
  | { readonly id: 'silence' }
  | { readonly id: 'speed'; readonly settings: SpeedSettings }
  | { readonly id: 'pitch'; readonly settings: PitchSettings }
  | { readonly id: 'equalizer'; readonly settings: EqualizerSettings }
  | { readonly id: 'reverb'; readonly settings: ReverbSettings }
  | { readonly id: 'echo'; readonly settings: EchoSettings }
  | { readonly id: 'compressor'; readonly settings: CompressorSettings }
  | { readonly id: 'highpass'; readonly settings: FilterSettings }
  | { readonly id: 'lowpass'; readonly settings: FilterSettings };

export const DEFAULT_SETTINGS: Record<EffectId, EffectSettings> = {
  gain: { id: 'gain', db: 0 },
  normalize: { id: 'normalize', targetDb: -1 },
  fadeIn: { id: 'fadeIn', shape: 'equalPower' },
  fadeOut: { id: 'fadeOut', shape: 'equalPower' },
  reverse: { id: 'reverse' },
  silence: { id: 'silence' },
  speed: { id: 'speed', settings: { rate: 1, keepPitch: true } },
  pitch: { id: 'pitch', settings: { semitones: 0 } },
  equalizer: { id: 'equalizer', settings: { gains: EQ_BANDS.map(() => 0) } },
  reverb: { id: 'reverb', settings: { decay: 1.8, mix: 0.3 } },
  echo: { id: 'echo', settings: { delay: 0.3, feedback: 0.35, mix: 0.4 } },
  compressor: { id: 'compressor', settings: { threshold: -24, ratio: 4, attack: 0.003, release: 0.25 } },
  highpass: { id: 'highpass', settings: { frequency: 120, q: 0.7 } },
  lowpass: { id: 'lowpass', settings: { frequency: 8000, q: 0.7 } },
};

/** Effects that can be done on the samples directly, with no filter graph. */
export const DIRECT_EFFECTS: ReadonlySet<EffectId> = new Set([
  'gain',
  'normalize',
  'fadeIn',
  'fadeOut',
  'reverse',
  'silence',
]);

/** Applies a direct effect. Graph effects are handled by `render.ts`. */
export function applyDirect(
  audio: AudioData,
  from: number,
  to: number,
  effect: EffectSettings,
): AudioData {
  switch (effect.id) {
    case 'gain':
      return applyGain(audio, from, to, effect.db);
    case 'normalize':
      return normalize(audio, from, to, effect.targetDb);
    case 'fadeIn':
      return fadeIn(audio, from, to, effect.shape);
    case 'fadeOut':
      return fadeOut(audio, from, to, effect.shape);
    case 'reverse':
      return reverse(audio, from, to);
    case 'silence':
      return silenceRange(audio, from, to);
    default:
      return audio;
  }
}
