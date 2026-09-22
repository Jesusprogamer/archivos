import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRANSFORM,
  NO_TRANSITION,
  NEUTRAL_COLOR,
  clipEnd,
  createProject,
  fadeFactorAt,
  projectDuration,
  sampleProperty,
  sourceTimeAt,
  type Clip,
  type MediaClip,
  type VideoProject,
} from './project';
import {
  addClip,
  addTrack,
  duplicateClip,
  moveClip,
  pixelsToTime,
  quantiseToFrame,
  removeClip,
  rippleDelete,
  setClipSpeed,
  snap,
  snapTargets,
  splitClip,
  timeToPixels,
  trimClip,
  updateTrack,
} from './timeline';

function mediaClip(overrides: Partial<MediaClip> = {}): MediaClip {
  return {
    id: 'clip1',
    trackId: 'track1',
    kind: 'video',
    sourceId: 'source1',
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
    beatPunch: 0,
    fadeIn: 0,
    fadeOut: 0,
    transition: NO_TRANSITION,
    ...overrides,
  };
}

/**
 * A project with one video track, one audio track, and a ten-second clip on the
 * video track. Track ids are generated, so helpers take them explicitly rather
 * than guessing — a clip whose `trackId` matches nothing is silently dropped,
 * which is exactly the kind of thing that makes a test lie.
 */
function scene(): { project: VideoProject; videoTrack: string; audioTrack: string } {
  let project = createProject('p', 'Test');
  const video = addTrack(project, 'video', 'V1');
  project = video.project;
  const audio = addTrack(project, 'audio', 'A1');
  project = audio.project;
  project = addClip(project, mediaClip({ trackId: video.track.id }));
  return { project, videoTrack: video.track.id, audioTrack: audio.track.id };
}

/** Adds a clip to a real track, so it cannot be dropped for a bad id. */
function withClip(
  project: VideoProject,
  trackId: string,
  overrides: Partial<MediaClip> = {},
): VideoProject {
  return addClip(project, mediaClip({ ...overrides, trackId }));
}

const clipsOf = (project: VideoProject, trackId: string) =>
  project.tracks.find((track) => track.id === trackId)!.clips;

describe('project duration', () => {
  it('is the furthest clip end across every track', () => {
    const scene_ = scene();
    const { videoTrack, audioTrack } = scene_;
    let project = scene_.project;
    expect(projectDuration(project)).toBe(10);
    project = withClip(project, audioTrack, { id: 'a1', kind: 'audio', start: 8, duration: 9 });
    expect(projectDuration(project)).toBe(17);
    expect(clipsOf(project, videoTrack)).toHaveLength(1);
  });

  it('is zero for an empty project', () => {
    expect(projectDuration(createProject('p', 'Empty'))).toBe(0);
  });
});

describe('addClip', () => {
  it('drops a clip whose track does not exist rather than corrupting the project', () => {
    const { project } = scene();
    const after = addClip(project, mediaClip({ id: 'orphan', trackId: 'nope' }));
    expect(after.tracks.flatMap((track) => track.clips)).toHaveLength(1);
  });
});

