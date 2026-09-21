// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { VideoEditor } from './editor';
import { clipEnd, projectDuration, type MediaClip } from './project';

function editorWithClip(): { editor: VideoEditor; trackId: string; clipId: string } {
  const editor = new VideoEditor();
  const track = editor.addTrack('video', 'V1');
  const clip = editor.addMediaClip(track.id, 'src1', 'video', 10, 0);
  return { editor, trackId: track.id, clipId: clip.id };
}

describe('VideoEditor — history', () => {
  beforeEach(() => localStorage.clear());

  it('records every change and walks back through them', () => {
    const { editor, clipId } = editorWithClip();
    editor.updateClip(clipId, { duration: 5 });
    expect(projectDuration(editor.getProject())).toBe(5);

    editor.undo();
    expect(projectDuration(editor.getProject())).toBe(10);
    editor.redo();
    expect(projectDuration(editor.getProject())).toBe(5);
  });

  it('is unlimited, because a project is small however much video it points at', () => {
    const { editor, clipId } = editorWithClip();
    for (let i = 1; i <= 60; i += 1) editor.updateClip(clipId, { duration: i });
    expect(projectDuration(editor.getProject())).toBe(60);

    // Sixty steps back and every one of them is still there.
    for (let i = 0; i < 60; i += 1) editor.undo();
    expect(projectDuration(editor.getProject())).toBe(10);
  });

  it('discards the redo stack once a new change is made', () => {
    const { editor, clipId } = editorWithClip();
    editor.updateClip(clipId, { duration: 5 });
    editor.undo();
    expect(editor.canRedo).toBe(true);
    editor.updateClip(clipId, { duration: 7 });
    expect(editor.canRedo).toBe(false);
  });

  it('records nothing when an operation changes nothing', () => {
    const { editor } = editorWithClip();
    const before = editor.getSnapshot();
    editor.updateClip('does-not-exist', { duration: 1 });
    editor.removeClip('does-not-exist');
    expect(editor.getSnapshot()).toBe(before);
  });

  it('clears a selection that undo made disappear', () => {
    const { editor, trackId } = editorWithClip();
    const second = editor.addMediaClip(trackId, 'src1', 'video', 3, 20);
    expect(editor.selectedId).toBe(second.id);
    editor.undo();
    expect(editor.selectedId).toBeUndefined();
  });
});

describe('VideoEditor — splitting at the playhead', () => {
  beforeEach(() => localStorage.clear());

  it('splits the selected clip and selects the new piece', () => {
    const { editor, trackId, clipId } = editorWithClip();
    editor.select(clipId);
    editor.setPlayhead(4);
    editor.splitAtPlayhead();

    const clips = editor.getProject().tracks.find((track) => track.id === trackId)!.clips;
    expect(clips).toHaveLength(2);
    expect(editor.selectedId).toBe(clips[1]!.id);
    expect(clipEnd(clips[1]!)).toBe(10);
  });

  it('does nothing with no clip selected', () => {
    const { editor } = editorWithClip();
    editor.select(undefined);
    editor.setPlayhead(4);
    editor.splitAtPlayhead();
    expect(editor.getProject().tracks[0]!.clips).toHaveLength(1);
  });
});

describe('VideoEditor — tracks', () => {
  beforeEach(() => localStorage.clear());

  it('puts new video tracks on top and audio tracks at the bottom', () => {
    const editor = new VideoEditor();
    editor.addTrack('video', 'V1');
    editor.addTrack('audio', 'A1');
    editor.addTrack('video', 'V2');

    const kinds = editor.getProject().tracks.map((track) => track.kind);
    // Video above, audio last: the order the timeline shows.
    expect(kinds[0]).toBe('video');
    expect(kinds.at(-1)).toBe('audio');
  });

  it('reuses an existing track of a kind instead of piling up new ones', () => {
    const editor = new VideoEditor();
    const first = editor.ensureTrack('text', 'T1');
    const second = editor.ensureTrack('text', 'T1');
    expect(second.id).toBe(first.id);
    expect(editor.getProject().tracks).toHaveLength(1);
  });

  it('removing a track takes its clips with it', () => {
    const { editor, trackId } = editorWithClip();
    editor.removeTrack(trackId);
    expect(editor.getProject().tracks).toHaveLength(0);
    expect(projectDuration(editor.getProject())).toBe(0);
  });
});

describe('VideoEditor — clips', () => {
  beforeEach(() => localStorage.clear());

  it('adds a media clip at the playhead by default', () => {
    const editor = new VideoEditor();
    const track = editor.addTrack('video', 'V1');
    editor.setPlayhead(6);
    const clip = editor.addMediaClip(track.id, 'src', 'video', 4);
    expect(clip.start).toBe(6);
  });

  it('adds a text clip with a sensible default style', () => {
    const editor = new VideoEditor();
    const track = editor.addTrack('text', 'T1');
    const clip = editor.addTextClip(track.id, 0, 3);
    expect(clip.style.text).not.toBe('');
    expect(clip.duration).toBe(3);
  });

  it('ripple delete pulls later clips back', () => {
    const { editor, trackId, clipId } = editorWithClip();
    editor.addMediaClip(trackId, 'src1', 'video', 5, 10);
    editor.rippleDelete(clipId);
    expect(editor.getProject().tracks[0]!.clips[0]!.start).toBe(0);
  });

  it('changing speed changes how much timeline the clip takes', () => {
    const { editor, clipId } = editorWithClip();
    editor.setClipSpeed(clipId, 2);
    const clip = editor.getProject().tracks[0]!.clips[0] as MediaClip;
    expect(clip.speed).toBe(2);
    expect(clip.duration).toBe(5);
  });
});

describe('VideoEditor — autosave', () => {
  beforeEach(() => localStorage.clear());

  it('writes the project when asked, with its source fingerprints', () => {
    const { editor } = editorWithClip();
    editor.setFingerprints([{ sourceId: 'src1', name: 'clip.mp4', size: 42 }]);
    editor.saveNow();

    const raw = localStorage.getItem('forja.video.projects');
    expect(raw).toContain('clip.mp4');
  });

  it('restores a loaded project and forgets the old history', () => {
    const { editor, clipId } = editorWithClip();
    editor.updateClip(clipId, { duration: 2 });
    const snapshot = editor.getProject();

    const fresh = new VideoEditor();
    fresh.load(snapshot);
    expect(projectDuration(fresh.getProject())).toBe(2);
    expect(fresh.canUndo).toBe(false);
    expect(fresh.playhead).toBe(0);
  });
});
