import { describe, expect, it } from 'vitest';
import { createAudio, frameCount, peakOf, toDecibels, type AudioData } from './buffer';
import {
  applyDirect,
  applyGain,
  changeSpeed,
  fadeIn,
  fadeOut,
  normalize,
  reverse,
  semitonesToRatio,
  silenceRange,
  DEFAULT_SETTINGS,
  DIRECT_EFFECTS,
} from './effects';

function mono(values: number[], sampleRate = 8): AudioData {
  return { sampleRate, channels: [new Float32Array(values)] };
}

const samples = (audio: AudioData) => [...audio.channels[0]!];

describe('applyGain', () => {
  it('scales only the chosen range', () => {
    const out = applyGain(mono([1, 1, 1, 1]), 1, 3, -6.0206);
    expect(out.channels[0]![0]).toBeCloseTo(1, 5);
    expect(out.channels[0]![1]).toBeCloseTo(0.5, 3);
    expect(out.channels[0]![3]).toBeCloseTo(1, 5);
  });

  it('leaves the input untouched, so a preview can be discarded', () => {
    const input = mono([1, 1]);
    applyGain(input, 0, 2, 6);
    expect(samples(input)).toEqual([1, 1]);
  });
});

describe('normalize', () => {
  it('lifts the peak to the target', () => {
    const out = normalize(mono([0.2, -0.1, 0.05]), 0, 3, 0);
    expect(peakOf(out)).toBeCloseTo(1, 4);
    // The shape is preserved: every sample scales by the same factor.
    expect(out.channels[0]![1]! / out.channels[0]![0]!).toBeCloseTo(-0.5, 4);
  });

  it('defaults to a little under full scale, leaving headroom', () => {
    expect(toDecibels(peakOf(normalize(mono([0.1]), 0, 1)))).toBeCloseTo(-1, 2);
  });

  it('leaves silence alone rather than amplifying noise into it', () => {
    const silence = mono([0, 0, 0]);
    expect(normalize(silence, 0, 3)).toBe(silence);
  });
});

describe('fades', () => {
  it('starts a fade-in at zero and ends at full', () => {
    const out = fadeIn(mono([1, 1, 1, 1, 1]), 0, 5);
    expect(out.channels[0]![0]).toBeCloseTo(0, 6);
    expect(out.channels[0]![4]).toBeCloseTo(1, 6);
  });

  it('mirrors for a fade-out', () => {
    const out = fadeOut(mono([1, 1, 1, 1, 1]), 0, 5);
    expect(out.channels[0]![0]).toBeCloseTo(1, 6);
    expect(out.channels[0]![4]).toBeCloseTo(0, 6);
  });

  it('holds the midpoint above the linear one, which is the point of equal power', () => {
    const equal = fadeIn(mono([1, 1, 1, 1, 1]), 0, 5, 'equalPower');
    const linear = fadeIn(mono([1, 1, 1, 1, 1]), 0, 5, 'linear');
    expect(equal.channels[0]![2]!).toBeGreaterThan(linear.channels[0]![2]!);
    expect(linear.channels[0]![2]).toBeCloseTo(0.5, 6);
  });

  it('does not divide by zero on a one-frame fade', () => {
    expect(samples(fadeIn(mono([1]), 0, 1))).toEqual([1]);
  });
});

describe('reverse', () => {
  it('reverses only the range', () => {
    expect(samples(reverse(mono([1, 2, 3, 4, 5]), 1, 4))).toEqual([1, 4, 3, 2, 5]);
  });

  it('is its own inverse', () => {
    const once = reverse(mono([1, 2, 3, 4]), 0, 4);
    expect(samples(reverse(once, 0, 4))).toEqual([1, 2, 3, 4]);
  });
});

describe('silenceRange', () => {
  it('zeroes the range and keeps the length', () => {
    expect(samples(silenceRange(mono([1, 2, 3]), 0, 2))).toEqual([0, 0, 3]);
  });
});

describe('changeSpeed', () => {
  it('shortens the range when speeding up', () => {
    const out = changeSpeed(mono([0, 1, 2, 3, 4, 5, 6, 7]), 0, 8, 2);
    expect(frameCount(out)).toBe(4);
    expect(out.channels[0]![1]).toBeCloseTo(2, 5);
  });

  it('lengthens the range when slowing down', () => {
    const out = changeSpeed(mono([0, 1, 2, 3]), 0, 4, 0.5);
    expect(frameCount(out)).toBe(8);
    // Interpolated, not duplicated: the halfway sample sits between its neighbours.
    expect(out.channels[0]![1]).toBeCloseTo(0.5, 5);
  });

  it('keeps the audio outside the range exactly as it was', () => {
    const out = changeSpeed(mono([9, 9, 0, 1, 2, 3, 9, 9]), 2, 6, 2);
    expect(out.channels[0]![0]).toBe(9);
    expect(out.channels[0]!.at(-1)).toBe(9);
    expect(out.channels[0]!.at(-2)).toBe(9);
  });

  it('does nothing for a rate of one or an invalid rate', () => {
    const audio = mono([1, 2, 3]);
    expect(changeSpeed(audio, 0, 3, 1)).toBe(audio);
    expect(changeSpeed(audio, 0, 3, 0)).toBe(audio);
  });
});

describe('semitonesToRatio', () => {
  it('doubles at an octave and holds at zero', () => {
    expect(semitonesToRatio(0)).toBe(1);
    expect(semitonesToRatio(12)).toBeCloseTo(2, 6);
    expect(semitonesToRatio(-12)).toBeCloseTo(0.5, 6);
    expect(semitonesToRatio(7)).toBeCloseTo(1.4983, 4);
  });
});

describe('applyDirect', () => {
  it('routes each direct effect to its implementation', () => {
    const audio = mono([1, 1, 1, 1]);
    expect(samples(applyDirect(audio, 0, 4, { id: 'silence' }))).toEqual([0, 0, 0, 0]);
    expect(samples(applyDirect(mono([1, 2]), 0, 2, { id: 'reverse' }))).toEqual([2, 1]);
  });

  it('returns the input untouched for an effect that needs a filter graph', () => {
    const audio = mono([1, 1]);
    expect(applyDirect(audio, 0, 2, DEFAULT_SETTINGS.reverb)).toBe(audio);
  });
});

describe('the effect catalogue', () => {
  it('has a default for every effect it advertises', () => {
    for (const [id, settings] of Object.entries(DEFAULT_SETTINGS)) {
      expect(settings.id).toBe(id);
    }
  });

  it('marks exactly the effects that need no filter graph', () => {
    for (const id of DIRECT_EFFECTS) {
      expect(applyDirect(mono([1]), 0, 1, DEFAULT_SETTINGS[id])).not.toBe(undefined);
    }
    expect(DIRECT_EFFECTS.has('reverb')).toBe(false);
    expect(DIRECT_EFFECTS.has('equalizer')).toBe(false);
  });
});

describe('createAudio', () => {
  it('starts silent', () => {
    expect(peakOf(createAudio(2, 10, 44100))).toBe(0);
  });
});
