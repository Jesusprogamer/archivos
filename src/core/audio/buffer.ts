/**
 * Audio buffers, kept as plain Float32 channel arrays rather than as
 * `AudioBuffer` objects.
 *
 * An `AudioBuffer` belongs to an `AudioContext` and cannot be created without
 * one, which rules out using it in a worker or in a unit test. Plain arrays go
 * anywhere, and converting to an `AudioBuffer` for playback is a copy of a few
 * milliseconds.
 */

/**
 * A sample buffer that is definitely backed by a plain `ArrayBuffer`.
 *
 * The Web Audio types accept only `ArrayBuffer`-backed arrays, while a bare
 * `Float32Array` may be backed by a `SharedArrayBuffer`. Narrowing once here
 * keeps casts out of the rest of the audio code.
 */
export type Samples = Float32Array<ArrayBuffer>;

export function samples(length: number): Samples {
  return new Float32Array(length);
}

export interface AudioData {
  readonly sampleRate: number;
  /** One array of samples per channel, all the same length. */
  readonly channels: readonly Samples[];
}

export function durationOf(audio: AudioData): number {
  return (audio.channels[0]?.length ?? 0) / audio.sampleRate;
}

export function frameCount(audio: AudioData): number {
  return audio.channels[0]?.length ?? 0;
}

export function createAudio(
  channelCount: number,
  frames: number,
  sampleRate: number,
): AudioData {
  return {
    sampleRate,
    channels: Array.from({ length: channelCount }, () => new Float32Array(frames)),
  };
}

export function cloneAudio(audio: AudioData): AudioData {
  return {
    sampleRate: audio.sampleRate,
    channels: audio.channels.map((channel) => new Float32Array(channel)),
  };
}

export function audioBytes(audio: AudioData): number {
  return audio.channels.reduce((sum, channel) => sum + channel.byteLength, 0);
}

/** A time in seconds to the nearest frame, clamped to the buffer. */
export function frameAt(audio: AudioData, seconds: number): number {
  return Math.max(0, Math.min(frameCount(audio), Math.round(seconds * audio.sampleRate)));
}

export interface Selection {
  /** Seconds. `start === end` means "no selection", i.e. the whole buffer. */
  readonly start: number;
  readonly end: number;
}

export function isEmptySelection(selection: Selection | undefined): boolean {
  return !selection || selection.end - selection.start < 1e-6;
}

/** The frame range an operation applies to: the selection, or everything. */
export function rangeOf(audio: AudioData, selection: Selection | undefined): [number, number] {
  if (isEmptySelection(selection)) return [0, frameCount(audio)];
  return [frameAt(audio, selection!.start), frameAt(audio, selection!.end)];
}

/** Copies a frame range into a new buffer. */
export function sliceAudio(audio: AudioData, from: number, to: number): AudioData {
  const start = Math.max(0, Math.min(from, to));
  const end = Math.min(frameCount(audio), Math.max(from, to));
  return {
    sampleRate: audio.sampleRate,
    channels: audio.channels.map((channel) => channel.slice(start, end)),
  };
}

/** Removes a frame range, closing the gap. */
export function cutRange(audio: AudioData, from: number, to: number): AudioData {
  const start = Math.max(0, Math.min(from, to));
  const end = Math.min(frameCount(audio), Math.max(from, to));
  const removed = end - start;
  if (removed <= 0) return audio;

  return {
    sampleRate: audio.sampleRate,
    channels: audio.channels.map((channel) => {
      const out = new Float32Array(channel.length - removed);
      out.set(channel.subarray(0, start), 0);
      out.set(channel.subarray(end), start);
      return out;
    }),
  };
}

/**
 * Inserts one buffer into another at a frame position.
 *
 * Channel counts are reconciled rather than rejected: pasting a mono clip into
 * a stereo recording is an ordinary thing to want, and duplicating the single
 * channel is what every editor does.
 */
export function insertAudio(audio: AudioData, clip: AudioData, at: number): AudioData {
  const position = Math.max(0, Math.min(frameCount(audio), at));
  const clipFrames = frameCount(clip);
  if (clipFrames === 0) return audio;

  return {
    sampleRate: audio.sampleRate,
    channels: audio.channels.map((channel, index) => {
      const source = clip.channels[index] ?? clip.channels[0]!;
      const out = new Float32Array(channel.length + clipFrames);
      out.set(channel.subarray(0, position), 0);
      out.set(source.subarray(0, clipFrames), position);
      out.set(channel.subarray(position), position + clipFrames);
      return out;
    }),
  };
}

/** Inserts silence, which is an insert of an empty buffer. */
export function insertSilence(audio: AudioData, at: number, seconds: number): AudioData {
  const frames = Math.round(seconds * audio.sampleRate);
  if (frames <= 0) return audio;
  return insertAudio(audio, createAudio(audio.channels.length, frames, audio.sampleRate), at);
}

/** The peak absolute sample in a range — what a normalise pass needs. */
export function peakOf(audio: AudioData, from = 0, to = frameCount(audio)): number {
  let peak = 0;
  for (const channel of audio.channels) {
    for (let i = from; i < to; i += 1) {
      const value = Math.abs(channel[i]!);
      if (value > peak) peak = value;
    }
  }
  return peak;
}

/** Root-mean-square level over a range, for the loudness meter. */
export function rmsOf(audio: AudioData, from = 0, to = frameCount(audio)): number {
  let sum = 0;
  let count = 0;
  for (const channel of audio.channels) {
    for (let i = from; i < to; i += 1) {
      sum += channel[i]! * channel[i]!;
      count += 1;
    }
  }
  return count === 0 ? 0 : Math.sqrt(sum / count);
}

export function toDecibels(amplitude: number): number {
  return amplitude <= 1e-6 ? -Infinity : 20 * Math.log10(amplitude);
}

export function fromDecibels(db: number): number {
  return 10 ** (db / 20);
}
