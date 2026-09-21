import { describe, expect, it } from 'vitest';
import type { DocumentState } from './document';
import { clampCrop, crop, fitSize, resampleMask, rotateFlip } from './transform';
import { bytes } from './bytes';

/** A document whose red channel encodes `y * width + x`, so moves are visible. */
function indexed(width: number, height: number): DocumentState {
  const pixels = bytes(width * height * 4);
  const mask = bytes(width * height);
  for (let i = 0; i < width * height; i += 1) {
    pixels[i * 4] = i;
    pixels[i * 4 + 3] = 255;
    mask[i] = i;
  }
  return { width, height, pixels, mask };
}

const reds = (state: DocumentState) =>
  [...state.pixels].filter((_, index) => index % 4 === 0);

describe('crop', () => {
  it('takes the requested window and moves the mask with it', () => {
    const state = indexed(4, 3);
    const out = crop(state, { x: 1, y: 1, width: 2, height: 2 });
    expect(out.width).toBe(2);
    expect(out.height).toBe(2);
    expect(reds(out)).toEqual([5, 6, 9, 10]);
    expect([...out.mask]).toEqual([5, 6, 9, 10]);
  });

  it('clamps a window that runs off the edge', () => {
    const state = indexed(3, 3);
    const out = crop(state, { x: 2, y: 2, width: 99, height: 99 });
    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
    expect(reds(out)).toEqual([8]);
  });
});

describe('clampCrop', () => {
  it('never returns a zero-sized or negative window', () => {
    expect(clampCrop({ x: -5, y: -5, width: -1, height: 0 }, 10, 10)).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  });
});

describe('rotateFlip', () => {
  it('turns a quarter turn clockwise and swaps the dimensions', () => {
    // 0 1 2      3 0
    // 3 4 5  ->  4 1
    //            5 2
    const out = rotateFlip(indexed(3, 2), 1);
    expect([out.width, out.height]).toEqual([2, 3]);
    expect(reds(out)).toEqual([3, 0, 4, 1, 5, 2]);
    expect([...out.mask]).toEqual([3, 0, 4, 1, 5, 2]);
  });

  it('returns to the start after four turns', () => {
    const state = indexed(3, 2);
    let out = state;
    for (let i = 0; i < 4; i += 1) out = rotateFlip(out, 1);
    expect(reds(out)).toEqual(reds(state));
    expect([out.width, out.height]).toEqual([3, 2]);
  });

  it('flips horizontally and vertically', () => {
    expect(reds(rotateFlip(indexed(3, 2), 0, true, false))).toEqual([2, 1, 0, 5, 4, 3]);
    expect(reds(rotateFlip(indexed(3, 2), 0, false, true))).toEqual([3, 4, 5, 0, 1, 2]);
  });

  it('returns the same object when asked to do nothing', () => {
    const state = indexed(2, 2);
    expect(rotateFlip(state, 0)).toBe(state);
  });
});

describe('fitSize', () => {
  it('derives the missing side from the aspect ratio', () => {
    expect(fitSize(1600, 900, { width: 800 })).toEqual({ width: 800, height: 450 });
    expect(fitSize(1600, 900, { height: 450 })).toEqual({ width: 800, height: 450 });
  });

  it('honours both sides when both are given, even if that distorts', () => {
    expect(fitSize(1600, 900, { width: 100, height: 100 })).toEqual({ width: 100, height: 100 });
  });

  it('never returns a zero dimension', () => {
    expect(fitSize(1600, 900, { width: 1 })).toEqual({ width: 1, height: 1 });
  });
});

describe('resampleMask', () => {
  it('keeps a uniform mask uniform', () => {
    const mask = bytes(16).fill(200);
    const out = resampleMask(mask, 4, 4, 8, 8);
    expect(out).toHaveLength(64);
    expect([...out].every((value) => value === 200)).toBe(true);
  });

  it('interpolates rather than stepping, so edges stay smooth', () => {
    // A hard 0/255 edge down the middle of a 2x1 mask.
    const mask = bytes([0, 255]);
    const out = resampleMask(mask, 2, 1, 6, 1);
    // Values in the middle must land between the two extremes.
    expect(out[2]!).toBeGreaterThan(0);
    expect(out[2]!).toBeLessThan(255);
    expect(out[0]).toBe(0);
    expect(out[5]).toBe(255);
  });

  it('shrinks without reading outside the source', () => {
    const mask = bytes(100).fill(128);
    const out = resampleMask(mask, 10, 10, 3, 3);
    expect([...out].every((value) => value === 128)).toBe(true);
  });
});
