import { createId } from '../util/id';
import {
  clipEnd,
  isMediaClip,
  projectDuration,
  type Clip,
  type Track,
  type TrackKind,
  type VideoProject,
} from './project';

/**
 * Timeline operations.
 *
 * Every function here takes a project and returns a new one — no mutation, so
 * undo is a matter of keeping the previous object, and every operation is a
 * pure function that can be tested on its own.
 */

// ---- Tracks ----

export function addTrack(
  project: VideoProject,
  kind: TrackKind,
  name: string,
  at?: number,
): { project: VideoProject; track: Track } {
  const track: Track = {
    id: createId('track'),
    kind,
    name,
    locked: false,
    hidden: false,
    muted: false,
    clips: [],
  };
  const tracks = [...project.tracks];
  tracks.splice(at ?? tracks.length, 0, track);
  return { project: { ...project, tracks }, track };
}

export function removeTrack(project: VideoProject, trackId: string): VideoProject {
  if (!project.tracks.some((track) => track.id === trackId)) return project;
  return { ...project, tracks: project.tracks.filter((track) => track.id !== trackId) };
}

export function updateTrack(
  project: VideoProject,
  trackId: string,
  changes: Partial<Omit<Track, 'id' | 'clips'>>,
): VideoProject {
  if (!project.tracks.some((track) => track.id === trackId)) return project;
  return {
    ...project,
    tracks: project.tracks.map((track) =>
      track.id === trackId ? { ...track, ...changes } : track,
    ),
  };
}

// ---- Clips ----

/** Keeps a track's clips in start order, which the renderer relies on. */
function sortClips(clips: readonly Clip[]): readonly Clip[] {
  return [...clips].sort((a, b) => a.start - b.start);
}

/**
 * Rebuilds one track's clips.
 *
 * Returns the *same* project object when the track does not exist. That
 * identity matters: the editor records a history step whenever the project
 * reference changes, so an operation that does nothing must return exactly what
 * it was given or it leaves an undo step that undoes nothing.
 */
function mapTrack(
  project: VideoProject,
  trackId: string,
  change: (clips: readonly Clip[]) => readonly Clip[],
): VideoProject {
  if (!project.tracks.some((track) => track.id === trackId)) return project;
  return {
    ...project,
    tracks: project.tracks.map((track) =>
      track.id === trackId ? { ...track, clips: sortClips(change(track.clips)) } : track,
    ),
  };
}

/** True when any track holds this clip. Guards the no-op cases below. */
function hasClip(project: VideoProject, clipId: string): boolean {
  return project.tracks.some((track) => track.clips.some((clip) => clip.id === clipId));
}

export function addClip(project: VideoProject, clip: Clip): VideoProject {
  return mapTrack(project, clip.trackId, (clips) => [...clips, clip]);
}

export function removeClip(project: VideoProject, clipId: string): VideoProject {
  if (!hasClip(project, clipId)) return project;
  return {
    ...project,
    tracks: project.tracks.map((track) => ({
      ...track,
      clips: track.clips.filter((clip) => clip.id !== clipId),
    })),
  };
}

export function updateClip(
  project: VideoProject,
  clipId: string,
  changes: Partial<Clip>,
): VideoProject {
  if (!hasClip(project, clipId)) return project;
  return {
    ...project,
    tracks: project.tracks.map((track) => ({
      ...track,
      clips: sortClips(
        track.clips.map((clip) => (clip.id === clipId ? ({ ...clip, ...changes } as Clip) : clip)),
      ),
    })),
  };
}

/**
 * Removes a clip and pulls everything after it on the same track backwards,
 * closing the hole. The plain delete leaves the gap; both are useful, so both
 * exist.
 */
