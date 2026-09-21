import { createAudio, frameCount, type AudioData } from './buffer';
import { EQ_BANDS, type EffectSettings } from './effects';

/**
 * Effects that need a filter graph, rendered with `OfflineAudioContext`.
 *
 * The browser's own biquads, convolver and compressor are well-tested, fast and
 * identical to what plays back live, so there is no reason to reimplement them.
 * What this module adds is the range handling and the tail handling described
 * below.
 */

type ContextConstructor = new (
  channels: number,
  length: number,
  sampleRate: number,
) => OfflineAudioContext;

function offlineContext(channels: number, length: number, sampleRate: number): OfflineAudioContext {
  const Ctor = (globalThis.OfflineAudioContext ??
    (globalThis as { webkitOfflineAudioContext?: ContextConstructor })
      .webkitOfflineAudioContext) as ContextConstructor | undefined;
  if (!Ctor) throw new Error('OfflineAudioContext is unavailable in this browser');
  return new Ctor(channels, length, sampleRate);
}

function toAudioBuffer(context: BaseAudioContext, audio: AudioData, from: number, to: number) {
  const frames = Math.max(1, to - from);
  const buffer = context.createBuffer(audio.channels.length, frames, audio.sampleRate);
  audio.channels.forEach((channel, index) => {
    buffer.copyToChannel(channel.subarray(from, to), index);
  });
  return buffer;
}

function fromAudioBuffer(buffer: AudioBuffer): AudioData {
  return {
    sampleRate: buffer.sampleRate,
    channels: Array.from({ length: buffer.numberOfChannels }, (_, index) =>
      buffer.getChannelData(index).slice(),
    ),
  };
}

/**
 * A decaying noise burst, used as the reverb's impulse response.
 *
 * Generated rather than shipped: a real recorded impulse is a megabyte or more
 * per preset, which is a poor trade for an effect whose whole job here is
 * "add some space". The exponential decay with a slight low-pass tilt is the
 * standard synthetic approximation and sounds like a plausible room.
 */
function impulseResponse(context: BaseAudioContext, seconds: number, sampleRate: number) {
  const frames = Math.max(1, Math.floor(seconds * sampleRate));
  const buffer = context.createBuffer(2, frames, sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    let previous = 0;
    for (let i = 0; i < frames; i += 1) {
      const decay = (1 - i / frames) ** 2.5;
      const noise = Math.random() * 2 - 1;
      // A one-pole low pass: high frequencies die away faster in a real room.
      previous = previous * 0.35 + noise * 0.65;
      data[i] = previous * decay;
    }
  }
  return buffer;
}

/** Extra time to render past the range, so a tail is not chopped off. */
function tailSeconds(effect: EffectSettings): number {
  if (effect.id === 'reverb') return effect.settings.decay + 0.2;
  if (effect.id === 'echo') {
    // Enough repeats for the feedback to fall below about -60 dB.
    const repeats = effect.settings.feedback <= 0 ? 1 : Math.min(40, Math.ceil(-3 / Math.log10(Math.max(0.01, effect.settings.feedback))));
    return effect.settings.delay * repeats;
  }
  return 0;
}

