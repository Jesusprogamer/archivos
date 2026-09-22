/**
 * The video project.
 *
 * A plain, serialisable object with no React and no DOM in it. That is what
 * lets the same structure drive the preview, the exporter and the autosave, and
 * what makes the timeline arithmetic testable without a browser.
 *
 * Times are seconds throughout. Frames are an output concern, not a model one:
 * changing the project's frame rate must not move a single clip.
 */

export type TrackKind = 'video' | 'text' | 'audio';

export interface Crop {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export const NO_CROP: Crop = { top: 0, right: 0, bottom: 0, left: 0 };

export interface ColorAdjust {
  readonly brightness: number;
  readonly contrast: number;
  readonly saturation: number;
}

export const NEUTRAL_COLOR: ColorAdjust = { brightness: 100, contrast: 100, saturation: 100 };

/** A property that can be animated, sampled at a point in the clip. */
export type KeyframeProperty = 'opacity' | 'x' | 'y' | 'scale';

export interface Keyframe {
  /** Seconds from the start of the clip. */
  readonly at: number;
  readonly value: number;
}

export type Keyframes = Partial<Record<KeyframeProperty, readonly Keyframe[]>>;

export interface Transform {
  /** Centre offset from the middle of the frame, in project pixels. */
  readonly x: number;
  readonly y: number;
  /** 1 means "fit the frame". */
  readonly scale: number;
  /** Degrees. */
  readonly rotation: number;
  /** 0–1. */
  readonly opacity: number;
  readonly crop: Crop;
}

export const DEFAULT_TRANSFORM: Transform = {
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  opacity: 1,
  crop: NO_CROP,
};

export type TextAlign = 'left' | 'center' | 'right';
export type TextAnimation = 'none' | 'fade' | 'slideUp' | 'slideLeft' | 'zoom';

export interface TextStyle {
  readonly text: string;
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly color: string;
  readonly outlineColor: string;
  readonly outlineWidth: number;
  readonly shadow: boolean;
  readonly backgroundColor: string;
  /** 0 means no background box. */
  readonly backgroundOpacity: number;
  readonly align: TextAlign;
  readonly animateIn: TextAnimation;
  readonly animateOut: TextAnimation;
}

export const DEFAULT_TEXT: TextStyle = {
  text: 'Texto',
  fontFamily: 'Inter',
  fontSize: 72,
  bold: true,
  italic: false,
  color: '#ffffff',
  outlineColor: '#000000',
  outlineWidth: 0,
  shadow: true,
  backgroundColor: '#000000',
  backgroundOpacity: 0,
  align: 'center',
  animateIn: 'fade',
  animateOut: 'fade',
};

export type TransitionKind = 'none' | 'crossfade' | 'fadeToBlack';

export interface Transition {
  readonly kind: TransitionKind;
  readonly duration: number;
}

export const NO_TRANSITION: Transition = { kind: 'none', duration: 0 };

export interface ClipBase {
  readonly id: string;
  readonly trackId: string;
  /** Where it begins on the timeline, in seconds. */
  readonly start: number;
  /** How long it occupies the timeline, after any speed change. */
  readonly duration: number;
  readonly transform: Transform;
  readonly keyframes: Keyframes;
  /** Seconds of fade at each end, applied to video opacity and audio level. */
  readonly fadeIn: number;
  readonly fadeOut: number;
  /** A transition into this clip from the one before it on the same track. */
  readonly transition: Transition;
  /**
   * 0–1: cuánto late el clip con los graves de la música del proyecto.
   *
   * 0 lo apaga, y es lo normal. Es el mismo efecto que hace el visualizador,
   * con el mismo análisis, para que un clip y un visualizador montados sobre
   * la misma música laten igual.
   */
  readonly beatPunch: number;
}

export interface MediaClip extends ClipBase {
  readonly kind: 'video' | 'image' | 'audio';
  /** Id of the library item this clip plays. */
  readonly sourceId: string;
  /** Where in the source the clip starts, in source seconds. */
  readonly inPoint: number;
  /** 0.25–4. The timeline duration already accounts for it. */
  readonly speed: number;
  readonly keepPitch: boolean;
  /** 0–2, where 1 is unity. */
  readonly volume: number;
  readonly muted: boolean;
  readonly color: ColorAdjust;
}

export interface TextClip extends ClipBase {
  readonly kind: 'text';
  readonly style: TextStyle;
}

export type Clip = MediaClip | TextClip;

export interface Track {
  readonly id: string;
  readonly kind: TrackKind;
  readonly name: string;
  readonly locked: boolean;
  /** Video and text tracks hide; audio tracks mute. */
  readonly hidden: boolean;
  readonly muted: boolean;
  readonly clips: readonly Clip[];
}

export interface VideoProject {
  readonly id: string;
  readonly name: string;
  /** Bumped when the on-disk shape changes, so an old autosave can be refused. */
  readonly schema: 1;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly backgroundColor: string;
  readonly tracks: readonly Track[];
}

export const SCHEMA_VERSION = 1;

export function createProject(
  id: string,
  name: string,
  width = 1920,
  height = 1080,
  fps = 30,
): VideoProject {
  return {
    id,
    name,
    schema: SCHEMA_VERSION,
    width,
    height,
    fps,
    backgroundColor: '#000000',
    tracks: [],
  };
}

// ---- Derived values ----

export function clipEnd(clip: Clip): number {
  return clip.start + clip.duration;
}

export function trackDuration(track: Track): number {
  return track.clips.reduce((longest, clip) => Math.max(longest, clipEnd(clip)), 0);
}

export function projectDuration(project: VideoProject): number {
  return project.tracks.reduce((longest, track) => Math.max(longest, trackDuration(track)), 0);
}

/** Clips that cover a moment in time, in the order they should be drawn. */
export function clipsAt(track: Track, time: number): readonly Clip[] {
  return track.clips.filter((clip) => time >= clip.start && time < clipEnd(clip));
}

export function findClip(project: VideoProject, clipId: string): Clip | undefined {
  for (const track of project.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (clip) return clip;
  }
  return undefined;
}

export function findTrack(project: VideoProject, trackId: string): Track | undefined {
  return project.tracks.find((track) => track.id === trackId);
}

/** Where in the source a timeline moment falls, honouring the speed setting. */
export function sourceTimeAt(clip: MediaClip, timelineTime: number): number {
  const offset = Math.max(0, timelineTime - clip.start);
  return clip.inPoint + offset * clip.speed;
}

/**
 * Samples an animated property.
 *
 * With no keyframes the static value is used; with one, that value throughout;
 * with more, linear interpolation between the surrounding pair and a hold
 * beyond the ends. Linear is the right default here — anything else surprises
 * people who placed two keyframes and expected a straight move.
 */
export function sampleProperty(
  clip: Clip,
  property: KeyframeProperty,
  timelineTime: number,
  fallback: number,
): number {
  const frames = clip.keyframes[property];
  if (!frames || frames.length === 0) return fallback;
  const local = timelineTime - clip.start;
  const first = frames[0]!;
  if (local <= first.at) return first.value;
  const last = frames[frames.length - 1]!;
  if (local >= last.at) return last.value;

  for (let i = 1; i < frames.length; i += 1) {
    const previous = frames[i - 1]!;
    const next = frames[i]!;
    if (local <= next.at) {
      const span = next.at - previous.at;
      if (span <= 0) return next.value;
      const t = (local - previous.at) / span;
      return previous.value + (next.value - previous.value) * t;
    }
  }
  return last.value;
}

/**
 * The opacity multiplier from the clip's own fades at a moment.
 *
 * Fades are clamped so that a fade-in and fade-out longer than the clip still
 * behave — they meet in the middle rather than producing a negative window.
 */
export function fadeFactorAt(clip: Clip, timelineTime: number): number {
  const local = timelineTime - clip.start;
  if (local < 0 || local > clip.duration) return 0;

  const half = clip.duration / 2;
  const fadeIn = Math.min(clip.fadeIn, half);
  const fadeOut = Math.min(clip.fadeOut, half);

  let factor = 1;
  if (fadeIn > 0 && local < fadeIn) factor = local / fadeIn;
  if (fadeOut > 0 && local > clip.duration - fadeOut) {
    factor = Math.min(factor, (clip.duration - local) / fadeOut);
  }
  return Math.max(0, Math.min(1, factor));
}

export function isMediaClip(clip: Clip): clip is MediaClip {
  return clip.kind !== 'text';
}

export function isTextClip(clip: Clip): clip is TextClip {
  return clip.kind === 'text';
}
