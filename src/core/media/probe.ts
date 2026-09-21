import type { AudioMeta, ImageMeta, MediaMeta, VideoMeta } from './types';
import type { Format } from '../detect/formats';

const PROBE_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), PROBE_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

async function probeImage(url: string): Promise<ImageMeta> {
  const bitmap = await withTimeout(
    new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('decode failed'));
      image.src = url;
    }),
    'image probe timed out',
  );
  return { kind: 'image', width: bitmap.naturalWidth, height: bitmap.naturalHeight };
}

/**
 * Reads duration and dimensions from a media element.
 *
 * Some containers report `Infinity` until the whole stream is seen; seeking far
 * ahead forces the browser to resolve a real duration without downloading
 * anything extra, because the blob is already local.
 */
function probeMediaElement(
  url: string,
  kind: 'audio' | 'video',
): Promise<{ duration: number; width: number; height: number }> {
  return withTimeout(
    new Promise((resolve, reject) => {
      const element = document.createElement(kind);
      element.preload = 'metadata';
      element.muted = true;

      const cleanup = () => {
        element.removeAttribute('src');
        element.load();
      };

      const finish = (duration: number) => {
        const width = kind === 'video' ? (element as HTMLVideoElement).videoWidth : 0;
        const height = kind === 'video' ? (element as HTMLVideoElement).videoHeight : 0;
        cleanup();
        resolve({ duration, width, height });
      };

      element.onloadedmetadata = () => {
        if (Number.isFinite(element.duration) && element.duration > 0) {
          finish(element.duration);
          return;
        }
        element.onseeked = () => {
          element.onseeked = null;
          finish(Number.isFinite(element.duration) ? element.duration : 0);
        };
        element.currentTime = Number.MAX_SAFE_INTEGER;
      };
      element.onerror = () => {
        cleanup();
        reject(new Error('media decode failed'));
      };
      element.src = url;
    }),
    'media probe timed out',
  );
}

async function probeAudio(url: string): Promise<AudioMeta> {
  const { duration } = await probeMediaElement(url, 'audio');
  return { kind: 'audio', duration };
}

async function probeVideo(url: string, file: File): Promise<VideoMeta> {
  const { duration, width, height } = await probeMediaElement(url, 'video');
  return { kind: 'video', width, height, duration, hasAudio: await hasAudioTrack(file, duration) };
}

/**
 * Whether a video carries sound.
 *
 * There is no portable API for this, so decode a short slice with the Web Audio
 * API: if it yields samples, there is an audio track. A silent-but-present
 * track still decodes, which is the answer we want.
 */
async function hasAudioTrack(file: File, duration: number): Promise<boolean> {
  if (duration <= 0) return false;
  const AudioContextCtor =
    globalThis.AudioContext ??
    (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return false;
  const context = new AudioContextCtor();
  try {
    // A few seconds is enough, and avoids decoding a whole film to answer a
    // yes/no question. Cutting a container mid-stream is fine for this probe:
    // a failure to decode is itself a "no".
    const slice = file.slice(0, Math.min(file.size, 4 * 1024 * 1024));
    const buffer = await context.decodeAudioData(await slice.arrayBuffer());
    return buffer.numberOfChannels > 0 && buffer.length > 0;
  } catch {
    return false;
  } finally {
    void context.close();
  }
}

export function probeMedia(format: Format, url: string, file: File): Promise<MediaMeta> {
  switch (format.kind) {
    case 'image':
      return probeImage(url);
    case 'audio':
      return probeAudio(url);
    case 'video':
      return probeVideo(url, file);
  }
}