/** Wires the graph for one effect and returns the node the source feeds. */
function buildGraph(context: OfflineAudioContext, effect: EffectSettings): AudioNode {
  switch (effect.id) {
    case 'equalizer': {
      // Bands in series, each a peaking filter — the usual graphic EQ shape.
      const filters = EQ_BANDS.map((frequency, index) => {
        const filter = context.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = frequency;
        filter.Q.value = 1.1;
        filter.gain.value = effect.settings.gains[index] ?? 0;
        return filter;
      });
      filters.forEach((filter, index) => {
        const next = filters[index + 1];
        if (next) filter.connect(next);
        else filter.connect(context.destination);
      });
      return filters[0]!;
    }

    case 'reverb': {
      const input = context.createGain();
      const wet = context.createGain();
      const dry = context.createGain();
      const convolver = context.createConvolver();
      convolver.buffer = impulseResponse(context, effect.settings.decay, context.sampleRate);
      wet.gain.value = effect.settings.mix;
      dry.gain.value = 1 - effect.settings.mix;
      input.connect(convolver);
      convolver.connect(wet);
      wet.connect(context.destination);
      input.connect(dry);
      dry.connect(context.destination);
      return input;
    }

    case 'echo': {
      const input = context.createGain();
      const delay = context.createDelay(Math.max(0.01, effect.settings.delay) + 1);
      const feedback = context.createGain();
      const wet = context.createGain();
      const dry = context.createGain();
      delay.delayTime.value = effect.settings.delay;
      // Clamped below 1: at or above it, the feedback loop never decays.
      feedback.gain.value = Math.min(0.95, effect.settings.feedback);
      wet.gain.value = effect.settings.mix;
      dry.gain.value = 1 - effect.settings.mix * 0.5;
      input.connect(delay);
      delay.connect(feedback);
      feedback.connect(delay);
      delay.connect(wet);
      wet.connect(context.destination);
      input.connect(dry);
      dry.connect(context.destination);
      return input;
    }

    case 'compressor': {
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = effect.settings.threshold;
      compressor.ratio.value = effect.settings.ratio;
      compressor.attack.value = effect.settings.attack;
      compressor.release.value = effect.settings.release;
      compressor.knee.value = 6;
      compressor.connect(context.destination);
      return compressor;
    }

    case 'highpass':
    case 'lowpass': {
      const filter = context.createBiquadFilter();
      filter.type = effect.id;
      filter.frequency.value = effect.settings.frequency;
      filter.Q.value = effect.settings.q;
      filter.connect(context.destination);
      return filter;
    }

    default: {
      const pass = context.createGain();
      pass.connect(context.destination);
      return pass;
    }
  }
}

/**
 * Applies a graph effect to a frame range.
 *
 * Reverb and echo produce sound after the range ends. Rather than truncating
 * that tail — which leaves an audible chop — the extra samples are mixed into
 * the audio that follows, so the effect rings out over it the way it would if
 * the whole thing had been played.
 */
export async function renderEffect(
  audio: AudioData,
  from: number,
  to: number,
  effect: EffectSettings,
): Promise<AudioData> {
  const rangeLength = to - from;
  if (rangeLength <= 0) return audio;

  const tail = Math.round(tailSeconds(effect) * audio.sampleRate);
  const context = offlineContext(audio.channels.length, rangeLength + tail, audio.sampleRate);
  const source = context.createBufferSource();
  source.buffer = toAudioBuffer(context, audio, from, to);
  source.connect(buildGraph(context, effect));
  source.start();

  const rendered = fromAudioBuffer(await context.startRendering());
  const total = frameCount(audio);
  const out = createAudio(audio.channels.length, total, audio.sampleRate);

  audio.channels.forEach((channel, index) => {
    const target = out.channels[index]!;
    const wet = rendered.channels[index] ?? rendered.channels[0]!;
    target.set(channel, 0);
    for (let i = 0; i < rangeLength; i += 1) target[from + i] = wet[i]!;
    // Mix the tail onto whatever comes next instead of cutting it dead.
    for (let i = 0; i < tail && to + i < total; i += 1) {
      target[to + i] = channel[to + i]! + wet[rangeLength + i]!;
    }
  });

  return out;
}

/**
 * Decodes any audio the browser can read.
 *
 * `decodeAudioData` detaches the buffer it is given, so the caller's copy would
 * become unusable — hence the slice.
 */
export async function decodeAudio(file: Blob): Promise<AudioData> {
  const AudioContextCtor =
    globalThis.AudioContext ??
    (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) throw new Error('Web Audio is unavailable in this browser');

  const context = new AudioContextCtor();
  try {
    const buffer = await context.decodeAudioData((await file.arrayBuffer()).slice(0));
    return fromAudioBuffer(buffer);
  } finally {
    void context.close();
  }
}

export { fromAudioBuffer, toAudioBuffer };
