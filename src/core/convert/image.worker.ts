/// <reference lib="webworker" />

/**
 * Image decoding, resizing and encoding, off the main thread.
 *
 * The browser's own codecs are much faster than ffmpeg.wasm for stills and need
 * no 32 MB download, so PNG/JPEG/WebP/AVIF go through here. BMP and GIF fall
 * back to ffmpeg, which the caller decides.
 */

export interface ImageJobRequest {
  readonly id: string;
  readonly file: File;
  readonly mime: string;
  readonly quality: number;
  readonly maxSize: number | 'source';
  /** Filled behind images with transparency, for formats without an alpha channel. */
  readonly flattenTo?: string;
}

export type ImageJobResponse =
  | { readonly id: string; readonly ok: true; readonly blob: Blob; readonly width: number; readonly height: number }
  | { readonly id: string; readonly ok: false; readonly error: string };

function targetSize(
  width: number,
  height: number,
  maxSize: number | 'source',
): { width: number; height: number } {
  if (maxSize === 'source') return { width, height };
  const longest = Math.max(width, height);
  // Never upscale: asking for 2000px from a 500px source should not blur it.
  if (longest <= maxSize) return { width, height };
  const scale = maxSize / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function convert(request: ImageJobRequest): Promise<ImageJobResponse> {
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(request.file);
    const { width, height } = targetSize(bitmap.width, bitmap.height, request.maxSize);

    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D context unavailable');

    if (request.flattenTo) {
      context.fillStyle = request.flattenTo;
      context.fillRect(0, 0, width, height);
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await canvas.convertToBlob({
      type: request.mime,
      quality: request.quality / 100,
    });
    // Chromium silently falls back to PNG for a type it cannot encode; saying
    // so beats handing the user a mislabelled file.
    if (blob.type !== request.mime) {
      throw new Error(`browser produced ${blob.type} instead of ${request.mime}`);
    }
    return { id: request.id, ok: true, blob, width, height };
  } catch (error) {
    return { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    bitmap?.close();
  }
}

self.addEventListener('message', (event: MessageEvent<ImageJobRequest>) => {
  void convert(event.data).then((response) => {
    (self as unknown as Worker).postMessage(response);
  });
});
