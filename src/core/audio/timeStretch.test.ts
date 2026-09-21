import { describe, expect, it } from 'vitest';
import { frameCount, peakOf, type AudioData } from './buffer';
import { changeSpeedKeepingPitch, shiftPitch, timeStretch } from './timeStretch';

const RATE = 44100;

function sine(frequency: number, frames: number, sampleRate = RATE): AudioData {
  const channel = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    channel[i] = Math.sin((2 * Math.PI * frequency * i) / sampleRate);
  }
  return { sampleRate, channels: [channel] };
}

/**
 * Estimates a pure tone's frequency by counting upward zero crossings.
 *
 * Good enough to tell 440 Hz from 880 Hz, which is all these tests need, and
 * it avoids pulling an FFT into the test suite.
 */
function estimateFrequency(audio: AudioData, from: number, to: number): number {
  const channel = audio.channels[0]!;
  let crossings = 0;
  for (let i = from + 1; i < to; i += 1) {
    if (channel[i - 1]! < 0 && channel[i]! >= 0) crossings += 1;
  }
  return (crossings * audio.sampleRate) / (to - from);
}

describe('timeStretch', () => {
  it('lengthens by the requested factor', () => {
    const audio = sine(440, 44100);
    const out = timeStretch(audio, 0, 44100, 2);
    expect(frameCount(out)).toBeCloseTo(88200, -2);
  });

  it('shortens by the requested factor', () => {
    const out = timeStretch(sine(440, 44100), 0, 44100, 0.5);
    expect(frameCount(out)).toBeCloseTo(22050, -2);
  });

  it('holds the pitch, which is the whole point', () => {
    const audio = sine(440, 44100);
    const out = timeStretch(audio, 0, 44100, 2);
    // Measured away from the edges, where the overlap-add is still settling.
    expect(estimateFrequency(out, 5000, 80000)).toBeGreaterThan(420);
    expect(estimateFrequency(out, 5000, 80000)).toBeLessThan(460);
  });

  it('does not blow up the level', () => {
    const out = timeStretch(sine(440, 44100), 0, 44100, 1.5);
    expect(peakOf(out)).toBeLessThan(1.2);
    expect(peakOf(out)).toBeGreaterThan(0.7);
  });

  it('leaves audio outside the range alone', () => {
    const audio = sine(440, 44100 * 2);
    audio.channels[0]![0] = 0.42;
    const out = timeStretch(audio, 44100, 44100 * 2, 2);
    expect(out.channels[0]![0]).toBeCloseTo(0.42, 6);
  });

  it('does nothing for a factor of one or an invalid factor', () => {
    const audio = sine(440, 1000);
    expect(timeStretch(audio, 0, 1000, 1)).toBe(audio);
    expect(timeStretch(audio, 0, 1000, -1)).toBe(audio);
  });

  it('falls back to resampling for a range too short to overlap-add', () => {
    // Under two frames' worth, WSOLA has nothing to work with.
    const out = timeStretch(sine(440, 1000), 0, 1000, 2);
    expect(frameCount(out)).toBeCloseTo(2000, -2);
  });
});

describe('shiftPitch', () => {
  it('raises the pitch an octave while keeping the duration', () => {
    const audio = sine(440, 44100);
    const out = shiftPitch(audio, 0, 44100, 12);
    expect(frameCount(out)).toBeCloseTo(44100, -3);
    const frequency = estimateFrequency(out, 4000, 40000);
    expect(frequency).toBeGreaterThan(780);
    expect(frequency).toBeLessThan(960);
  });

  it('lowers the pitch while keeping the duration', () => {
    const out = shiftPitch(sine(880, 44100), 0, 44100, -12);
    expect(frameCount(out)).toBeCloseTo(44100, -3);
    const frequency = estimateFrequency(out, 4000, 40000);
    expect(frequency).toBeGreaterThan(390);
    expect(frequency).toBeLessThan(490);
  });

  it('does nothing at zero semitones', () => {
    const audio = sine(440, 1000);
    expect(shiftPitch(audio, 0, 1000, 0)).toBe(audio);
  });
});

describe('changeSpeedKeepingPitch', () => {
  it('keeps the pitch when asked to', () => {
    const out = changeSpeedKeepingPitch(sine(440, 44100), 0, 44100, 0.5, true);
    expect(frameCount(out)).toBeCloseTo(88200, -2);
    expect(estimateFrequency(out, 5000, 80000)).toBeGreaterThan(400);
  });

  it('lets the pitch follow the speed when asked not to', () => {
    const out = changeSpeedKeepingPitch(sine(440, 44100), 0, 44100, 0.5, false);
    expect(frameCount(out)).toBeCloseTo(88200, -2);
    // Half speed without correction halves the pitch.
    expect(estimateFrequency(out, 5000, 80000)).toBeLessThan(280);
  });

  it('does nothing at normal speed', () => {
    const audio = sine(440, 1000);
    expect(changeSpeedKeepingPitch(audio, 0, 1000, 1, true)).toBe(audio);
  });
});
