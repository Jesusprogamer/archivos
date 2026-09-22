// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TRANSFORM, NEUTRAL_COLOR, NO_TRANSITION, createProject, type MediaClip } from './project';
import { addClip, addTrack } from './timeline';
import {
  applySourceMapping,
  deleteSavedProject,
  listSavedProjects,
  loadProject,
  rebindSources,
  saveProject,
  type SavedProject,
} from './autosave';

function projectWithSource(sourceId: string) {
  let project = createProject('proj1', 'Test');
  const track = addTrack(project, 'video', 'V1');
  project = track.project;
  const clip: MediaClip = {
    id: 'c1',
    trackId: track.track.id,
    kind: 'video',
    sourceId,
    start: 0,
    duration: 5,
    inPoint: 0,
    speed: 1,
    keepPitch: true,
    volume: 1,
    muted: false,
    color: NEUTRAL_COLOR,
    transform: DEFAULT_TRANSFORM,
    keyframes: {},
    beatPunch: 0,
    fadeIn: 0,
    fadeOut: 0,
    transition: NO_TRANSITION,
  };
  return addClip(project, clip);
}

describe('autosave storage', () => {
  beforeEach(() => localStorage.clear());

  it('saves and reads a project back', () => {
    const project = projectWithSource('media_a');
    saveProject(project, [{ sourceId: 'media_a', name: 'clip.mp4', size: 123 }]);

    const loaded = loadProject('proj1');
    expect(loaded?.project.name).toBe('Test');
    expect(loaded?.sources[0]?.name).toBe('clip.mp4');
    expect(loaded?.savedAt).toBeGreaterThan(0);
  });

  it('replaces a previous save of the same project rather than piling up', () => {
    const project = projectWithSource('media_a');
    saveProject(project, []);
    saveProject({ ...project, name: 'Renamed' }, []);
    expect(listSavedProjects()).toHaveLength(1);
    expect(listSavedProjects()[0]?.project.name).toBe('Renamed');
  });

  it('lists the newest first', () => {
    saveProject({ ...projectWithSource('a'), id: 'old', name: 'Old' }, []);
    saveProject({ ...projectWithSource('a'), id: 'new', name: 'New' }, []);
    expect(listSavedProjects()[0]?.project.id).toBe('new');
  });

  it('deletes on request', () => {
    saveProject(projectWithSource('a'), []);
    deleteSavedProject('proj1');
    expect(loadProject('proj1')).toBeUndefined();
  });

  it('ignores anything written by an older schema', () => {
    localStorage.setItem(
      'forja.video.projects',
      JSON.stringify([{ project: { id: 'x', schema: 0 }, savedAt: 1, sources: [] }]),
    );
    expect(listSavedProjects()).toHaveLength(0);
  });

  it('survives corrupted storage instead of throwing', () => {
    localStorage.setItem('forja.video.projects', 'not json at all');
    expect(listSavedProjects()).toEqual([]);
  });
});

describe('rebindSources', () => {
  const saved: SavedProject = {
    project: projectWithSource('old_a'),
    savedAt: 0,
    sources: [
      { sourceId: 'old_a', name: 'clip.mp4', size: 100 },
      { sourceId: 'old_b', name: 'music.mp3', size: 200 },
    ],
  };

  it('matches files by name and size', () => {
    const { mapping, missing } = rebindSources(saved, [
      { id: 'new_1', name: 'music.mp3', size: 200 },
      { id: 'new_2', name: 'clip.mp4', size: 100 },
    ]);
    expect(mapping.get('old_a')).toBe('new_2');
    expect(mapping.get('old_b')).toBe('new_1');
    expect(missing).toHaveLength(0);
  });

  it('reports what it could not find rather than dropping it quietly', () => {
    const { mapping, missing } = rebindSources(saved, [
      { id: 'new_2', name: 'clip.mp4', size: 100 },
    ]);
    expect(mapping.size).toBe(1);
    expect(missing.map((entry) => entry.name)).toEqual(['music.mp3']);
  });

  it('refuses a same-named file of a different size', () => {
    const { missing } = rebindSources(saved, [{ id: 'x', name: 'clip.mp4', size: 999 }]);
    expect(missing.map((entry) => entry.name)).toContain('clip.mp4');
  });

  it('never binds two sources to the same file', () => {
    const twin: SavedProject = {
      ...saved,
      sources: [
        { sourceId: 'one', name: 'clip.mp4', size: 100 },
        { sourceId: 'two', name: 'clip.mp4', size: 100 },
      ],
    };
    const { mapping, missing } = rebindSources(twin, [{ id: 'only', name: 'clip.mp4', size: 100 }]);
    expect(mapping.size).toBe(1);
    expect(missing).toHaveLength(1);
  });
});

describe('applySourceMapping', () => {
  it('rewrites clip source ids', () => {
    const project = projectWithSource('old_a');
    const remapped = applySourceMapping(project, new Map([['old_a', 'new_a']]));
    expect((remapped.tracks[0]!.clips[0] as MediaClip).sourceId).toBe('new_a');
  });

  it('leaves unmapped clips alone', () => {
    const project = projectWithSource('untouched');
    const remapped = applySourceMapping(project, new Map([['other', 'x']]));
    expect((remapped.tracks[0]!.clips[0] as MediaClip).sourceId).toBe('untouched');
  });
});
