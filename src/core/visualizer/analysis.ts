import type { AudioData } from '../audio/buffer';

/**
 * Turning audio into numbers a visualiser can draw.
 *
 * Analysis happens **ahead of playback**, not through an `AnalyserNode`. That
 * choice is what makes the export deterministic: an `AnalyserNode` reports
 * whatever happens to be in its buffer when you ask, which depends on timing
 * and would give a different video every run. Here, frame *n* always produces
 * exactly the same spectrum.
 */

export interface AnalysisOptions {
  /** Power of two. 2048 gives ~23 Hz resolution at 44.1 kHz. */
  readonly fftSize: number;
  /** Output frames per second — matches the video being produced. */
  readonly fps: number;
  /** 0–1. How much of the previous frame carries over. */
  readonly smoothing: number;
  /** Number of bands the drawing code wants. */
  readonly bands: number;
  /** Ignore everything outside this range, in Hz. */
  readonly minFrequency: number;
  readonly maxFrequency: number;
}

export const DEFAULT_ANALYSIS: AnalysisOptions = {
  fftSize: 2048,
  fps: 30,
  smoothing: 0.65,
  bands: 64,
  minFrequency: 30,
  maxFrequency: 16000,
};

export interface Frame {
  /** `bands` values, 0–1. */
  readonly bands: Float32Array;
  /** Overall level, 0–1. */
  readonly level: number;
  /** Energy below ~150 Hz, 0–1 — what "react to the bass" means. */
  readonly bass: number;
  /** The raw waveform for this frame, 0–1 centred on 0.5. */
  readonly wave: Float32Array;
}

/**
 * An in-place iterative radix-2 FFT.
 *
 * Written out rather than pulled in: the whole thing is forty lines, a
 * dependency would be another package to audit and licence, and this runs once
 * per frame on a few thousand samples.
 */
export function fft(real: Float32Array, imaginary: Float32Array): void {
  const n = real.length;
  if (n <= 1) return;

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j]!, real[i]!];
      [imaginary[i], imaginary[j]] = [imaginary[j]!, imaginary[i]!];
    }
  }

  for (let length = 2; length <= n; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);

    for (let start = 0; start < n; start += length) {
      let wReal = 1;
      let wImaginary = 0;
      for (let offset = 0; offset < length / 2; offset += 1) {
        const a = start + offset;
        const b = a + length / 2;
        const tReal = wReal * real[b]! - wImaginary * imaginary[b]!;
        const tImaginary = wReal * imaginary[b]! + wImaginary * real[b]!;
        real[b] = real[a]! - tReal;
        imaginary[b] = imaginary[a]! - tImaginary;
        real[a] = real[a]! + tReal;
        imaginary[a] = imaginary[a]! + tImaginary;
        const nextReal = wReal * stepReal - wImaginary * stepImaginary;
        wImaginary = wReal * stepImaginary + wImaginary * stepReal;
        wReal = nextReal;
      }
    }
  }
}

function hann(size: number): Float32Array {
  const window = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  }
  return window;
}

/**
 * Band edges spaced logarithmically.
 *
 * Linear bins would give a visualiser where nine tenths of the bars cover
 * frequencies nobody can pick out, and the bass — the part that actually moves
 * — is squeezed into the first two. Pitch is logarithmic, so the bands are too.
 */
export function bandEdges(
  bands: number,
  minFrequency: number,
  maxFrequency: number,
  sampleRate: number,
  fftSize: number,
): number[] {
  const binCount = fftSize / 2;
  const nyquist = sampleRate / 2;
  const edges: number[] = [];
  for (let i = 0; i <= bands; i += 1) {
    const frequency =
      minFrequency * (maxFrequency / minFrequency) ** (i / bands);
    edges.push(Math.min(binCount - 1, Math.round((frequency / nyquist) * binCount)));
  }
  return edges;
}

