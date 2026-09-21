import { describe, expect, it } from 'vitest';
import {
  createAudio,
  cutRange,
  durationOf,
  frameAt,
  fromDecibels,
  insertAudio,
  insertSilence,
  isEmptySelection,
  peakOf,
  rangeOf,
  rmsOf,
  sliceAudio,
  toDecibels,
  type AudioData,
} from './buffer';

function ramp(values: number[], channels = 1, sampleRate = 8): AudioData {
  return {
    sampleRate,
    channels: Array.from({ length: channels }, () => new Float32Array(values)),
  };
}

describe('durationOf', () => {
  it('divides frames by the sample rate', () => {
    expect(durationOf(createAudio(2, 44100, 44100))).toBe(1);
    expect(durationOf(createAudio(1, 0, 44100))).toBe(0);
  });
});

describe('frameAt', () => {
  it('rounds to the nearest frame and clamps to the buffer', () => {
    const audio = createAudio(1, 100, 100);
    expect(frameAt(audio, 0.5)).toBe(50);
    expect(frameAt(audio, -3)).toBe(0);
    expect(frameAt(audio, 99)).toBe(100);
  });
});

describe('rangeOf', () => {
  const audio = createAudio(1, 80, 8);

  it('covers everything when there is no selection', () => {
    expect(rangeOf(audio, undefined)).toEqual([0, 80]);
    expect(rangeOf(audio, { start: 3, end: 3 })).toEqual([0, 80]);
  });

  it('converts a selection in seconds to frames', () => {
    expect(rangeOf(audio, { start: 1, end: 2 })).toEqual([8, 16]);
  });
});

describe('isEmptySelection', () => {
  it('treats a zero-width drag as no selection', () => {
    expect(isEmptySelection(undefined)).toBe(true);
    expect(isEmptySelection({ start: 1, end: 1 })).toBe(true);
    expect(isEmptySelection({ start: 1, end: 1.5 })).toBe(false);
  });
});

describe('sliceAudio', () => {
  it('copies a range', () => {
    const out = sliceAudio(ramp([1, 2, 3, 4, 5]), 1, 4);
    expect([...out.channels[0]!]).toEqual([2, 3, 4]);
  });

  it('tolerates reversed and out-of-range bounds', () => {
    expect([...sliceAudio(ramp([1, 2, 3]), 3, 1).channels[0]!]).toEqual([2, 3]);
    expect([...sliceAudio(ramp([1, 2, 3]), 0, 99).channels[0]!]).toEqual([1, 2, 3]);
  });
});

describe('cutRange', () => {
  it('closes the gap', () => {
    const out = cutRange(ramp([1, 2, 3, 4, 5]), 1, 3);
    expect([...out.channels[0]!]).toEqual([1, 4, 5]);
  });

  it('does nothing for an empty range', () => {
    const audio = ramp([1, 2, 3]);
    expect(cutRange(audio, 2, 2)).toBe(audio);
  });

  it('cuts every channel identically', () => {
    const out = cutRange(ramp([1, 2, 3, 4], 2), 0, 2);
    expect([...out.channels[0]!]).toEqual([3, 4]);
    expect([...out.channels[1]!]).toEqual([3, 4]);
  });
});

describe('insertAudio', () => {
  it('splices a clip in at a position', () => {
    const out = insertAudio(ramp([1, 2, 5, 6]), ramp([3, 4]), 2);
    expect([...out.channels[0]!]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('spreads a mono clip across stereo channels rather than refusing', () => {
    const stereo = ramp([1, 1], 2);
    const out = insertAudio(stereo, ramp([9]), 1);
    expect([...out.channels[0]!]).toEqual([1, 9, 1]);
    expect([...out.channels[1]!]).toEqual([1, 9, 1]);
  });

  it('clamps the position to the buffer', () => {
    expect([...insertAudio(ramp([1, 2]), ramp([9]), 99).channels[0]!]).toEqual([1, 2, 9]);
  });
});

describe('insertSilence', () => {
  it('inserts zeros of the requested length', () => {
    const out = insertSilence(ramp([1, 2]), 1, 0.25); // 0.25s at 8 Hz = 2 frames
    expect([...out.channels[0]!]).toEqual([1, 0, 0, 2]);
  });

  it('ignores a zero-length request', () => {
    const audio = ramp([1, 2]);
    expect(insertSilence(audio, 1, 0)).toBe(audio);
  });
});

describe('peakOf and rmsOf', () => {
  it('finds the loudest sample across every channel', () => {
    const audio: AudioData = {
      sampleRate: 8,
      channels: [new Float32Array([0.1, -0.2]), new Float32Array([0.9, 0])],
    };
    expect(peakOf(audio)).toBeCloseTo(0.9, 6);
    expect(peakOf(audio, 1, 2)).toBeCloseTo(0.2, 6);
  });

  it('computes RMS, which is lower than the peak for anything but a square', () => {
    const audio = ramp([1, -1, 1, -1]);
    expect(rmsOf(audio)).toBeCloseTo(1, 6);
    expect(rmsOf(ramp([1, 0, 1, 0]))).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it('returns zero for an empty range instead of dividing by zero', () => {
    expect(rmsOf(ramp([1, 2]), 1, 1)).toBe(0);
  });
});

describe('decibel conversion', () => {
  it('round-trips', () => {
    expect(fromDecibels(toDecibels(0.5))).toBeCloseTo(0.5, 6);
  });

  it('maps the familiar landmarks', () => {
    expect(toDecibels(1)).toBeCloseTo(0, 6);
    expect(toDecibels(0.5)).toBeCloseTo(-6.02, 2);
    expect(fromDecibels(-6)).toBeCloseTo(0.501, 3);
  });

  it('treats true silence as minus infinity, not a huge negative number', () => {
    expect(toDecibels(0)).toBe(-Infinity);
  });
});
