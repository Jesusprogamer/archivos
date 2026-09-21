import { describe, expect, it } from 'vitest';
import { stampBrush, strokeBrush, unionRect, type BrushSettings } from './brush';
import { bytes, type ByteArray } from './bytes';

const settings = (overrides: Partial<BrushSettings> = {}): BrushSettings => ({
  size: 6,
  hardness: 100,
  opacity: 100,
  ...overrides,
});

function fullMask(size: number): ByteArray {
  const mask = bytes(size * size);
  mask.fill(255);
  return mask;
}

describe('stampBrush', () => {
  it('erases a round patch, not a square one', () => {
    const mask = fullMask(9);
    stampBrush(mask, 9, 9, 4.5, 4.5, settings({ size: 7 }), 'erase');
    // Centre gone, corner of the bounding box untouched.
    expect(mask[4 * 9 + 4]).toBe(0);
    expect(mask[1 * 9 + 1]).toBe(255);
  });

  it('restores what erasing removed', () => {
    const mask = bytes(9 * 9);
    stampBrush(mask, 9, 9, 4.5, 4.5, settings(), 'restore');
    expect(mask[4 * 9 + 4]).toBe(255);
  });

  it('applies only part of the effect at reduced opacity', () => {
    const mask = fullMask(9);
    stampBrush(mask, 9, 9, 4.5, 4.5, settings({ opacity: 50 }), 'erase');
    const value = mask[4 * 9 + 4]!;
    expect(value).toBeGreaterThan(100);
    expect(value).toBeLessThan(160);
  });

  it('builds up with repeated stamps, like a real brush', () => {
    const mask = fullMask(9);
    const once = settings({ opacity: 50 });
    stampBrush(mask, 9, 9, 4.5, 4.5, once, 'erase');
    const after1 = mask[4 * 9 + 4]!;
    stampBrush(mask, 9, 9, 4.5, 4.5, once, 'erase');
    expect(mask[4 * 9 + 4]!).toBeLessThan(after1);
  });

  it('fades towards the rim when hardness is low', () => {
    const mask = fullMask(21);
    stampBrush(mask, 21, 21, 10.5, 10.5, settings({ size: 16, hardness: 0 }), 'erase');
    const centre = mask[10 * 21 + 10]!;
    const midway = mask[10 * 21 + 14]!;
    expect(centre).toBeLessThan(midway);
    expect(midway).toBeLessThan(255);
  });

  it('reports the rectangle it touched, clipped to the image', () => {
    const mask = fullMask(10);
    const rect = stampBrush(mask, 10, 10, 0, 0, settings({ size: 8 }), 'erase');
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
    expect(rect.width).toBeLessThanOrEqual(10);
  });

  it('does nothing when the brush falls entirely outside', () => {
    const mask = fullMask(10);
    const rect = stampBrush(mask, 10, 10, -50, -50, settings(), 'erase');
    expect(rect.width).toBe(0);
    expect([...mask].every((value) => value === 255)).toBe(true);
  });
});

describe('strokeBrush', () => {
  it('leaves a continuous line, not separate dots', () => {
    const mask = fullMask(40);
    strokeBrush(mask, 40, 40, { x: 5, y: 20 }, { x: 34, y: 20 }, settings({ size: 4 }), 'erase');
    for (let x = 6; x <= 33; x += 1) {
      expect(mask[20 * 40 + x], `gap at x=${x}`).toBeLessThan(255);
    }
  });

  it('covers the whole stroke in the dirty rectangle', () => {
    const mask = fullMask(40);
    const rect = strokeBrush(mask, 40, 40, { x: 5, y: 5 }, { x: 30, y: 25 }, settings(), 'erase');
    // The start point is excluded by contract, so the rectangle begins just
    // past it; the end point and its whole radius must be inside.
    expect(rect.x).toBeLessThanOrEqual(4);
    expect(rect.x + rect.width).toBeGreaterThanOrEqual(33);
    expect(rect.y + rect.height).toBeGreaterThanOrEqual(28);
  });

  it('stamps the end point exactly once, never twice', () => {
    // A zero-length stroke is the clean way to observe the contract: one
    // stamp at the end point. Two would darken every joint of a soft brush.
    const stroke = fullMask(20);
    strokeBrush(stroke, 20, 20, { x: 10, y: 10 }, { x: 10, y: 10 }, settings({ opacity: 40 }), 'erase');
    const single = fullMask(20);
    stampBrush(single, 20, 20, 10, 10, settings({ opacity: 40 }), 'erase');
    expect([...stroke]).toEqual([...single]);
  });
});

describe('unionRect', () => {
  it('ignores empty rectangles', () => {
    const rect = { x: 2, y: 3, width: 4, height: 5 };
    expect(unionRect({ x: 0, y: 0, width: 0, height: 0 }, rect)).toEqual(rect);
    expect(unionRect(rect, { x: 0, y: 0, width: 0, height: 0 })).toEqual(rect);
  });

  it('spans both', () => {
    expect(
      unionRect({ x: 0, y: 0, width: 2, height: 2 }, { x: 5, y: 5, width: 1, height: 1 }),
    ).toEqual({ x: 0, y: 0, width: 6, height: 6 });
  });
});