export function rippleDelete(project: VideoProject, clipId: string): VideoProject {
  const track = project.tracks.find((candidate) =>
    candidate.clips.some((clip) => clip.id === clipId),
  );
  const clip = track?.clips.find((candidate) => candidate.id === clipId);
  if (!track || !clip) return project;

  return mapTrack(project, track.id, (clips) =>
    clips
      .filter((candidate) => candidate.id !== clipId)
      .map((candidate) =>
        candidate.start >= clipEnd(clip)
          ? { ...candidate, start: candidate.start - clip.duration }
          : candidate,
      ),
  );
}

/**
 * Splits a clip at a moment on the timeline.
 *
 * The right-hand piece keeps playing from where the left one stopped, which for
 * a media clip means advancing its in-point by the elapsed source time — not by
 * the timeline time, because a clip at half speed consumes source more slowly.
 */
export function splitClip(
  project: VideoProject,
  clipId: string,
  atTime: number,
): { project: VideoProject; newClipId?: string } {
  const track = project.tracks.find((candidate) =>
    candidate.clips.some((clip) => clip.id === clipId),
  );
  const clip = track?.clips.find((candidate) => candidate.id === clipId);
  if (!track || !clip) return { project };

  const offset = atTime - clip.start;
  // A split exactly on an edge would create a zero-length piece.
  if (offset <= 1e-6 || offset >= clip.duration - 1e-6) return { project };

  const newId = createId('clip');
  const left: Clip = { ...clip, duration: offset };
  const right: Clip = isMediaClip(clip)
    ? {
        ...clip,
        id: newId,
        start: atTime,
        duration: clip.duration - offset,
        inPoint: clip.inPoint + offset * clip.speed,
        // The second half starts cold: a fade-in belongs to the first piece.
        fadeIn: 0,
        transition: { kind: 'none', duration: 0 },
      }
    : {
        ...clip,
        id: newId,
        start: atTime,
        duration: clip.duration - offset,
        fadeIn: 0,
        transition: { kind: 'none', duration: 0 },
      };

  return {
    project: mapTrack(project, track.id, (clips) => [
      ...clips.filter((candidate) => candidate.id !== clipId),
      left,
      right,
    ]),
    newClipId: newId,
  };
}

/**
 * Trims a clip's left or right edge.
 *
 * Trimming the left edge moves the in-point as well, so the visible content
 * stays put instead of sliding: dragging the start of a clip should reveal or
 * hide its beginning, not re-time what is under the playhead.
 */
export function trimClip(
  project: VideoProject,
  clipId: string,
  edge: 'start' | 'end',
  toTime: number,
  /** The source's full length, to stop a trim running past the material. */
  sourceDuration?: number,
): VideoProject {
  const clip = project.tracks.flatMap((track) => track.clips).find((c) => c.id === clipId);
  if (!clip) return project;

  const MIN = 0.05;
  if (edge === 'end') {
    const maxByTime = toTime - clip.start;
    let duration = Math.max(MIN, maxByTime);
    if (isMediaClip(clip) && sourceDuration !== undefined && clip.kind !== 'image') {
      const available = (sourceDuration - clip.inPoint) / clip.speed;
      duration = Math.min(duration, Math.max(MIN, available));
    }
    return updateClip(project, clipId, { duration });
  }

  const latestStart = clipEnd(clip) - MIN;
  const start = Math.max(0, Math.min(toTime, latestStart));
  const delta = start - clip.start;
  const duration = clip.duration - delta;

  if (isMediaClip(clip) && clip.kind !== 'image') {
    const inPoint = Math.max(0, clip.inPoint + delta * clip.speed);
    // Cannot reveal material before the start of the source.
    if (clip.inPoint + delta * clip.speed < 0) {
      const allowed = -clip.inPoint / clip.speed;
      return updateClip(project, clipId, {
        start: clip.start + allowed,
        duration: clip.duration - allowed,
        inPoint: 0,
      });
    }
    return updateClip(project, clipId, { start, duration, inPoint } );
  }
  return updateClip(project, clipId, { start, duration } );
}

