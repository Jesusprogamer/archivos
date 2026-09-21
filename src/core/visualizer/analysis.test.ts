import { describe, expect, it } from 'vitest';
import type { AudioData } from '../audio/buffer';
import { DEFAULT_ANALYSIS, analyse, bandEdges, fft } from './analysis';

const RATE = 44100;

function sine(frequency: number, seconds: number, amplitude = 0.8): AudioData {
  const frames = Math.round(seconds * RATE);
  const channel = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    channel[i] = Math.sin((2 * Math.PI * frequency * i) / RATE) * amplitude;
  }
  return { sampleRate: RATE, channels: [channel] };
}

function silence(seconds: number): AudioData {
  return { sampleRate: RATE, channels: [new Float32Array(Math.round(seconds * RATE))] };
}

describe('fft', () => {
  it('puts a pure tone in the bin that matches its frequency', () => {
    const size = 1024;
    const real = new Float32Array(size);
    const imaginary = new Float32Array(size);
    // Exactly 8 cycles across the window lands in bin 8.
    for (let i = 0; i < size; i += 1) real[i] = Math.cos((2 * Math.PI * 8 * i) / size);
    fft(real, imaginary);

    const magnitudes = Array.from({ length: size / 2 }, (_, bin) =>
      Math.hypot(real[bin]!, imaginary[bin]!),
    );
    const loudest = magnitudes.indexOf(Math.max(...magnitudes));
    expect(loudest).toBe(8);
  });

  it('leaves a constant signal entirely in bin zero', () => {
    const size = 64;
    const real = new Float32Array(size).fill(1);
    const imaginary = new Float32Array(size);
    fft(real, imaginary);
    expect(real[0]).toBeCloseTo(size, 4);
    expect(Math.hypot(real[1]!, imaginary[1]!)).toBeCloseTo(0, 4);
  });

  it('handles a trivial input without dividing by zero', () => {
    const real = new Float32Array([1]);
    const imaginary = new Float32Array([0]);
    expect(() => fft(real, imaginary)).not.toThrow();
  });
});

describe('bandEdges', () => {
  it('returns one more edge than there are bands', () => {
    expect(bandEdges(16, 30, 16000, RATE, 2048)).toHaveLength(17);
  });

  it('spaces bands logarithmically, not linearly', () => {
    const edges = bandEdges(8, 30, 16000, RATE, 2048);
    const first = edges[1]! - edges[0]!;
    const last = edges[8]! - edges[7]!;
    // The top band covers far more bins than the bottom one.
    expect(last).toBeGreaterThan(first * 5);
  });

  it('never runs past the last usable bin', () => {
    const edges = bandEdges(32, 30, 40000, RATE, 512);
    expect(Math.max(...edges)).toBeLessThan(512 / 2);
  });

  it('rises monotonically', () => {
    const edges = bandEdges(24, 30, 16000, RATE, 2048);
    for (let i = 1; i < edges.length; i += 1) {
      expect(edges[i]!).toBeGreaterThanOrEqual(edges[i - 1]!);
    }
  });
});

describe('analyse', () => {
  const options = { ...DEFAULT_ANALYSIS, fps: 10, bands: 32 };

  it('produces one frame per output frame', () => {
    const frames = analyse(sine(440, 2), options);
    expect(frames).toHaveLength(20);
    expect(frames[0]!.bands).toHaveLength(32);
  });

  it('is deterministic: the same audio gives byte-identical frames', () => {
    const audio = sine(440, 1);
    const first = analyse(audio, options);
    const second = analyse(audio, options);
    expect([...first[5]!.bands]).toEqual([...second[5]!.bands]);
    expect(first[5]!.level).toBe(second[5]!.level);
  });

  it('puts a bass tone in the low bands and a treble tone in the high ones', () => {
    const low = analyse(sine(80, 1), options)[5]!;
    const high = analyse(sine(8000, 1), options)[5]!;

    const lowHalf = (frame: typeof low) =>
      [...frame.bands].slice(0, 8).reduce((a, b) => a + b, 0);
    const highHalf = (frame: typeof low) =>
      [...frame.bands].slice(24).reduce((a, b) => a + b, 0);

    expect(lowHalf(low)).toBeGreaterThan(highHalf(low));
    expect(highHalf(high)).toBeGreaterThan(lowHalf(high));
  });

  it('reports bass energy for a low tone and almost none for a high one', () => {
    expect(analyse(sine(60, 1), options)[5]!.bass).toBeGreaterThan(0.5);
    expect(analyse(sine(9000, 1), options)[5]!.bass).toBeLessThan(0.2);
  });

  it('reports a higher level for louder audio', () => {
    const quiet = analyse(sine(440, 1, 0.1), options)[5]!.level;
    const loud = analyse(sine(440, 1, 0.9), options)[5]!.level;
    expect(loud).toBeGreaterThan(quiet * 3);
  });

  it('reports silence as silence, not as noise', () => {
    const frame = analyse(silence(1), options)[5]!;
    expect(frame.level).toBeCloseTo(0, 5);
    expect([...frame.bands].every((value) => value < 0.05)).toBe(true);
  });

  it('rises instantly and falls gradually', () => {
    // Silence, then a tone: the first loud frame must already be loud.
    const frames = Math.round(0.5 * RATE);
    const channel = new Float32Array(frames * 2);
    for (let i = frames; i < channel.length; i += 1) {
      channel[i] = Math.sin((2 * Math.PI * 440 * i) / RATE) * 0.9;
    }
    const analysed = analyse({ sampleRate: RATE, channels: [channel] }, options);
    const onset = analysed.findIndex((frame) => frame.level > 0.3);
    expect(onset).toBeGreaterThan(0);
    // One frame after the onset it is already at full strength, not ramping.
    expect(analysed[onset + 1]!.level).toBeGreaterThan(0.3);
  });

  it('includes a waveform centred on a half', () => {
    const frame = analyse(silence(1), options)[3]!;
    expect(frame.wave).toHaveLength(128);
    expect([...frame.wave].every((value) => Math.abs(value - 0.5) < 1e-6)).toBe(true);
  });

  it('returns nothing for an empty buffer instead of throwing', () => {
    expect(analyse({ sampleRate: RATE, channels: [] }, options)).toEqual([]);
    expect(analyse(silence(0), options)).toEqual([]);
  });

  it('mixes channels down, so panned music still reacts', () => {
    const frames = Math.round(0.5 * RATE);
    const left = new Float32Array(frames);
    for (let i = 0; i < frames; i += 1) left[i] = Math.sin((2 * Math.PI * 200 * i) / RATE) * 0.9;
    const right = new Float32Array(frames);
    const analysed = analyse({ sampleRate: RATE, channels: [left, right] }, options);
    expect(analysed[3]!.level).toBeGreaterThan(0.1);
  });
});