/** Magnitude in decibels to a 0–1 value, with a floor. */
function normaliseDb(magnitude: number, floorDb = -70): number {
  const db = 20 * Math.log10(Math.max(magnitude, 1e-7));
  return Math.max(0, Math.min(1, (db - floorDb) / -floorDb));
}

/**
 * Analyses the whole track up front, one entry per output frame.
 *
 * Memory is modest and predictable: 64 bands plus 128 wave points per frame is
 * under a kilobyte, so a five-minute track at 30 fps costs a few megabytes.
 */
export function analyse(audio: AudioData, options: AnalysisOptions): Frame[] {
  const { fftSize, fps, smoothing, bands, minFrequency, maxFrequency } = options;
  const channel = audio.channels[0];
  if (!channel || channel.length === 0) return [];

  // Mono sum: a visualiser reacting to one channel of a stereo mix looks wrong
  // whenever the music is panned.
  const mono = new Float32Array(channel.length);
  for (let i = 0; i < channel.length; i += 1) {
    let sum = 0;
    for (const c of audio.channels) sum += c[i] ?? 0;
    mono[i] = sum / audio.channels.length;
  }

  const window = hann(fftSize);
  const edges = bandEdges(bands, minFrequency, maxFrequency, audio.sampleRate, fftSize);
  const bassEdge = Math.max(
    1,
    Math.round((150 / (audio.sampleRate / 2)) * (fftSize / 2)),
  );

  const totalFrames = Math.max(1, Math.ceil((mono.length / audio.sampleRate) * fps));
  const frames: Frame[] = [];
  const smoothed = new Float32Array(bands);

  const real = new Float32Array(fftSize);
  const imaginary = new Float32Array(fftSize);
  const WAVE_POINTS = 128;

  for (let frame = 0; frame < totalFrames; frame += 1) {
    // Centre the window on the frame's moment, so a peak lines up with the
    // picture instead of trailing it by half a window.
    const centre = Math.round((frame / fps) * audio.sampleRate);
    const start = Math.max(0, Math.min(mono.length - fftSize, centre - fftSize / 2));

    real.fill(0);
    imaginary.fill(0);
    let sumSquares = 0;
    for (let i = 0; i < fftSize; i += 1) {
      const sample = mono[start + i] ?? 0;
      real[i] = sample * window[i]!;
      sumSquares += sample * sample;
    }
    fft(real, imaginary);

    const values = new Float32Array(bands);
    for (let band = 0; band < bands; band += 1) {
      const from = edges[band]!;
      const to = Math.max(from + 1, edges[band + 1]!);
      let peak = 0;
      for (let bin = from; bin < to; bin += 1) {
        const magnitude =
          Math.hypot(real[bin]!, imaginary[bin]!) / (fftSize / 4);
        if (magnitude > peak) peak = magnitude;
      }
      const value = normaliseDb(peak);
      // Smoothing is one-sided: rises are instant, falls are eased. A bar that
      // lags the attack of a drum looks broken; one that falls slowly does not.
      smoothed[band] =
        value > smoothed[band]! ? value : smoothed[band]! * smoothing + value * (1 - smoothing);
      values[band] = smoothed[band]!;
    }

    let bass = 0;
    for (let bin = 1; bin < bassEdge; bin += 1) {
      bass = Math.max(bass, Math.hypot(real[bin]!, imaginary[bin]!) / (fftSize / 4));
    }

    const wave = new Float32Array(WAVE_POINTS);
    const step = Math.max(1, Math.floor(fftSize / WAVE_POINTS));
    for (let i = 0; i < WAVE_POINTS; i += 1) {
      wave[i] = (mono[start + i * step] ?? 0) * 0.5 + 0.5;
    }

    frames.push({
      bands: values,
      level: Math.min(1, Math.sqrt(sumSquares / fftSize) * 3),
      bass: normaliseDb(bass),
      wave,
    });
  }

  return frames;
}
