/**
 * Caches downloaded model weights.
 *
 * The Cache API is the right home for this: it survives reloads, it is not
 * subject to the ~5 MB ceilings of other browser storage, and the browser can
 * evict it under pressure without breaking anything — a missing entry just
 * means downloading again.
 */
const CACHE_NAME = 'forja-models-v1';

export interface DownloadProgress {
  readonly received: number;
  readonly total: number;
}

async function openCache(): Promise<Cache | undefined> {
  if (typeof caches === 'undefined') return undefined;
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    // Private windows and some enterprise policies refuse the Cache API.
    return undefined;
  }
}

export async function isCached(url: string): Promise<boolean> {
  const cache = await openCache();
  return cache ? (await cache.match(url)) !== undefined : false;
}

/**
 * Fetches the weights, reporting progress, and stores them for next time.
 *
 * Progress reporting is the reason this does not simply call `cache.add`: a
 * 176 MB download with no feedback is indistinguishable from a hang.
 */
export async function fetchModel(
  url: string,
  onProgress?: (progress: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const cache = await openCache();
  const cached = await cache?.match(url);
  if (cached) return cached.arrayBuffer();

  const response = await fetch(url, { ...(signal ? { signal } : {}), mode: 'cors' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

  const total = Number(response.headers.get('content-length') ?? 0);
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = await response.arrayBuffer();
    await cache?.put(url, new Response(buffer));
    return buffer;
  }

  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress?.({ received, total });
  }

  const blob = new Blob(chunks as BlobPart[]);
  await cache?.put(url, new Response(blob));
  return blob.arrayBuffer();
}

export async function clearModelCache(): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    await caches.delete(CACHE_NAME);
  } catch {
    // Nothing to clear.
  }
}