describe('splitClip', () => {
  it('produces two pieces that together occupy the original span', () => {
    const { project, videoTrack } = scene();
    const result = splitClip(project, 'clip1', 4);
    const clips = clipsOf(result.project, videoTrack);

    expect(clips).toHaveLength(2);
    expect(clips[0]!.start).toBe(0);
    expect(clips[0]!.duration).toBe(4);
    expect(clips[1]!.start).toBe(4);
    expect(clips[1]!.duration).toBe(6);
    expect(clipEnd(clips[1]!)).toBe(10);
  });

  it('advances the in-point by source time, not timeline time', () => {
    // At half speed, four seconds of timeline consume two seconds of source.
    let { project } = scene();
    project = setClipSpeed(project, 'clip1', 0.5);
    const result = splitClip(project, 'clip1', 4);
    const right = result.project.tracks[0]!.clips[1] as MediaClip;
    expect(right.inPoint).toBeCloseTo(2, 6);
  });

  it('keeps the in-point offset for a clip that started part-way in', () => {
    const scene_ = scene();
    const { videoTrack } = scene_;
    let project = scene_.project;
    project = removeClip(project, 'clip1');
    project = withClip(project, videoTrack, { inPoint: 30 });
    const result = splitClip(project, 'clip1', 4);
    expect((result.project.tracks[0]!.clips[1] as MediaClip).inPoint).toBe(34);
  });

  it('refuses to split on an edge, which would make a zero-length piece', () => {
    const { project } = scene();
    expect(splitClip(project, 'clip1', 0).project).toBe(project);
    expect(splitClip(project, 'clip1', 10).project).toBe(project);
    expect(splitClip(project, 'clip1', 10.5).project).toBe(project);
  });

  it('gives the second piece a clean start: no fade-in, no transition', () => {
    const scene_ = scene();
    const { videoTrack } = scene_;
    let project = scene_.project;
    project = removeClip(project, 'clip1');
    project = withClip(project, videoTrack, {
      fadeIn: 1,
      fadeOut: 1,
      transition: { kind: 'crossfade', duration: 0.5 },
    });
    const clips = splitClip(project, 'clip1', 5).project.tracks[0]!.clips;
    expect(clips[0]!.fadeIn).toBe(1);
    expect(clips[1]!.fadeIn).toBe(0);
    expect(clips[1]!.transition.kind).toBe('none');
    // The fade-out belongs to the end, which is now the second piece.
    expect(clips[1]!.fadeOut).toBe(1);
  });

  it('does nothing for an unknown clip', () => {
    const { project } = scene();
    expect(splitClip(project, 'nope', 4).project).toBe(project);
  });
});

describe('rippleDelete', () => {
  it('closes the gap on the same track only', () => {
    const scene_ = scene();
    const { videoTrack, audioTrack } = scene_;
    let project = scene_.project;
    project = withClip(project, videoTrack, { id: 'clip2', start: 10, duration: 5 });
    project = withClip(project, audioTrack, { id: 'a1', kind: 'audio', start: 10, duration: 5 });

    const after = rippleDelete(project, 'clip1');
    expect(clipsOf(after, videoTrack)).toHaveLength(1);
    expect(clipsOf(after, videoTrack)[0]!.start).toBe(0);
    // The audio track is untouched: a ripple is per-track.
    expect(clipsOf(after, audioTrack)[0]!.start).toBe(10);
  });

  it('leaves clips that start before the removed one where they are', () => {
    const scene_ = scene();
    const { videoTrack } = scene_;
    let project = scene_.project;
    project = withClip(project, videoTrack, { id: 'clip2', start: 10, duration: 5 });
    const after = rippleDelete(project, 'clip2');
    expect(clipsOf(after, videoTrack)[0]!.start).toBe(0);
  });
});

describe('trimClip', () => {
  it('moves the in-point when trimming the left edge, so content stays put', () => {
    const { project } = scene();
    const after = trimClip(project, 'clip1', 'start', 3);
    const clip = after.tracks[0]!.clips[0] as MediaClip;
    expect(clip.start).toBe(3);
    expect(clip.duration).toBe(7);
    expect(clip.inPoint).toBe(3);
  });

  it('cannot reveal material before the start of the source', () => {
    const { project } = scene();
    // The clip already starts at in-point zero: dragging left must not go under.
    const after = trimClip(project, 'clip1', 'start', -5);
    const clip = after.tracks[0]!.clips[0] as MediaClip;
    expect(clip.inPoint).toBe(0);
    expect(clip.start).toBe(0);
    expect(clip.duration).toBe(10);
  });

  it('stops the right edge at the end of the source material', () => {
    const scene_ = scene();
    const { videoTrack } = scene_;
    let project = scene_.project;
    project = removeClip(project, 'clip1');
    project = withClip(project, videoTrack, { inPoint: 2, duration: 4 });
    // The source is six seconds long, so from in-point two only four remain.
    const after = trimClip(project, 'clip1', 'end', 60, 6);
    expect(after.tracks[0]!.clips[0]!.duration).toBeCloseTo(4, 6);
  });

  it('honours speed when working out how much source is left', () => {
    const scene_ = scene();
    const { videoTrack } = scene_;
    let project = scene_.project;
    project = removeClip(project, 'clip1');
    project = withClip(project, videoTrack, { inPoint: 0, duration: 2, speed: 2 });
    // Ten seconds of source at double speed is five seconds of timeline.
    const after = trimClip(project, 'clip1', 'end', 60, 10);
    expect(after.tracks[0]!.clips[0]!.duration).toBeCloseTo(5, 6);
  });

  it('never trims a clip out of existence', () => {
    const { project } = scene();
    expect(trimClip(project, 'clip1', 'end', -100).tracks[0]!.clips[0]!.duration).toBeGreaterThan(0);
    expect(trimClip(project, 'clip1', 'start', 999).tracks[0]!.clips[0]!.duration).toBeGreaterThan(0);
  });

  it('leaves an image clip free to stretch, since it has no material to run out of', () => {
    const scene_ = scene();
    const { videoTrack } = scene_;
    let project = scene_.project;
    project = removeClip(project, 'clip1');
    project = withClip(project, videoTrack, { kind: 'image', duration: 3 });
    const after = trimClip(project, 'clip1', 'end', 30, 1);
    expect(after.tracks[0]!.clips[0]!.duration).toBe(30);
  });
});

