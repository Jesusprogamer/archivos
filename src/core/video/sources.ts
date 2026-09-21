import type { AudioData } from '../audio/buffer';
import { decodeAudio } from '../audio/render';
import type { MediaItem } from '../media/types';
import type { RenderSource } from './renderer';

/**
 * The decoded material a project draws from.
 *
 * Video is held as an `HTMLVideoElement` rather than decoded up front: a
 * two-minute 1080p clip is several gigabytes of raw frames, and the browser's
 * own decoder is both faster and far kinder to memory than anything we could
 * build. Images become `ImageBitmap`s, which draw without a decode per frame.
 */

export interface LoadedSource extends RenderSource {
  readonly id: string;
  readonly duration: number;
  readonly hasAudio: boolean;
}

/** Waits for a video element to have a frame at the requested time. */
function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const target = Math.max(0, Math.min(time, video.duration || time));
    if (Math.abs(video.currentTime - target) < 1e-4 && video.readyState >= 2) {
      resolve();
      return;
    }
    const done = () => {
      video.removeEventListener('seeked', done);
      video.removeEventListener('error', fail);
      resolve();
    };
    const fail = () => {
      video.removeEventListener('seeked', done);
      video.removeEventListener('error', fail);
      reject(new Error('seek failed'));
    };
    video.addEventListener('seeked', done);
    video.addEventListener('error', fail);
    video.currentTime = target;
  });
}

export class SourceManager {
  private readonly sources = new Map<string, LoadedSource>();
  private readonly videos = new Map<string, HTMLVideoElement>();
  /**
   * Decoded audio, kept here rather than in the interface.
   *
   * The export mixdown needs real samples, not a media element, and decoding a
   * file twice is both slow and pointless. Caching beside the pictures keeps
   * one owner for everything a source provides.
   */
  private readonly audio = new Map<string, AudioData>();

  get(id: string): LoadedSource | undefined {
    return this.sources.get(id);
  }

  has(id: string): boolean {
    return this.sources.has(id);
  }

  video(id: string): HTMLVideoElement | undefined {
    return this.videos.get(id);
  }

  readonly lookup = (id: string): RenderSource | undefined => this.sources.get(id);

  async load(item: MediaItem): Promise<LoadedSource> {
    const existing = this.sources.get(item.id);
    if (existing) return existing;

    if (item.format.kind === 'image') {
      const bitmap = await createImageBitmap(item.file);
      const source: LoadedSource = {
        id: item.id,
        kind: 'image',
        element: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        // An image has no length of its own; the clip decides how long it shows.
        duration: Number.POSITIVE_INFINITY,
        hasAudio: false,
      };
      this.sources.set(item.id, source);
      return source;
    }

    const video = document.createElement('video');
    video.src = item.url;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    // Without this, drawing a video to a canvas can taint it in some browsers.
    video.crossOrigin = 'anonymous';

    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error(`cannot decode ${item.name}`));
      video.load();
    });

    const source: LoadedSource = {
      id: item.id,
      kind: 'video',
      element: video,
      width: video.videoWidth,
      height: video.videoHeight,
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      hasAudio: item.meta?.kind === 'video' ? item.meta.hasAudio : item.format.kind === 'audio',
    };
    this.videos.set(item.id, video);
    this.sources.set(item.id, source);
    return source;
  }

  /**
   * The decoded audio of a source, decoded once.
   *
   * Returns `undefined` for anything with no decodable sound, which the mixer
   * treats as silence — a video without an audio track is not an error.
   */
  async audioOf(item: MediaItem): Promise<AudioData | undefined> {
    const cached = this.audio.get(item.id);
    if (cached) return cached;
    try {
      const decoded = await decodeAudio(item.file);
      this.audio.set(item.id, decoded);
      return decoded;
    } catch {
      return undefined;
    }
  }

  audioFor(sourceId: string): AudioData | undefined {
    return this.audio.get(sourceId);
  }

  /** Seeks every loaded video to a source time, for a deterministic frame. */
  async seekAll(times: ReadonlyMap<string, number>): Promise<void> {
    await Promise.all(
      [...times].map(async ([id, time]) => {
        const video = this.videos.get(id);
        if (video) await seekTo(video, time);
      }),
    );
  }

  pauseAll(): void {
    for (const video of this.videos.values()) video.pause();
  }

  release(id: string): void {
    const video = this.videos.get(id);
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
      this.videos.delete(id);
    }
    const source = this.sources.get(id);
    if (source?.kind === 'image' && 'close' in source.element) {
      (source.element as ImageBitmap).close();
    }
    this.sources.delete(id);
    this.audio.delete(id);
  }

  dispose(): void {
    for (const id of [...this.sources.keys()]) this.release(id);
  }
}

export { seekTo };
