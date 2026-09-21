import { describe, expect, it } from 'vitest';
import { durationOf, frameCount, peakOf, type AudioData } from './buffer';
import { AudioEditor } from './editor';

/** Eight frames at 8 Hz, so one frame is 0.125 s and the buffer is one second. */
function strip(values = [1, 2, 3, 4, 5, 6, 7, 8]): AudioData {
  return { sampleRate: 8, channels: [new Float32Array(values)] };
}

const samplesOf = (editor: AudioEditor) => [...editor.committed.channels[0]!];

describe('AudioEditor — selection', () => {
  it('treats no selection as the whole buffer', () => {
    const editor = new AudioEditor(strip());
    expect(editor.getRange()).toEqual([0, 8]);
  });

  it('converts a selection in seconds to frames', () => {
    const editor = new AudioEditor(strip());
    editor.setSelection({ start: 0.25, end: 0.75 });
    expect(editor.getRange()).toEqual([2, 6]);
  });

  it('selects everything on request', () => {
    const editor = new AudioEditor(strip());
    editor.selectAll();
    expect(editor.getSelection()).toEqual({ start: 0, end: 1 });
  });
});

describe('AudioEditor — cut, copy, paste', () => {
  it('cuts the selection and closes the gap', () => {
    const editor = new AudioEditor(strip());
    editor.setSelection({ start: 0.25, end: 0.5 });
    editor.cut();
    expect(samplesOf(editor)).toEqual([1, 2, 5, 6, 7, 8]);
    expect(editor.hasClipboard).toBe(true);
  });

  it('pastes at the cursor when nothing is selected', () => {
    const editor = new AudioEditor(strip([1, 2, 3, 4]));
    editor.setSelection({ start: 0, end: 0.25 });
    editor.copy();
    editor.setSelection(undefined);
    editor.setPlayhead(0.375); // frame 3
    editor.paste();
    expect(samplesOf(editor)).toEqual([1, 2, 3, 1, 2, 4]);
  });

  it('replaces the selection when pasting over one', () => {
    const editor = new AudioEditor(strip([1, 2, 3, 4]));
    editor.setSelection({ start: 0, end: 0.25 });
    editor.copy();
    editor.setSelection({ start: 0.25, end: 0.5 });
    editor.paste();
    expect(samplesOf(editor)).toEqual([1, 2, 1, 2]);
  });

  it('does nothing when the clipboard is empty', () => {
    const editor = new AudioEditor(strip([1, 2]));
    editor.paste();
    expect(samplesOf(editor)).toEqual([1, 2]);
    expect(editor.canUndo).toBe(false);
  });

  it('copying does not count as an edit', () => {
    const editor = new AudioEditor(strip());
    editor.selectAll();
    editor.copy();
    expect(editor.isDirty).toBe(false);
    expect(editor.canUndo).toBe(false);
  });
});

describe('AudioEditor — delete and trim', () => {
  it('deletes only with a real selection, never the whole track by accident', () => {
    const editor = new AudioEditor(strip([1, 2, 3, 4]));
    editor.deleteRange();
    expect(samplesOf(editor)).toEqual([1, 2, 3, 4]);

    editor.setSelection({ start: 0, end: 0.25 });
    editor.deleteRange();
    expect(samplesOf(editor)).toEqual([3, 4]);
  });

  it('trims away everything outside the selection', () => {
    const editor = new AudioEditor(strip());
    editor.setSelection({ start: 0.25, end: 0.5 });
    editor.trimToSelection();
    expect(samplesOf(editor)).toEqual([3, 4]);
  });
});

describe('AudioEditor — silence', () => {
  it('inserts silence at the cursor and makes the track longer', () => {
    const editor = new AudioEditor(strip([1, 2]));
    editor.setPlayhead(0.125); // frame 1
    editor.insertSilence(0.25);
    expect(samplesOf(editor)).toEqual([1, 0, 0, 2]);
    expect(durationOf(editor.committed)).toBeCloseTo(0.5, 6);
  });

  it('inserts at the start of a selection rather than at the cursor', () => {
    const editor = new AudioEditor(strip([1, 2, 3, 4]));
    editor.setSelection({ start: 0.25, end: 0.5 });
    editor.insertSilence(0.125);
    expect(samplesOf(editor)).toEqual([1, 2, 0, 3, 4]);
  });

  it('applies an effect to the whole track when nothing is selected, cursor or not', async () => {
    const editor = new AudioEditor(strip([1, 1, 1, 1]));
    editor.setPlayhead(0.25);
    await editor.previewEffect({ id: 'silence' });
    // A cursor is not a selection: the effect covers everything.
    expect([...editor.current.channels[0]!]).toEqual([0, 0, 0, 0]);
  });
});