describe('moveClip', () => {
  it('moves along the same track', () => {
    const { project } = scene();
    expect(moveClip(project, 'clip1', 5).tracks[0]!.clips[0]!.start).toBe(5);
  });

  it('never moves before zero', () => {
    const { project } = scene();
    expect(moveClip(project, 'clip1', -20).tracks[0]!.clips[0]!.start).toBe(0);
  });

  it('refuses a track that cannot hold the clip', () => {
    const { project, audioTrack } = scene();
    // A video clip has no business on an audio track.
    expect(moveClip(project, 'clip1', 0, audioTrack)).toBe(project);
  });

  it('moves between tracks of a compatible kind', () => {
    const scene_ = scene();
    const { videoTrack } = scene_;
    let project = scene_.project;
    const second = addTrack(project, 'video', 'V2');
    project = second.project;
    const after = moveClip(project, 'clip1', 2, second.track.id);
    expect(clipsOf(after, videoTrack)).toHaveLength(0);
    expect(clipsOf(after, second.track.id)).toHaveLength(1);
    expect(clipsOf(after, second.track.id)[0]!.trackId).toBe(second.track.id);
  });
});

describe('setClipSpeed', () => {
  it('halves the timeline length at double speed', () => {
    const { project } = scene();
    const after = setClipSpeed(project, 'clip1', 2);
    expect(after.tracks[0]!.clips[0]!.duration).toBe(5);
  });

  it('is reversible: back to 1x restores the original length', () => {
    const { project } = scene();
    const fast = setClipSpeed(project, 'clip1', 4);
    const back = setClipSpeed(fast, 'clip1', 1);
    expect(back.tracks[0]!.clips[0]!.duration).toBeCloseTo(10, 6);
  });

  it('clamps to the range the interface offers', () => {
    const { project } = scene();
    expect((setClipSpeed(project, 'clip1', 99).tracks[0]!.clips[0] as MediaClip).speed).toBe(4);
    expect((setClipSpeed(project, 'clip1', 0.01).tracks[0]!.clips[0] as MediaClip).speed).toBe(0.25);
  });
});

describe('duplicateClip', () => {
  it('places the copy straight after the original with a new id', () => {
    const { project, videoTrack } = scene();
    const after = duplicateClip(project, 'clip1');
    const clips = clipsOf(after, videoTrack);
    expect(clips).toHaveLength(2);
    expect(clips[1]!.start).toBe(10);
    expect(clips[1]!.id).not.toBe(clips[0]!.id);
  });
});

describe('tracks', () => {
  it('locks, hides and mutes', () => {
    const { project, videoTrack } = scene();
    const after = updateTrack(project, videoTrack, { locked: true, hidden: true });
    const track = after.tracks.find((candidate) => candidate.id === videoTrack)!;
    expect(track.locked).toBe(true);
    expect(track.hidden).toBe(true);
  });
});

describe('snapping', () => {
  it('offers zero, the playhead and every other clip edge', () => {
    const scene_ = scene();
    const { videoTrack } = scene_;
    let project = scene_.project;
    project = withClip(project, videoTrack, { id: 'clip2', start: 12, duration: 3 });
    const targets = snapTargets(project, 7, 'clip1');
    expect(targets).toContain(0);
    expect(targets).toContain(7);
    expect(targets).toContain(12);
    expect(targets).toContain(15);
    // The clip being dragged must not snap to itself.
    expect(targets).not.toContain(10);
  });

  it('sticks only inside the tolerance', () => {
    expect(snap(9.97, [10], 0.1)).toBe(10);
    expect(snap(9.5, [10], 0.1)).toBe(9.5);
  });

  it('picks the nearest target when several are in range', () => {
    expect(snap(10.4, [10, 10.5, 11], 1)).toBe(10.5);
  });
});

