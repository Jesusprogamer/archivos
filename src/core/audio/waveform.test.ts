import { describe, expect, it } from 'vitest';
import { createAudio, type AudioData } from './buffer';
import { PeakCache, computePeaks } from './waveform';

function fromValues(values: number[], channels = 1): AudioData {
  return {
    sampleRate: 8,
    channels: Array.from({ length: channels }, () => new Float32Array(values)),
  };
}

describe('computePeaks', () => {
  it('reduces a range to the requested number of columns', () => {
    const peaks = computePeaks(fromValues([0, 1, 0, -1, 0, 0.5, 0, -0.5]), 0, 8, 2);
    expect(peaks[0]).toHaveLength(2);
    expect(peaks[0]![0]).toEqual({ min: -1, max: 1 });
    expect(peaks[0]![1]).toEqual({ min: -0.5, max: 0.5 });
  });

  it('keeps the extremes, which is the point of a waveform', () => {
    // A single loud spike in a quiet passage must still be visible.
    const values = new Array<number>(1000).fill(0.01);
    values[500] = 0.95;
    const peaks = computePeaks(fromValues(values), 0, 1000, 4);
    expect(peaks[0]![2]!.max).toBeCloseTo(0.95, 6);
  });

  it('gives every channel its own columns', () => {
    const peaks = computePeaks(fromValues([1, -1], 2), 0, 2, 1);
    expect(peaks).toHaveLength(2);
    expect(peaks[1]![0]).toEqual({ min: -1, max: 1 });
  });

  it('zooms into a sub-range', () => {
    const peaks = computePeaks(fromValues([1, 1, 0.2, 0.2, 1, 1]), 2, 4, 1);
    expect(peaks[0]![0]!.max).toBeCloseTo(0.2, 6);
  });

  it('never returns fewer columns than asked, even with more columns than frames', () => {
    const peaks = computePeaks(fromValues([1, -1]), 0, 2, 10);
    expect(peaks[0]).toHaveLength(10);
    expect(peaks[0]!.every((column) => Number.isFinite(column.min))).toBe(true);
  });

  it('reports silence rather than infinity for an empty buffer', () => {
    const peaks = computePeaks(createAudio(1, 0, 44100), 0, 0, 4);
    expect(peaks[0]![0]).toEqual({ min: 0, max: 0 });
  });

  it('tolerates a reversed or out-of-range request', () => {
    expect(() => computePeaks(fromValues([1, 2]), 5, 1, 3)).not.toThrow();
    expect(() => computePeaks(fromValues([1, 2]), -10, 999, 3)).not.toThrow();
  });
});

describe('PeakCache', () => {
  it('reuses the result for an identical request', () => {
    const cache = new PeakCache();
    const audio = fromValues([0, 1, 0, -1]);
    const first = cache.get(audio, 0, 4, 2, 0);
    expect(cache.get(audio, 0, 4, 2, 0)).toBe(first);
  });

  it('recomputes when the view or the audio changes', () => {
    const cache = new PeakCache();
    const audio = fromValues([0, 1, 0, -1]);
    const first = cache.get(audio, 0, 4, 2, 0);
    expect(cache.get(audio, 0, 4, 4, 0)).not.toBe(first);
    expect(cache.get(audio, 0, 4, 2, 1)).not.toBe(first);
  });

  it('forgets everything when cleared', () => {
    const cache = new PeakCache();
    const audio = fromValues([0, 1]);
    const first = cache.get(audio, 0, 2, 1, 0);
    cache.clear();
    expect(cache.get(audio, 0, 2, 1, 0)).not.toBe(first);
  });
});
