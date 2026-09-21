import { describe, expect, it } from 'vitest';
import { FORMATS } from '../detect/formats';
import { defaultWorkspaceFor, workspacesFor } from './workspaces';

describe('workspacesFor', () => {
  it('always offers Convert, and offers it last', () => {
    for (const format of [FORMATS.png, FORMATS.mp3, FORMATS.mp4]) {
      const ids = workspacesFor(format).map((w) => w.id);
      expect(ids.at(-1)).toBe('convert');
    }
  });

  it('offers the editors that match the media kind', () => {
    expect(workspacesFor(FORMATS.png).map((w) => w.id)).toEqual(['image', 'convert']);
    expect(workspacesFor(FORMATS.mp3).map((w) => w.id)).toEqual(['audio', 'visualizer', 'convert']);
    expect(workspacesFor(FORMATS.mp4).map((w) => w.id)).toEqual(['video', 'convert']);
  });

  it('offers nothing for a format the browser cannot decode', () => {
    expect(workspacesFor(FORMATS.heic)).toEqual([]);
    expect(workspacesFor(FORMATS.tiff)).toEqual([]);
  });
});

describe('defaultWorkspaceFor', () => {
  it('opens the editor, not the converter', () => {
    expect(defaultWorkspaceFor(FORMATS.png)).toBe('image');
    expect(defaultWorkspaceFor(FORMATS.wav)).toBe('audio');
    expect(defaultWorkspaceFor(FORMATS.webm)).toBe('video');
  });
});
