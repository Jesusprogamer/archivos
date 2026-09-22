import { createId } from '../util/id';
import { saveProject, type SourceFingerprint } from './autosave';
import {
  DEFAULT_TEXT,
  DEFAULT_TRANSFORM,
  NEUTRAL_COLOR,
  NO_TRANSITION,
  clipEnd,
  createProject,
  findClip,
  findTrack,
  projectDuration,
  type Clip,
  type MediaClip,
  type TextClip,
  type Track,
  type TrackKind,
  type VideoProject,
} from './project';
import {
  addClip,
  addTrack,
  duplicateClip,
  moveClip,
  removeClip,
  removeTrack,
  rippleDelete,
  setClipSpeed,
  splitClip,
  trimClip,
  updateClip,
  updateTrack,
} from './timeline';

/**
 * The video editor engine.
 *
 * Holds the project, the selection, the playhead and the undo stack, and knows
 * nothing about React. Every timeline operation is a pure function from
 * `timeline.ts`; this class is what sequences them, records history and tells
 * subscribers something changed.
 *
 * Undo is unlimited by design. A project is a few kilobytes of JSON no matter
 * how much video it references, so there is no reason to throw steps away —
 * unlike the image and audio editors, where a snapshot is measured in hundreds
 * of megabytes.
 */

type Listener = () => void;

const AUTOSAVE_DELAY_MS = 1200;

export class VideoEditor {
  private project: VideoProject;
  private readonly past: VideoProject[] = [];
  private readonly future: VideoProject[] = [];
  private selectedClipId: string | undefined;
  private playheadSeconds = 0;
  private snapEnabled = true;
  private readonly listeners = new Set<Listener>();
  private version = 0;
  private autosaveTimer: ReturnType<typeof setTimeout> | undefined;
  private fingerprints: readonly SourceFingerprint[] = [];

  constructor(project?: VideoProject) {
    this.project = project ?? createProject(createId('project'), 'Proyecto');
  }

