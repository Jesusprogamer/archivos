import { bytes, type ByteArray } from './bytes';
import { composite, type DocumentState } from './document';
import type { Backdrop } from '../../workspaces/image/backdrop';

/**
 * Turning the document into a file.
 *
 * The export path draws the same things the canvas view draws, in the same
 * order — backdrop, then the composited subject, through the same colour
 * filter. That is deliberate: anything else and the saved file would differ
 * from the preview, which is the one thing an editor must never do.
 */

export interface ExportOptions {
  /** `image/png`, `image/jpeg` or `image/webp`. */
  readonly mime: string;
  /** 1–100, ignored by PNG. */
  readonly quality: number;
  /** Filled behind the subject for formats without transparency. */
  readonly flattenTo?: string;
  readonly filter?: string;
  readonly backdrop?: Backdrop;
}

export interface ExportResult {
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
}

export async function exportImage(
  state: DocumentState,
  options: ExportOptions,
): Promise<ExportResult> {
  const { width, height } = state;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D context unavailable');

  // A format without an alpha channel needs something behind the subject, or
  // the transparent areas come out black rather than white.
  if (options.flattenTo) {
    context.fillStyle = options.flattenTo;
    context.fillRect(0, 0, width, height);
  }

  const backdrop = options.backdrop;
  if (backdrop?.kind === 'color') {
    context.fillStyle = backdrop.color;
    context.fillRect(0, 0, width, height);
  } else if (backdrop?.kind === 'image' && backdrop.image) {
    const scale = Math.max(width / backdrop.image.width, height / backdrop.image.height);
    const w = backdrop.image.width * scale;
    const h = backdrop.image.height * scale;
    context.drawImage(backdrop.image, (width - w) / 2, (height - h) / 2, w, h);
  }

  const subject = new OffscreenCanvas(width, height);
  subject
    .getContext('2d')
    ?.putImageData(new ImageData(composite(state), width, height), 0, 0);

  if (options.filter) context.filter = options.filter;
  context.drawImage(subject, 0, 0);
  context.filter = 'none';

  const blob = await canvas.convertToBlob({
    type: options.mime,
    quality: options.quality / 100,
  });
  if (blob.type !== options.mime) {
    throw new Error(`browser produced ${blob.type} instead of ${options.mime}`);
  }
  return { blob, width, height };
}

/** Decodes a file into the pixels the editor works on. */
export async function decodeToPixels(
  file: Blob,
): Promise<{ pixels: ByteArray; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('2D context unavailable');
    context.drawImage(bitmap, 0, 0);
    return {
      pixels: context.getImageData(0, 0, bitmap.width, bitmap.height).data,
      width: bitmap.width,
      height: bitmap.height,
    };
  } finally {
    bitmap.close();
  }
}

export { bytes };
