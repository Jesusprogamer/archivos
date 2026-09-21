import { useEffect, useState } from 'react';

const POSTER_WIDTH = 96;

/**
 * Grabs a representative frame from a video as a small data URL.
 *
 * Letting a `<video>` element act as its own thumbnail is unreliable: some
 * containers paint nothing until a frame is decoded, so the tile sits black.
 * Seeking a detached element and drawing one frame to a canvas is predictable,
 * and the result is a few kilobytes.
 */
export function useVideoPoster(url: string, enabled: boolean): string | undefined {
  const [poster, setPoster] = useState<string | undefined>();

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';

    const cleanup = () => {
      video.removeAttribute('src');
      video.load();
    };

    const draw = () => {
      if (cancelled) return;
      try {
        const scale = POSTER_WIDTH / (video.videoWidth || POSTER_WIDTH);
        const canvas = document.createElement('canvas');
        canvas.width = POSTER_WIDTH;
        canvas.height = Math.max(1, Math.round((video.videoHeight || POSTER_WIDTH) * scale));
        canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
        setPoster(canvas.toDataURL('image/jpeg', 0.7));
      } catch {
        // A frame we cannot read simply leaves the placeholder icon showing.
      } finally {
        cleanup();
      }
    };

    video.onseeked = draw;
    video.onloadeddata = () => {
      // A little way in, to skip the black frame many clips open on.
      const target = Math.min(0.25, (video.duration || 1) / 10);
      if (Number.isFinite(target) && target > 0) video.currentTime = target;
      else draw();
    };
    video.onerror = cleanup;
    video.src = url;

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [url, enabled]);

  return poster;
}