describe('AudioEditor — previews', () => {
  it('shows a preview without committing it', async () => {
    const editor = new AudioEditor(strip([1, 1, 1, 1]));
    await editor.previewEffect({ id: 'silence' });

    expect(editor.hasPreview).toBe(true);
    expect([...editor.current.channels[0]!]).toEqual([0, 0, 0, 0]);
    expect(samplesOf(editor)).toEqual([1, 1, 1, 1]);
    expect(editor.canUndo).toBe(false);
  });

  it('discards a preview cleanly', async () => {
    const editor = new AudioEditor(strip([1, 1]));
    await editor.previewEffect({ id: 'silence' });
    editor.discardPreview();
    expect(editor.hasPreview).toBe(false);
    expect([...editor.current.channels[0]!]).toEqual([1, 1]);
  });

  it('applies a preview as one undo step', async () => {
    const editor = new AudioEditor(strip([1, 1]));
    await editor.previewEffect({ id: 'silence' });
    editor.applyPreview();

    expect(samplesOf(editor)).toEqual([0, 0]);
    editor.undo();
    expect(samplesOf(editor)).toEqual([1, 1]);
  });

  it('previews only the selection', async () => {
    const editor = new AudioEditor(strip([1, 1, 1, 1]));
    editor.setSelection({ start: 0, end: 0.25 });
    await editor.previewEffect({ id: 'silence' });
    expect([...editor.current.channels[0]!]).toEqual([0, 0, 1, 1]);
  });

  it('routes speed and pitch through the stretcher, not the filter graph', async () => {
    const long = new Float32Array(20000);
    for (let i = 0; i < long.length; i += 1) long[i] = Math.sin(i / 10);
    const editor = new AudioEditor({ sampleRate: 44100, channels: [long] });

    await editor.previewEffect({ id: 'speed', settings: { rate: 2, keepPitch: true } });
    expect(frameCount(editor.current)).toBeLessThan(15000);
  });
});

describe('AudioEditor — history', () => {
  it('undoes and redoes edits', () => {
    const editor = new AudioEditor(strip([1, 2, 3, 4]));
    editor.setSelection({ start: 0, end: 0.25 });
    editor.cut();
    expect(samplesOf(editor)).toEqual([3, 4]);

    editor.undo();
    expect(samplesOf(editor)).toEqual([1, 2, 3, 4]);
    editor.redo();
    expect(samplesOf(editor)).toEqual([3, 4]);
  });

  it('pulls the selection back inside after an edit shortened the track', () => {
    const editor = new AudioEditor(strip());
    editor.setSelection({ start: 0.5, end: 1 });
    editor.trimToSelection();
    editor.setSelection({ start: 0, end: 0.5 });
    editor.undo();
    // The selection cannot point past the end of the restored audio.
    const selection = editor.getSelection();
    expect(selection!.end).toBeLessThanOrEqual(durationOf(editor.committed) + 1e-9);
  });

  it('bounds the history by memory but always keeps at least one step', () => {
    // 8 frames x 4 bytes = 32 bytes per snapshot, so a 70-byte budget is spent
    // almost immediately.
    const editor = new AudioEditor(strip(), 70);
    for (let i = 0; i < 10; i += 1) editor.insertSilence(0.125);

    // Undo still works after ten edits, even though nine of them are gone.
    expect(editor.canUndo).toBe(true);
    editor.undo();
    expect(editor.canRedo).toBe(true);
  });
});

describe('AudioEditor — notifications', () => {
  it('bumps the revision only when the samples change', () => {
    const editor = new AudioEditor(strip());
    const before = editor.revision;
    editor.setSelection({ start: 0, end: 0.5 });
    expect(editor.revision).toBe(before);
    editor.copy();
    expect(editor.revision).toBe(before);
    editor.cut();
    expect(editor.revision).toBeGreaterThan(before);
  });

  it('notifies subscribers and stops after unsubscribing', () => {
    const editor = new AudioEditor(strip());
    let calls = 0;
    const off = editor.subscribe(() => {
      calls += 1;
    });
    editor.selectAll();
    expect(calls).toBe(1);
    off();
    editor.clearSelection();
    expect(calls).toBe(1);
  });
});

describe('AudioEditor — direct effects through the editor', () => {
  it('normalises the selection only', async () => {
    const editor = new AudioEditor(strip([0.1, 0.1, 0.5, 0.5]));
    editor.setSelection({ start: 0, end: 0.25 });
    await editor.previewEffect({ id: 'normalize', targetDb: 0 });
    editor.applyPreview();

    const samples = samplesOf(editor);
    expect(samples[0]).toBeCloseTo(1, 4);
    expect(samples[2]).toBeCloseTo(0.5, 6);
    expect(peakOf(editor.committed)).toBeCloseTo(1, 4);
  });
});
