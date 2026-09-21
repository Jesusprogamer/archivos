import { describe, expect, it } from 'vitest';
import { bytes } from './bytes';
import { ImageEditor } from './editor';

/** A 3x1 strip: green, green, red — a miniature green screen. */
function strip(): ImageEditor {
  const pixels = bytes([0, 200, 0, 255, 0, 200, 0, 255, 220, 30, 30, 255]);
  return new ImageEditor(pixels, 3, 1);
}

const key = { color: '#00c800', tolerance: 20, softness: 0, contiguous: false } as const;

describe('ImageEditor — previews', () => {
  it('shows a preview without touching the document', () => {
    const editor = strip();
    editor.previewColorKey(key);

    expect([...editor.getPreview()!]).toEqual([0, 0, 255]);
    // The committed mask is untouched until the user says so.
    expect([...editor.getState().mask]).toEqual([255, 255, 255]);
    expect(editor.canUndo).toBe(false);
  });

  it('discards a preview on request', () => {
    const editor = strip();
    editor.previewColorKey(key);
    editor.clearPreview();
    expect(editor.getPreview()).toBeUndefined();
    expect([...editor.getState().mask]).toEqual([255, 255, 255]);
  });

  it('commits a preview into the document, as one undo step', () => {
    const editor = strip();
    editor.previewColorKey(key);
    editor.commitPreview();

    expect([...editor.getState().mask]).toEqual([0, 0, 255]);
    expect(editor.getPreview()).toBeUndefined();
    expect(editor.canUndo).toBe(true);

    editor.undo();
    expect([...editor.getState().mask]).toEqual([255, 255, 255]);
  });

  it('notifies subscribers whenever something changes', () => {
    const editor = strip();
    let calls = 0;
    const unsubscribe = editor.subscribe(() => {
      calls += 1;
    });
    const before = editor.getSnapshot();

    editor.previewColorKey(key);
    editor.commitPreview();

    expect(calls).toBe(2);
    expect(editor.getSnapshot()).toBeGreaterThan(before);
    unsubscribe();
    editor.resetMask();
    expect(calls).toBe(2);
  });
});

describe('ImageEditor — the three methods stack', () => {
  it('lets the brush restore what the colour key removed', () => {
    const editor = strip();
    editor.previewColorKey(key);
    editor.commitPreview();
    expect(editor.getState().mask[0]).toBe(0);

    editor.beginStroke(0.5, 0.5, { size: 1, hardness: 100, opacity: 100 }, 'restore');
    editor.endStroke();
    expect(editor.getState().mask[0]).toBe(255);
  });

  it('lets a model mask and a colour key compound, in either order', () => {
    // A model that keeps only the last pixel, and a key that removes the greens.
    const modelMask = bytes([0, 255, 255]);

    const keyFirst = strip();
    keyFirst.previewColorKey(key);
    keyFirst.commitPreview();
    keyFirst.previewMask(modelMask);
    keyFirst.commitPreview();

    const modelFirst = strip();
    modelFirst.previewMask(modelMask);
    modelFirst.commitPreview();
    modelFirst.previewColorKey(key);
    modelFirst.commitPreview();

    expect([...keyFirst.getState().mask]).toEqual([...modelFirst.getState().mask]);
    expect([...keyFirst.getState().mask]).toEqual([0, 0, 255]);
  });

  it('never resurrects a pixel an earlier pass removed', () => {
    const editor = strip();
    editor.previewMask(bytes([0, 0, 0]));
    editor.commitPreview();
    // A mask that would keep everything cannot undo the previous removal.
    editor.previewMask(bytes([255, 255, 255]));
    editor.commitPreview();
    expect([...editor.getState().mask]).toEqual([0, 0, 0]);
  });
});

describe('ImageEditor — brush strokes', () => {
  it('records one undo step per stroke, not per stamp', () => {
    const editor = strip();
    const settings = { size: 1, hardness: 100, opacity: 100 };
    editor.beginStroke(0.5, 0.5, settings, 'erase');
    editor.continueStroke(1.5, 0.5, settings, 'erase');
    editor.continueStroke(2.5, 0.5, settings, 'erase');
    editor.endStroke();

    expect([...editor.getState().mask]).toEqual([0, 0, 0]);
    editor.undo();
    expect([...editor.getState().mask]).toEqual([255, 255, 255]);
  });
});

describe('ImageEditor — geometry', () => {
  it('crops pixels and mask together', () => {
    const editor = strip();
    editor.previewColorKey(key);
    editor.commitPreview();
    editor.crop({ x: 1, y: 0, width: 2, height: 1 });

    expect(editor.getState().width).toBe(2);
    expect([...editor.getState().mask]).toEqual([0, 255]);
  });

  it('carries the mask through a rotation', () => {
    const editor = strip();
    editor.previewColorKey(key);
    editor.commitPreview();
    editor.rotateFlip(1);

    const state = editor.getState();
    expect([state.width, state.height]).toEqual([1, 3]);
    expect([...state.mask]).toEqual([0, 0, 255]);
  });

  it('does nothing for a no-op rotation', () => {
    const editor = strip();
    editor.rotateFlip(0);
    expect(editor.canUndo).toBe(false);
  });
});

describe('ImageEditor — reset', () => {
  it('puts every pixel back but keeps the crop', () => {
    const editor = strip();
    editor.previewColorKey(key);
    editor.commitPreview();
    editor.crop({ x: 0, y: 0, width: 2, height: 1 });
    editor.resetMask();

    expect(editor.getState().width).toBe(2);
    expect([...editor.getState().mask]).toEqual([255, 255]);
  });
});

describe('ImageEditor — dirty flag', () => {
  it('starts clean and stays clean through previews alone', () => {
    const editor = strip();
    expect(editor.isDirty).toBe(false);
    editor.previewColorKey(key);
    expect(editor.isDirty).toBe(false);
    editor.commitPreview();
    expect(editor.isDirty).toBe(true);
  });
});
