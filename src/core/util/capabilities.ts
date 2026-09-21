/**
 * What this particular browser can do, asked once and cached.
 *
 * Every answer here is measured, never assumed: the spike showed that a
 * Chromium build can expose WebCodecs and still refuse H.264.
 */
export interface Capabilities {
  readonly crossOriginIsolated: boolean;
  readonly sharedArrayBuffer: boolean;
  readonly webCodecs: boolean;
  readonly offscreenCanvas: boolean;
  readonly hardwareConcurrency: number;
}

export function readCapabilities(): Capabilities {
  return {
    crossOriginIsolated: typeof self !== 'undefined' && self.crossOriginIsolated === true,
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    webCodecs: typeof globalThis.VideoEncoder !== 'undefined',
    offscreenCanvas: typeof globalThis.OffscreenCanvas !== 'undefined',
    hardwareConcurrency:
      typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 4) : 4,
  };
}

let cached: Capabilities | undefined;

export function capabilities(): Capabilities {
  cached ??= readCapabilities();
  return cached;
}

/** Image encodings the canvas can produce here, probed once. */
let canvasTypes: Promise<ReadonlySet<string>> | undefined;

export function canvasEncodeSupport(): Promise<ReadonlySet<string>> {
  canvasTypes ??= (() => {
    const supported = new Set<string>();
    if (typeof document === 'undefined') return Promise.resolve(supported);
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/avif']) {
      // toDataURL silently falls back to PNG for unsupported types, so compare.
      try {
        if (canvas.toDataURL(type).startsWith(`data:${type}`)) supported.add(type);
      } catch {
        /* the type is simply unavailable */
      }
    }
    return Promise.resolve(supported);
  })();
  return canvasTypes;
}
