import { createAudio, frameCount, type AudioData, type Samples } from './buffer';
import { changeSpeed, semitonesToRatio } from './effects';

/**
 * Time stretching, so speed can change without pitch and pitch without duration.
 *
 * This is WSOLA — overlap-add with a short search for the best alignment. The
 * alternatives were worse for this project: ffmpeg's `rubberband` is not in the
 * build we ship (checked, PLAN.md §3.2), chaining ffmpeg's `atempo` would mean
 * downloading 32 MB of WebAssembly to nudge a slider, and a plain overlap-add
 * with no search produces the warbling metallic artefact everyone recognises.
 *
 * The search is what makes it sound acceptable: before adding each grain, it
 * slides it by up to a few milliseconds to find where it correlates best with
 * what has already been written, so successive grains stay in phase.
 */

/** ~46 ms at 44.1 kHz: long enough for low frequencies, short enough to track speech. */
const FRAME_SIZE = 2048;
/** How far a grain may slide to find its best fit, in samples. */
const SEARCH_RADIUS = 256;

function hannWindow(size: number): Samples {
  const window = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  }
  return window;
}

/**
 * Where to take the next grain from, so it lines up with what we just wrote.
 *
 * Correlation is computed against the overlap region only: that is the part
 * that will actually be summed, and restricting it keeps the cost linear in
 * the search radius rather than in the whole frame.
 */
function bestOffset(
  source: Samples,
  target: Samples,
  idealStart: number,
  overlapStart: number,
  overlap: number,
): number {
  let bestScore = -Infinity;
  let best = 0;

  const from = Math.max(-SEARCH_RADIUS, -idealStart);
  const to = Math.min(SEARCH_RADIUS, source.length - idealStart - overlap);

  for (let offset = from; offset <= to; offset += 1) {
    let score = 0;
    // Stepping by four samples costs a quarter as much and, at these window
    // sizes, picks the same alignment.
    for (let i = 0; i < overlap; i += 4) {
      score += source[idealStart + offset + i]! * target[overlapStart + i]!;
    }
    if (score > bestScore) {
      bestScore = score;
      best = offset;
    }
  }
  return best;
}

/**
 * Stretches a frame range by `factor` (2 = twice as long) without changing
 * pitch. Returns a new buffer; the rest of the audio is copied unchanged.
 */
export function timeStretch(
  audio: AudioData,
  from: number,
  to: number,
  factor: number,
): AudioData {
  if (factor === 1 || factor <= 0) return audio;
  const rangeLength = to - from;
  if (rangeLength < FRAME_SIZE * 2) {
    // Too short for overlap-add to mean anything; resampling is the honest
    // fallback and, at this length, nobody can hear the pitch move.
    return changeSpeed(audio, from, to, 1 / factor);
  }

  const synthesisHop = FRAME_SIZE / 2;
  const analysisHop = Math.max(1, Math.round(synthesisHop / factor));
  const overlap = FRAME_SIZE - synthesisHop;
  const window = hannWindow(FRAME_SIZE);
  const stretched = Math.max(1, Math.round(rangeLength * factor));
  const out = createAudio(audio.channels.length, frameCount(audio) - rangeLength + stretched, audio.sampleRate);

  audio.channels.forEach((channel, index) => {
    const target = out.channels[index]!;
    target.set(channel.subarray(0, from), 0);

    const range = channel.subarray(from, to);
    const written = new Float32Array(stretched + FRAME_SIZE);
    // Hann windows at 50 % overlap sum to a constant, except over the first and
    // last half-frame; this tracks the sum so those edges can be corrected.
    const weight = new Float32Array(stretched + FRAME_SIZE);

    let readAt = 0;
    let writeAt = 0;
    let firstGrain = true;

    while (writeAt < stretched && readAt + FRAME_SIZE < range.length) {
      const offset = firstGrain
        ? 0
        : bestOffset(range, written, readAt, writeAt, overlap);
      const start = Math.max(0, Math.min(range.length - FRAME_SIZE, readAt + offset));

      for (let i = 0; i < FRAME_SIZE; i += 1) {
        written[writeAt + i]! += range[start + i]! * window[i]!;
        weight[writeAt + i]! += window[i]!;
      }

      readAt += analysisHop;
      writeAt += synthesisHop;
      firstGrain = false;
    }

    for (let i = 0; i < stretched; i += 1) {
      const w = weight[i]!;
      target[from + i] = w > 1e-3 ? written[i]! / w : written[i]!;
    }
    target.set(channel.subarray(to), from + stretched);
  });

  return out;
}

/**
 * Shifts pitch without changing duration: resample (which moves pitch and
 * speed together), then stretch back to the original length.
 */
export function shiftPitch(
  audio: AudioData,
  from: number,
  to: number,
  semitones: number,
): AudioData {
  if (semitones === 0) return audio;
  const ratio = semitonesToRatio(semitones);
  const resampled = changeSpeed(audio, from, to, ratio);
  const newLength = Math.max(1, Math.round((to - from) / ratio));
  return timeStretch(resampled, from, from + newLength, ratio);
}

/** Changes speed, optionally holding the pitch where it was. */
export function changeSpeedKeepingPitch(
  audio: AudioData,
  from: number,
  to: number,
  rate: number,
  keepPitch: boolean,
): AudioData {
  if (rate === 1 || rate <= 0) return audio;
  return keepPitch ? timeStretch(audio, from, to, 1 / rate) : changeSpeed(audio, from, to, rate);
}

export { FRAME_SIZE };
