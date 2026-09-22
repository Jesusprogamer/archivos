import {
  clipEnd,
  isMediaClip,
  projectDuration,
  sourceTimeAt,
  type MediaClip,
  type VideoProject,
} from '../../core/video/project';
import {
  analyseProjectBeat,
  bassAt,
  EMPTY_BEAT,
  projectUsesBeat,
  type BeatTrack,
} from '../../core/video/beat';
import { renderFrame, type Canvas2D } from '../../core/video/renderer';
import type { SourceManager } from '../../core/video/sources';

/**
 * Live preview playback.
 *
 * The timeline clock is kept here and video elements are told to follow it,
 * rather than the other way round. That ordering is what makes scrubbing,
 * looping and speed changes behave: the clock is the truth, and any element
 * that drifts more than a frame or two is nudged back.
 *
 * Preview audio comes from the media elements themselves. That is a deliberate
 * simplification — two clips from the *same* file overlapping in time cannot
 * both be heard, because there is one element per source. The export does not
 * share the limitation: it mixes from decoded samples (`mixdown.ts`), so what
 * is written is always complete even when the preview cannot play it.
 */

/** How far an element may drift from the clock before it is corrected. */
const DRIFT_TOLERANCE = 0.12;

type Listener = () => void;

export class PreviewPlayer {
  private playing = false;
  private time = 0;
  private lastTick = 0;
  private frameHandle = 0;
  private readonly listeners = new Set<Listener>();
  private version = 0;

  private context: Canvas2D | undefined;
  private project: VideoProject | undefined;
  private sources: SourceManager | undefined;
  private scale = 1;
  private beat: BeatTrack = EMPTY_BEAT;
  /** Firma del audio con el que se hizo `beat`, para no rehacerlo por nada. */
  private beatKey = '';

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): number => this.version;

  private emit(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get currentTime(): number {
    return this.time;
  }

  attach(context: Canvas2D, project: VideoProject, sources: SourceManager, scale: number): void {
    this.context = context;
    this.project = project;
    this.sources = sources;
    this.scale = scale;
    this.refreshBeat(project, sources);
  }

  /**
   * Rehace el análisis de graves solo cuando puede haber cambiado.
   *
   * Mover un clip de vídeo o tocar su opacidad no cambia la música, y analizar
   * la mezcla entera en cada arrastre haría el editor inusable. La firma reúne
   * lo único que afecta al resultado: qué se oye, desde dónde y cuánto.
   */
  private refreshBeat(project: VideoProject, sources: SourceManager): void {
    if (!projectUsesBeat(project)) {
      this.beat = EMPTY_BEAT;
      this.beatKey = '';
      return;
    }

    const key = project.tracks
      .filter((track) => !track.muted)
      .flatMap((track) =>
        track.clips
          .filter((clip) => isMediaClip(clip) && clip.kind !== 'image' && !clip.muted)
          .map((clip) => {
            const media = clip as MediaClip;
            return [
              media.sourceId,
              media.start,
              media.duration,
              media.inPoint,
              media.speed,
              media.volume,
              media.fadeIn,
              media.fadeOut,
            ].join(':');
          }),
      )
      .join('|');

    if (key === this.beatKey) return;
    this.beatKey = key;
    this.beat = analyseProjectBeat(project, (id) => sources.audioFor(id));
  }

  /** Draws the current frame without advancing the clock. */
  draw(): void {
    if (!this.context || !this.project || !this.sources) return;
    renderFrame(this.context, this.project, this.time, this.sources.lookup, {
      scale: this.scale,
      bassAt: (seconds) => bassAt(this.beat, seconds),
    });
  }

  /** Moves the playhead and pulls every source into place for a still frame. */
  async seek(seconds: number): Promise<void> {
    this.time = Math.max(0, seconds);
    if (!this.project || !this.sources) return;
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause();

    const times = new Map<string, number>();
    for (const track of this.project.tracks) {
      if (track.hidden) continue;
      for (const clip of track.clips) {
        if (!isMediaClip(clip) || clip.kind === 'image') continue;
        if (this.time < clip.start || this.time >= clipEnd(clip)) continue;
        times.set(clip.sourceId, sourceTimeAt(clip, this.time));
      }
    }
    await this.sources.seekAll(times);
    this.draw();
    this.emit();
  }

  play(): void {
    if (this.playing || !this.project) return;
    // Starting from the very end would freeze on the last frame.
    if (this.time >= projectDuration(this.project) - 1e-3) this.time = 0;
    this.playing = true;
    this.lastTick = performance.now();
    this.frameHandle = requestAnimationFrame(this.tick);
    this.emit();
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.frameHandle);
    this.sources?.pauseAll();
    this.emit();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  private readonly tick = (now: number): void => {
    if (!this.playing || !this.project || !this.sources) return;
    const delta = Math.min(0.25, (now - this.lastTick) / 1000);
    this.lastTick = now;
    this.time += delta;

    const duration = projectDuration(this.project);
    if (this.time >= duration) {
      this.time = duration;
      this.pause();
      this.draw();
      return;
    }

    this.syncSources();
    this.draw();
    this.emit();
    this.frameHandle = requestAnimationFrame(this.tick);
  };

  /** Keeps each media element playing the right part at the right rate. */
  private syncSources(): void {
    if (!this.project || !this.sources) return;
    const active = new Set<string>();

    for (const track of this.project.tracks) {
      for (const clip of track.clips) {
        if (!isMediaClip(clip) || clip.kind === 'image') continue;
        if (this.time < clip.start || this.time >= clipEnd(clip)) continue;

        const element = this.sources.video(clip.sourceId);
        if (!element) continue;
        active.add(clip.sourceId);

        const wanted = sourceTimeAt(clip, this.time);
        if (Math.abs(element.currentTime - wanted) > DRIFT_TOLERANCE) {
          element.currentTime = wanted;
        }
        if (element.playbackRate !== clip.speed) element.playbackRate = clip.speed;

        const audible = !clip.muted && !track.muted && !track.hidden;
        element.muted = !audible;
        element.volume = Math.max(0, Math.min(1, clip.volume));
        if (element.paused) void element.play().catch(() => undefined);
      }
    }

    for (const track of this.project.tracks) {
      for (const clip of track.clips) {
        if (!isMediaClip(clip) || active.has(clip.sourceId)) continue;
        const element = this.sources.video(clip.sourceId);
        if (element && !element.paused) element.pause();
      }
    }
  }

  dispose(): void {
    this.pause();
    this.listeners.clear();
    this.context = undefined;
    this.project = undefined;
    this.sources = undefined;
  }
}
