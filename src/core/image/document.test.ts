import { describe, expect, it } from 'vitest';
import { History, composite, createState, stateBytes, type DocumentState } from './document';
import { bytes } from './bytes';

function state(width: number, height: number, alpha = 255): DocumentState {
  const pixels = bytes(width * height * 4);
  for (let p = 0; p < pixels.length; p += 4) {
    pixels[p] = 10;
    pixels[p + 1] = 20;
    pixels[p + 2] = 30;
    pixels[p + 3] = alpha;
  }
  return createState(pixels, { width, height });
}

describe('createState', () => {
  it('starts with everything kept', () => {
    const s = state(2, 2);
    expect([...s.mask]).toEqual([255, 255, 255, 255]);
  });
});

describe('composite', () => {
  it('multiplies the mask into the alpha channel', () => {
    const s = state(2, 1);
    s.mask[0] = 0;
    s.mask[1] = 128;
    const out = composite(s);
    expect(out[3]).toBe(0);
    expect(out[7]).toBe(128);
    // Colour channels are untouched, so a removed pixel can be brought back.
    expect([out[0], out[1], out[2]]).toEqual([10, 20, 30]);
  });

  it('respects alpha the source image already had', () => {
    const s = state(1, 1, 100);
    s.mask[0] = 255;
    expect(composite(s)[3]).toBe(100);
    s.mask[0] = 128;
    // 100 * 128 / 255, rounded by Uint8ClampedArray.
    expect(composite(s)[3]).toBe(50);
  });
});

describe('History', () => {
  it('undoes and redoes', () => {
    const history = new History();
    const first = state(2, 2);
    expect(history.canUndo).toBe(false);

    history.push(first);
    const second = { ...first, mask: bytes([0, 0, 0, 0]) };
    expect(history.canUndo).toBe(true);

    const undone = history.undo(second);
    expect([...undone!.mask]).toEqual([255, 255, 255, 255]);
    expect(history.canRedo).toBe(true);

    const redone = history.redo(undone!);
    expect([...redone!.mask]).toEqual([0, 0, 0, 0]);
  });

  it('snapshots, so later mutation of the live state cannot corrupt it', () => {
    const history = new History();
    const live = state(2, 2);
    history.push(live);
    // Mutating the live state after pushing must not reach into the snapshot.
    live.mask[0] = 0;
    const restored = history.undo(live)!;
    expect(restored.mask[0]).toBe(255);
    expect(restored.mask).not.toBe(live.mask);
  });

  it('drops the oldest steps once the memory budget is spent', () => {
    // 2x2 RGBA + mask = 20 bytes per snapshot; a 50-byte budget holds two.
    const history = new History(50);
    for (let i = 0; i < 8; i += 1) history.push(state(2, 2));
    expect(history.depth).toBeLessThanOrEqual(3);
    expect(history.depth).toBeGreaterThan(0);
  });

  it('never trims away the last step', () => {
    const history = new History(1);
    history.push(state(4, 4));
    history.push(state(4, 4));
    expect(history.canUndo).toBe(true);
  });

  it('discards the redo stack once a new change is made', () => {
    const history = new History();
    const a = state(1, 1);
    history.push(a);
    const b = { ...a, mask: bytes([0]) };
    history.undo(b);
    expect(history.canRedo).toBe(true);
    history.push(a);
    expect(history.canRedo).toBe(false);
  });
});

describe('stateBytes', () => {
  it('counts pixels and mask', () => {
    expect(stateBytes(state(10, 10))).toBe(10 * 10 * 4 + 10 * 10);
  });
});