  // ---- Subscription ----
  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): number => this.version;

  private emit(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  // ---- Reading ----
  getProject(): VideoProject {
    return this.project;
  }

  get duration(): number {
    return projectDuration(this.project);
  }

  get playhead(): number {
    return this.playheadSeconds;
  }

  get selectedId(): string | undefined {
    return this.selectedClipId;
  }

  get selectedClip(): Clip | undefined {
    return this.selectedClipId ? findClip(this.project, this.selectedClipId) : undefined;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get snapping(): boolean {
    return this.snapEnabled;
  }

  // ---- History ----
  /** Applies a change and records it, unless nothing actually changed. */
  private apply(next: VideoProject): void {
    if (next === this.project) return;
    this.past.push(this.project);
    this.future.length = 0;
    this.project = next;
    this.scheduleAutosave();
    this.emit();
  }

  undo(): void {
    const previous = this.past.pop();
    if (!previous) return;
    this.future.push(this.project);
    this.project = previous;
    this.ensureSelectionExists();
    this.scheduleAutosave();
    this.emit();
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.project);
    this.project = next;
    this.ensureSelectionExists();
    this.scheduleAutosave();
    this.emit();
  }

  private ensureSelectionExists(): void {
    if (this.selectedClipId && !findClip(this.project, this.selectedClipId)) {
      this.selectedClipId = undefined;
    }
  }

  // ---- Autosave ----
  setFingerprints(fingerprints: readonly SourceFingerprint[]): void {
    this.fingerprints = fingerprints;
  }

  /**
   * Debounced: dragging a clip fires a change per pointer move, and writing
   * JSON to storage sixty times a second would be pure waste.
   */
  private scheduleAutosave(): void {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => {
      saveProject(this.project, this.fingerprints);
    }, AUTOSAVE_DELAY_MS);
  }

  saveNow(): void {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    saveProject(this.project, this.fingerprints);
  }

  // ---- Navigation ----
  setPlayhead(seconds: number): void {
    this.playheadSeconds = Math.max(0, Math.min(seconds, Math.max(this.duration, seconds)));
    this.emit();
  }

  select(clipId: string | undefined): void {
    this.selectedClipId = clipId;
    this.emit();
  }

  setSnapping(enabled: boolean): void {
    this.snapEnabled = enabled;
    this.emit();
  }

  // ---- Project settings ----
  setFormat(width: number, height: number, fps?: number): void {
    this.apply({ ...this.project, width, height, ...(fps ? { fps } : {}) });
  }

  rename(name: string): void {
    this.apply({ ...this.project, name });
  }

  // ---- Tracks ----
  addTrack(kind: TrackKind, name: string): Track {
    const result = addTrack(this.project, kind, name, kind === 'audio' ? undefined : 0);
    this.apply(result.project);
    return result.track;
  }

  removeTrack(trackId: string): void {
    this.apply(removeTrack(this.project, trackId));
  }

  updateTrack(trackId: string, changes: Partial<Omit<Track, 'id' | 'clips'>>): void {
    this.apply(updateTrack(this.project, trackId, changes));
  }

  /** The first track of a kind, creating one if the project has none. */
  ensureTrack(kind: TrackKind, name: string): Track {
    const existing = this.project.tracks.find((track) => track.kind === kind);
    return existing ?? this.addTrack(kind, name);
  }

  // ---- Clips ----
  addMediaClip(
    trackId: string,
    sourceId: string,
    kind: 'video' | 'image' | 'audio',
    duration: number,
    start = this.playheadSeconds,
  ): MediaClip {
    const clip: MediaClip = {
      id: createId('clip'),
      trackId,
      kind,
      sourceId,
      start,
      duration,
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
    this.apply(addClip(this.project, clip));
    this.selectedClipId = clip.id;
    return clip;
  }

  addTextClip(trackId: string, start = this.playheadSeconds, duration = 4): TextClip {
    const clip: TextClip = {
      id: createId('clip'),
      trackId,
      kind: 'text',
      start,
      duration,
      transform: DEFAULT_TRANSFORM,
      keyframes: {},
      beatPunch: 0,
      fadeIn: 0,
      fadeOut: 0,
      transition: NO_TRANSITION,
      style: DEFAULT_TEXT,
    };
    this.apply(addClip(this.project, clip));
    this.selectedClipId = clip.id;
    return clip;
  }

  updateClip(clipId: string, changes: Partial<Clip>): void {
    this.apply(updateClip(this.project, clipId, changes));
  }

  removeClip(clipId: string): void {
    this.apply(removeClip(this.project, clipId));
    if (this.selectedClipId === clipId) this.selectedClipId = undefined;
  }

  rippleDelete(clipId: string): void {
    this.apply(rippleDelete(this.project, clipId));
    if (this.selectedClipId === clipId) this.selectedClipId = undefined;
  }

  duplicateClip(clipId: string): void {
    this.apply(duplicateClip(this.project, clipId));
  }

  /** Splits whatever is under the playhead on the selected clip's track. */
  splitAtPlayhead(): void {
    const clipId = this.selectedClipId;
    if (!clipId) return;
    const result = splitClip(this.project, clipId, this.playheadSeconds);
    this.apply(result.project);
    if (result.newClipId) this.selectedClipId = result.newClipId;
  }

  trimClip(clipId: string, edge: 'start' | 'end', toTime: number, sourceDuration?: number): void {
    this.apply(trimClip(this.project, clipId, edge, toTime, sourceDuration));
  }

  moveClip(clipId: string, toStart: number, toTrackId?: string): void {
    this.apply(moveClip(this.project, clipId, toStart, toTrackId));
  }

  setClipSpeed(clipId: string, speed: number): void {
    this.apply(setClipSpeed(this.project, clipId, speed));
  }

  /** Replaces the whole project, used when restoring an autosave. */
  load(project: VideoProject): void {
    this.past.length = 0;
    this.future.length = 0;
    this.project = project;
    this.selectedClipId = undefined;
    this.playheadSeconds = 0;
    this.emit();
  }

  dispose(): void {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.listeners.clear();
    this.past.length = 0;
    this.future.length = 0;
  }
}

export { clipEnd, findTrack, projectDuration };