/** Moves a clip, optionally to another track, never before zero. */
export function moveClip(
  project: VideoProject,
  clipId: string,
  toStart: number,
  toTrackId?: string,
): VideoProject {
  const from = project.tracks.find((track) => track.clips.some((clip) => clip.id === clipId));
  const clip = from?.clips.find((candidate) => candidate.id === clipId);
  if (!from || !clip) return project;

  const start = Math.max(0, toStart);
  const targetId = toTrackId ?? from.id;
  if (targetId === from.id) {
    return mapTrack(project, from.id, (clips) =>
      clips.map((candidate) => (candidate.id === clipId ? { ...candidate, start } : candidate)),
    );
  }

  const target = project.tracks.find((track) => track.id === targetId);
  // A video clip cannot live on an audio track, and vice versa.
  if (!target || !acceptsClip(target, clip)) return project;

  const moved = { ...clip, start, trackId: targetId } as Clip;
  return {
    ...project,
    tracks: project.tracks.map((track) => {
      if (track.id === from.id) {
        return { ...track, clips: track.clips.filter((candidate) => candidate.id !== clipId) };
      }
      if (track.id === targetId) return { ...track, clips: sortClips([...track.clips, moved]) };
      return track;
    }),
  };
}

export function acceptsClip(track: Track, clip: Clip): boolean {
  if (track.kind === 'text') return clip.kind === 'text';
  if (track.kind === 'audio') return clip.kind === 'audio';
  return clip.kind === 'video' || clip.kind === 'image';
}

export function duplicateClip(project: VideoProject, clipId: string): VideoProject {
  const clip = project.tracks.flatMap((track) => track.clips).find((c) => c.id === clipId);
  if (!clip) return project;
  // Placed immediately after the original, which is where people expect it.
  return addClip(project, { ...clip, id: createId('clip'), start: clipEnd(clip) });
}

/**
 * Changes a clip's speed, keeping its in-point and adjusting how much timeline
 * it occupies.
 */
export function setClipSpeed(
  project: VideoProject,
  clipId: string,
  speed: number,
): VideoProject {
  const clip = project.tracks.flatMap((track) => track.clips).find((c) => c.id === clipId);
  if (!clip || !isMediaClip(clip)) return project;
  const rate = Math.max(0.25, Math.min(4, speed));
  const sourceSpan = clip.duration * clip.speed;
  return updateClip(project, clipId, {
    speed: rate,
    duration: sourceSpan / rate,
  });
}

// ---- Snapping ----

/**
 * Candidate times a drag should stick to: zero, the playhead, and every clip
 * edge except the one being dragged.
 */
export function snapTargets(
  project: VideoProject,
  playhead: number,
  excludeClipId?: string,
): number[] {
  const targets = [0, playhead];
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.id === excludeClipId) continue;
      targets.push(clip.start, clipEnd(clip));
    }
  }
  return targets;
}

/** Snaps a time to the nearest target inside the tolerance, or leaves it be. */
export function snap(time: number, targets: readonly number[], tolerance: number): number {
  let best = time;
  let bestDistance = tolerance;
  for (const target of targets) {
    const distance = Math.abs(target - time);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = target;
    }
  }
  return best;
}

/**
 * Pixels per second for a zoom level.
 *
 * Exponential rather than linear: the useful range runs from "a whole hour on
 * screen" to "individual frames", and a linear slider spends most of its travel
 * in one uninteresting part of that.
 */
export function pixelsPerSecond(zoom: number): number {
  return 8 * 2 ** (zoom * 8);
}

export function timeToPixels(time: number, zoom: number): number {
  return time * pixelsPerSecond(zoom);
}

export function pixelsToTime(pixels: number, zoom: number): number {
  return pixels / pixelsPerSecond(zoom);
}

/** Rounds a time to the nearest output frame. */
export function quantiseToFrame(time: number, fps: number): number {
  return Math.round(time * fps) / fps;
}

export { projectDuration };
