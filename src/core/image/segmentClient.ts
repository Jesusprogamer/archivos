import { createId } from '../util/id';
import { resampleMask } from './transform';
import type { SegmentationModel } from './models';
import type { SegmentRequest, SegmentResponse } from './segment.worker';
import { bytes, type ByteArray } from './bytes';

/**
 * Client side of the segmentation worker.
 *
 * Its real job is scaling: the model sees a square thumbnail, and the mask it
 * returns is stretched back over the full-resolution image. Doing that here
 * rather than in the worker keeps the message payloads at a few hundred
 * kilobytes even for a sixty-megapixel photograph.
 */

let worker: Worker | undefined;
const pending = new Map<string, (response: SegmentResponse) => void>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./segment.worker.ts', import.meta.url), { type: 'module' });
  worker.addEventListener('message', (event: MessageEvent<SegmentResponse>) => {
    pending.get(event.data.id)?.(event.data);
    pending.delete(event.data.id);
  });
  return worker;
}

/**
 * Draws the image into a square canvas at the model's input size.
 *
 * The aspect ratio is deliberately not preserved: these models were trained on
 * stretched square crops, and letterboxing them with bars measurably hurts the
 * result near the edges.
 */
export function toModelInput(
  pixels: ByteArray,
  width: number,
  height: number,
  size: number,
): ByteArray {
  const source = new OffscreenCanvas(width, height);
  const sourceContext = source.getContext('2d');
  if (!sourceContext) throw new Error('2D context unavailable');
  sourceContext.putImageData(new ImageData(bytes(pixels), width, height), 0, 0);

  const square = new OffscreenCanvas(size, size);
  const context = square.getContext('2d');
  if (!context) throw new Error('2D context unavailable');
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, size, size);
  return context.getImageData(0, 0, size, size).data;
}

export interface SegmentResult {
  /** Full-resolution mask, ready to combine with the document. */
  readonly mask: ByteArray;
  readonly ms: number;
}

export async function segmentImage(
  weights: ArrayBuffer,
  model: SegmentationModel,
  pixels: ByteArray,
  width: number,
  height: number,
): Promise<SegmentResult> {
  const rgba = toModelInput(pixels, width, height, model.inputSize);
  const id = createId('seg');

  const response = await new Promise<SegmentResponse>((resolve) => {
    pending.set(id, resolve);
    ensureWorker().postMessage({ id, weights, model, rgba } satisfies SegmentRequest);
  });

  if (!response.ok) throw new Error(response.error);
  return {
    mask: resampleMask(response.mask, response.size, response.size, width, height),
    ms: response.ms,
  };
}

export function releaseSegmentWorker(): void {
  worker?.terminate();
  worker = undefined;
  pending.clear();
}
