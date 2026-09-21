import { describe, expect, it } from 'vitest';
import { createAudio, durationOf, frameCount, peakOf, type AudioData } from '../audio/buffer';
import { addClip, addTrack } from './timeline';
import {
  DEFAULT_TRANSFORM,
  NEUTRAL_COLOR,
  NO_TRANSITION,
  createProject,
  type MediaClip,
  type VideoProject,
} from './project';
import { mixProject, renderClipAudio } from './mixdown';

const RATE = 8000;

/** A constant-amplitude buffer, so gains and fades are easy to read off. */
function flat(value: number, seconds: number, rate = RATE): AudioData {
  const audio = createAudio(2, Math.round(seconds * rate), rate);
  for (const channel of audio.channels) channel.fill(value);
  return audio;
}

function audioClip(overrides: Partial<MediaClip> = {}): MediaClip {
  return {
    id: 'a1',
    trackId: 'track',
    kind: 'audio',
    sourceId: 'src',
    start: 0,
    duration: 2,
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

function projectWith(clips: Partial<MediaClip>[]): VideoProject {
  let project = createProject('p', 'Mix');
  const track = addTrack(project, 'audio', 'A1');
  project = track.project;
  for (const clip of clips) {
    project = addClip(project, audioClip({ ...clip, trackId: track.track.id }));
  }
  return project;
}

describe('renderClipAudio', () => {
  it('takes exactly the clip length, from the in-point', () => {
    const out = renderClipAudio(audioClip({ inPoint: 1, duration: 2 }), flat(0.5, 10), RATE);
    expect(durationOf(out)).toBeCloseTo(2, 3);
    expect(out.channels[0]![0]).toBeCloseTo(0.5, 6);
  });

  it('applies the clip volume', () => {
    const out = renderClipAudio(audioClip({ volume: 0.25 }), flat(1, 5), RATE);
    expect(out.channels[0]![10]).toBeCloseTo(0.25, 6);
  });

  it('produces silence for a muted clip', () => {
    const out = renderClipAudio(audioClip({ muted: true }), flat(1, 5), RATE);
    expect(peakOf(out)).toBe(0);
  });

  it('fades in and out over the requested seconds', () => {
    const out = renderClipAudio(audioClip({ duration: 2, fadeIn: 1, fadeOut: 1 }), flat(1, 5), RATE);
    expect(out.channels[0]![0]).toBeCloseTo(0, 3);
    expect(out.channels[0]![Math.round(RATE)]).toBeGreaterThan(0.9);
    expect(out.channels[0]!.at(-1)).toBeCloseTo(0, 2);
  });

  it('consumes source in proportion to the speed, and still fills the clip', () => {
    // Two seconds of timeline at double speed uses four seconds of source.
    const out = renderClipAudio(audioClip({ duration: 2, speed: 2 }), flat(0.4, 10), RATE);
    expect(durationOf(out)).toBeCloseTo(2, 2);
  });

  it('resamples a source recorded at another rate', () => {
    const out = renderClipAudio(audioClip({ duration: 1 }), flat(0.3, 3, 44100), RATE);
    expect(out.sampleRate).toBe(RATE);
    expect(durationOf(out)).toBeCloseTo(1, 2);
    expect(out.channels[0]![100]).toBeCloseTo(0.3, 4);
  });

  it('returns nothing when the in-point is past the end of the source', () => {
    const out = renderClipAudio(audioClip({ inPoint: 99 }), flat(1, 2), RATE);
    expect(frameCount(out)).toBe(0);
  });
});

describe('mixProject', () => {
  it('places each clip at its own start time', () => {
    const project = projectWith([
      { id: 'a', start: 0, duration: 1 },
      { id: 'b', start: 2, duration: 1 },
    ]);
    const { audio } = mixProject(project, () => flat(0.5, 5), RATE);

    expect(audio.channels[0]![Math.round(0.5 * RATE)]).toBeCloseTo(0.5, 5);
    // The gap between them really is silent.
    expect(audio.channels[0]![Math.round(1.5 * RATE)]).toBeCloseTo(0, 6);
    expect(audio.channels[0]![Math.round(2.5 * RATE)]).toBeCloseTo(0.5, 5);
  });

  it('sums overlapping clips rather than replacing one with the other', () => {
    const project = projectWith([
      { id: 'a', start: 0, duration: 2 },
      { id: 'b', start: 0, duration: 2 },
    ]);
    const { audio, peak } = mixProject(project, () => flat(0.4, 5), RATE);
    expect(audio.channels[0]![100]).toBeCloseTo(0.8, 5);
    expect(peak).toBeCloseTo(0.8, 5);
  });

  it('reports a peak above full scale instead of quietly squashing it', () => {
    const project = projectWith([
      { id: 'a', start: 0, duration: 1 },
      { id: 'b', start: 0, duration: 1 },
      { id: 'c', start: 0, duration: 1 },
    ]);
    const { peak } = mixProject(project, () => flat(0.5, 2), RATE);
    expect(peak).toBeGreaterThan(1);
  });

  it('honours a muted track', () => {
    let project = projectWith([{ id: 'a', start: 0, duration: 1 }]);
    project = {
      ...project,
      tracks: project.tracks.map((track) => ({ ...track, muted: true })),
    };
    expect(peakOf(mixProject(project, () => flat(1, 2), RATE).audio)).toBe(0);
  });

  it('ignores clips whose source has not been decoded', () => {
    const project = projectWith([{ id: 'a', start: 0, duration: 1 }]);
    expect(peakOf(mixProject(project, () => undefined, RATE).audio)).toBe(0);
  });

  it('is as long as the project, not as long as the last clip alone', () => {
    const project = projectWith([
      { id: 'a', start: 0, duration: 1 },
      { id: 'b', start: 4, duration: 1 },
    ]);
    const { audio } = mixProject(project, () => flat(0.5, 5), RATE);
    expect(durationOf(audio)).toBeCloseTo(5, 2);
  });

  it('gives a silent buffer for a project with nothing in it', () => {
    const { audio, peak } = mixProject(createProject('p', 'Empty'), () => undefined, RATE);
    expect(peak).toBe(0);
    expect(frameCount(audio)).toBeGreaterThan(0);
  });
});