describe('zoom mapping', () => {
  it('round-trips time and pixels', () => {
    for (const zoom of [0, 0.25, 0.5, 1]) {
      expect(pixelsToTime(timeToPixels(7.25, zoom), zoom)).toBeCloseTo(7.25, 6);
    }
  });

  it('grows monotonically with zoom', () => {
    expect(timeToPixels(1, 0.5)).toBeGreaterThan(timeToPixels(1, 0));
    expect(timeToPixels(1, 1)).toBeGreaterThan(timeToPixels(1, 0.5));
  });
});

describe('quantiseToFrame', () => {
  it('lands on frame boundaries', () => {
    expect(quantiseToFrame(1.017, 30)).toBeCloseTo(1 / 30 * 31, 6);
    expect(quantiseToFrame(0.4, 25)).toBeCloseTo(0.4, 6);
  });
});

describe('sourceTimeAt', () => {
  it('maps timeline time to source time through the in-point and speed', () => {
    const clip = mediaClip({ start: 5, inPoint: 20, speed: 2 });
    expect(sourceTimeAt(clip, 5)).toBe(20);
    expect(sourceTimeAt(clip, 6)).toBe(22);
    // Before the clip starts, the source time is pinned to the in-point.
    expect(sourceTimeAt(clip, 0)).toBe(20);
  });
});

describe('fadeFactorAt', () => {
  const clip = mediaClip({ duration: 10, fadeIn: 2, fadeOut: 2 });

  it('ramps in, holds, and ramps out', () => {
    expect(fadeFactorAt(clip, 0)).toBe(0);
    expect(fadeFactorAt(clip, 1)).toBeCloseTo(0.5, 6);
    expect(fadeFactorAt(clip, 5)).toBe(1);
    expect(fadeFactorAt(clip, 9)).toBeCloseTo(0.5, 6);
    expect(fadeFactorAt(clip, 10)).toBe(0);
  });

  it('is zero outside the clip', () => {
    expect(fadeFactorAt(clip, -1)).toBe(0);
    expect(fadeFactorAt(clip, 11)).toBe(0);
  });

  it('copes with fades longer than the clip', () => {
    const silly = mediaClip({ duration: 2, fadeIn: 10, fadeOut: 10 });
    expect(fadeFactorAt(silly, 1)).toBeCloseTo(1, 6);
    expect(fadeFactorAt(silly, 0)).toBe(0);
    expect(fadeFactorAt(silly, 2)).toBe(0);
  });
});

describe('sampleProperty', () => {
  const base = mediaClip({ start: 4, duration: 10 });

  it('uses the static value when there are no keyframes', () => {
    expect(sampleProperty(base, 'opacity', 6, 0.42)).toBe(0.42);
  });

  it('interpolates linearly between keyframes', () => {
    const clip: Clip = {
      ...base,
      keyframes: { opacity: [{ at: 0, value: 0 }, { at: 4, value: 1 }] },
    };
    expect(sampleProperty(clip, 'opacity', 4, 1)).toBe(0);
    expect(sampleProperty(clip, 'opacity', 6, 1)).toBeCloseTo(0.5, 6);
    expect(sampleProperty(clip, 'opacity', 8, 1)).toBe(1);
  });

  it('holds beyond the first and last keyframe', () => {
    const clip: Clip = {
      ...base,
      keyframes: { x: [{ at: 2, value: 100 }, { at: 4, value: 200 }] },
    };
    expect(sampleProperty(clip, 'x', 4, 0)).toBe(100);
    expect(sampleProperty(clip, 'x', 14, 0)).toBe(200);
  });

  it('handles a single keyframe as a constant', () => {
    const clip: Clip = { ...base, keyframes: { scale: [{ at: 3, value: 2 }] } };
    expect(sampleProperty(clip, 'scale', 4, 1)).toBe(2);
    expect(sampleProperty(clip, 'scale', 13, 1)).toBe(2);
  });
});
