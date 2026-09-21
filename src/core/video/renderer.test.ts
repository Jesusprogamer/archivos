import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEXT,
  DEFAULT_TRANSFORM,
  NEUTRAL_COLOR,
  NO_TRANSITION,
  type MediaClip,
  type TextClip,
} from './project';
import {
  clipOpacityAt,
  fitContain,
  textAnimationAt,
  transitionProgress,
  wrapText,
  type Canvas2D,
} from './renderer';

function clip(overrides: Partial<MediaClip> = {}): MediaClip {
  return {
    id: 'c',
    trackId: 't',
    kind: 'video',
    sourceId: 's',
    start: 0,
    duration: 10,
    inPoint: 0,
    speed: 1,
    keepPitch: true,
    volume: 1,
    muted: false,
    color: NEUTRAL_COLOR,
    transform: DEFAULT_TRANSFORM,
    keyframes: {},
    fadeIn: 0,
    fadeOut: 0,
    transition: NO_TRANSITION,
    ...overrides,
  };
}

function textClip(overrides: Partial<TextClip> = {}): TextClip {
  return {
    id: 'text',
    trackId: 't',
    kind: 'text',
    start: 0,
    duration: 5,
    transform: DEFAULT_TRANSFORM,
    keyframes: {},
    fadeIn: 0,
    fadeOut: 0,
    transition: NO_TRANSITION,
    style: DEFAULT_TEXT,
    ...overrides,
  };
}

describe('fitContain', () => {
  it('letterboxes a wide source in a square frame', () => {
    const placement = fitContain(1920, 1080, 1000, 1000);
    expect(placement.width).toBeCloseTo(1000, 6);
    expect(placement.height).toBeCloseTo(562.5, 4);
    expect(placement.y).toBeCloseTo(218.75, 4);
    expect(placement.x).toBeCloseTo(0, 6);
  });

  it('pillarboxes a tall source in a wide frame', () => {
    const placement = fitContain(1080, 1920, 1920, 1080);
    expect(placement.height).toBe(1080);
    expect(placement.x).toBeGreaterThan(0);
  });

  it('fills exactly when the ratios match', () => {
    const placement = fitContain(640, 360, 1280, 720);
    expect(placement).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  });

  it('falls back to the whole frame for a source with no size', () => {
    expect(fitContain(0, 0, 100, 50)).toEqual({ x: 0, y: 0, width: 100, height: 50 });
  });
});

describe('transitionProgress', () => {
  it('runs from zero to one over the transition and then stops', () => {
    const c = clip({ transition: { kind: 'crossfade', duration: 2 } });
    expect(transitionProgress(c, 0)).toBe(0);
    expect(transitionProgress(c, 1)).toBeCloseTo(0.5, 6);
    expect(transitionProgress(c, 2)).toBeUndefined();
    expect(transitionProgress(c, 5)).toBeUndefined();
  });

  it('is undefined with no transition, or a zero-length one', () => {
    expect(transitionProgress(clip(), 0)).toBeUndefined();
    expect(transitionProgress(clip({ transition: { kind: 'crossfade', duration: 0 } }), 0)).toBeUndefined();
  });

  it('is measured from the clip start, not from zero', () => {
    const c = clip({ start: 8, transition: { kind: 'crossfade', duration: 2 } });
    expect(transitionProgress(c, 8)).toBe(0);
    expect(transitionProgress(c, 9)).toBeCloseTo(0.5, 6);
    expect(transitionProgress(c, 0)).toBeUndefined();
  });
});

describe('clipOpacityAt', () => {
  it('combines the static opacity, the fades and the crossfade', () => {
    const c = clip({
      duration: 10,
      fadeIn: 2,
      transform: { ...DEFAULT_TRANSFORM, opacity: 0.5 },
      transition: { kind: 'crossfade', duration: 2 },
    });
    // One second in: half a fade-in, half a crossfade, half the static opacity.
    expect(clipOpacityAt(c, 1)).toBeCloseTo(0.5 * 0.5 * 0.5, 6);
    expect(clipOpacityAt(c, 5)).toBeCloseTo(0.5, 6);
  });

  it('is unaffected by a fade-to-black transition, which paints over the frame', () => {
    const c = clip({ transition: { kind: 'fadeToBlack', duration: 2 } });
    expect(clipOpacityAt(c, 1)).toBe(1);
  });

  it('respects animated opacity keyframes', () => {
    const c = clip({ keyframes: { opacity: [{ at: 0, value: 0 }, { at: 10, value: 1 }] } });
    expect(clipOpacityAt(c, 5)).toBeCloseTo(0.5, 6);
  });
});

describe('textAnimationAt', () => {
  it('starts invisible with a fade-in and reaches full opacity', () => {
    const c = textClip();
    expect(textAnimationAt(c, 0).opacity).toBe(0);
    expect(textAnimationAt(c, 2.5).opacity).toBeCloseTo(1, 6);
  });

  it('fades back out at the end', () => {
    const c = textClip();
    expect(textAnimationAt(c, 5).opacity).toBeCloseTo(0, 6);
  });

  it('offsets while sliding in and settles at zero', () => {
    const c = textClip({ style: { ...DEFAULT_TEXT, animateIn: 'slideUp', animateOut: 'none' } });
    expect(textAnimationAt(c, 0).offsetY).not.toBe(0);
    expect(textAnimationAt(c, 2.5).offsetY).toBeCloseTo(0, 6);
  });

  it('zooms from under full size to full size', () => {
    const c = textClip({ style: { ...DEFAULT_TEXT, animateIn: 'zoom', animateOut: 'none' } });
    expect(textAnimationAt(c, 0).scale).toBeCloseTo(0.8, 6);
    expect(textAnimationAt(c, 2.5).scale).toBeCloseTo(1, 6);
  });

  it('leaves everything alone when no animation is chosen', () => {
    const c = textClip({ style: { ...DEFAULT_TEXT, animateIn: 'none', animateOut: 'none' } });
    expect(textAnimationAt(c, 0)).toEqual({ opacity: 1, offsetX: 0, offsetY: 0, scale: 1 });
  });

  it('shortens the animation for a very short clip rather than never finishing', () => {
    const c = textClip({ duration: 0.3 });
    // A third of a 0.3s clip is 0.1s, so it is fully in by 0.15s.
    expect(textAnimationAt(c, 0.15).opacity).toBeCloseTo(1, 4);
  });
});

describe('wrapText', () => {
  /** A stand-in for the canvas context: every character is ten units wide. */
  const context = {
    measureText: (text: string) => ({ width: text.length * 10 }),
  } as unknown as Canvas2D;

  it('wraps on word boundaries', () => {
    expect(wrapText(context, 'uno dos tres cuatro', 100)).toEqual(['uno dos', 'tres', 'cuatro']);
  });

  it('honours explicit line breaks', () => {
    expect(wrapText(context, 'uno\ndos', 1000)).toEqual(['uno', 'dos']);
  });

  it('keeps blank lines, which are deliberate spacing', () => {
    expect(wrapText(context, 'uno\n\ndos', 1000)).toEqual(['uno', '', 'dos']);
  });

  it('never drops a word that is wider than the line', () => {
    expect(wrapText(context, 'supercalifragilistico', 50)).toEqual(['supercalifragilistico']);
  });
});
