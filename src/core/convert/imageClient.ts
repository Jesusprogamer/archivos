import { createId } from '../util/id';
import type { ImageJobRequest, ImageJobResponse } from './image.worker';

/**
 * Thin client over the image worker. One worker is reused; it is idle between
 * jobs and costs nothing to keep around.
 */
let worker: Worker | undefined;
const pending = new Map<string, (response: ImageJobResponse) => void>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./image.worker.ts', import.meta.url), { type: 'module' });
  worker.addEventListener('message', (event: MessageEvent<ImageJobResponse>) => {
    pending.get(event.data.id)?.(event.data);
    pending.delete(event.data.id);
  });
  return worker;
}

export interface ImageConversion {
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
}

export function convertImage(
  request: Omit<ImageJobRequest, 'id'>,
): Promise<ImageConversion> {
  const id = createId('img');
  return new Promise((resolve, reject) => {
    pending.set(id, (response) => {
      if (response.ok) resolve({ blob: response.blob, width: response.width, height: response.height });
      else reject(new Error(response.error));
    });
    ensureWorker().postMessage({ ...request, id } satisfies ImageJobRequest);
  });
}

/** Releases the worker; used when the converter workspace unmounts. */
export function releaseImageWorker(): void {
  worker?.terminate();
  worker = undefined;
  pending.clear();
}
