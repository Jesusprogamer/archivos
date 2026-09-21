import type { DocumentState } from './document';
import { bytes, type ByteArray } from './bytes';

/**
 * Removing a background by colour.
 *
 * Distance is measured in a luma/chroma space rather than raw RGB. Plain RGB
 * distance treats a shift in brightness the same as a shift in hue, so keying a
 * green screen with shadows either leaves fringes or eats the subject. Weighting
 * chroma more heavily than luma follows how the eye actually separates a
 * background from what is in front of it.
 */

export interface ColorKeyParams {
  /** The colour to remove, as `#rrggbb`. */
  readonly color: string;
  /** 0–100. How far from that colour still counts as background. */
  readonly tolerance: number;
  /** 0–100. Width of the partly transparent band beyond the tolerance. */
  readonly softness: number;
  /** Contiguous keys only the region touching the sample point. */
  readonly contiguous: boolean;
  /** Where the eyedropper was clicked; required when `contiguous`. */
  readonly seed?: { x: number; y: number };
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function parseHex(hex: string): Rgb {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  return {
    r: Number.parseInt(full.slice(0, 2), 16) || 0,
    g: Number.parseInt(full.slice(2, 4), 16) || 0,
    b: Number.parseInt(full.slice(4, 6), 16) || 0,
  };
}

export function toHex({ r, g, b }: Rgb): string {
  const part = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** Luma and the two chroma differences, the axes a keyer actually cares about. */
function ycc(r: number, g: number, b: number): [number, number, number] {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  return [y, b - y, r - y];
}

/**
 * Perceptual distance, 0 for identical.
 *
 * Chroma carries three times the weight of luma: a darker patch of the same
 * green is still background, a grey patch of the same brightness is not.
 */
export function colorDistance(a: Rgb, b: Rgb): number {
  const [ay, acb, acr] = ycc(a.r, a.g, a.b);
  const [by, bcb, bcr] = ycc(b.r, b.g, b.b);
  const dy = ay - by;
  const dcb = acb - bcb;
  const dcr = acr - bcr;
  return Math.sqrt(dy * dy + 3 * (dcb * dcb + dcr * dcr));
}

/**
 * Tolerance 0–100 maps onto this much distance.
 *
 * Chosen against real numbers rather than by feel: a green backdrop and the
 * same green in shadow sit about 85 apart, while green and red sit about 590
 * apart. Mapping 100 % to 400 puts "catch the shaded backdrop" around a
 * tolerance of 25 and keeps an unrelated hue out of reach at any setting.
 */
const MAX_DISTANCE = 400;

function thresholds(params: ColorKeyParams): { inner: number; outer: number } {
  const inner = (params.tolerance / 100) * MAX_DISTANCE;
  const outer = inner + (params.softness / 100) * MAX_DISTANCE * 0.5;
  return { inner, outer };
}

/**
 * Alpha for one distance: fully removed inside the tolerance, fully kept beyond
 * the soft band, smoothly in between.
 */
function alphaFor(distance: number, inner: number, outer: number): number {
  if (distance <= inner) return 0;
  if (distance >= outer) return 255;
  const t = (distance - inner) / (outer - inner);
  // Smoothstep rather than a straight ramp: a linear edge reads as a halo.
  return Math.round(255 * t * t * (3 - 2 * t));
}

/**
 * Computes the alpha a colour key would produce, per pixel.
 *
 * Returns a fresh array rather than mutating the document, so the caller can
 * preview it live and only commit when the user says so.
 */
export function computeColorKey(
  state: Pick<DocumentState, 'pixels' | 'width' | 'height'>,
  params: ColorKeyParams,
): ByteArray {
  const { pixels, width, height } = state;
  const result = bytes(width * height);
  result.fill(255);
  const target = parseHex(params.color);
  const { inner, outer } = thresholds(params);

  if (!params.contiguous) {
    for (let i = 0, p = 0; i < result.length; i += 1, p += 4) {
      const distance = colorDistance(target, {
        r: pixels[p]!,
        g: pixels[p + 1]!,
        b: pixels[p + 2]!,
      });
      result[i] = alphaFor(distance, inner, outer);
    }
    return result;
  }

  const seed = params.seed;
  if (!seed) return result;
  const startX = Math.floor(seed.x);
  const startY = Math.floor(seed.y);
  if (startX < 0 || startY < 0 || startX >= width || startY >= height) return result;

  // Flood fill with an explicit stack: recursion blows the call stack on any
  // real photograph, and a typed queue is far cheaper than an array of objects.
  const visited = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  let top = 0;
  stack[top++] = startY * width + startX;
  visited[startY * width + startX] = 1;

  while (top > 0) {
    const index = stack[--top]!;
    const p = index * 4;
    const distance = colorDistance(target, {
      r: pixels[p]!,
      g: pixels[p + 1]!,
      b: pixels[p + 2]!,
    });
    const alpha = alphaFor(distance, inner, outer);
    result[index] = alpha;
    // Only keep spreading through pixels that are at least partly background;
    // a fully opaque pixel is the edge of the region.
    if (alpha >= 255) continue;

    const x = index % width;
    const y = (index - x) / width;
    if (x > 0 && !visited[index - 1]) {
      visited[index - 1] = 1;
      stack[top++] = index - 1;
    }
    if (x < width - 1 && !visited[index + 1]) {
      visited[index + 1] = 1;
      stack[top++] = index + 1;
    }
    if (y > 0 && !visited[index - width]) {
      visited[index - width] = 1;
      stack[top++] = index - width;
    }
    if (y < height - 1 && !visited[index + width]) {
      visited[index + width] = 1;
      stack[top++] = index + width;
    }
  }

  return result;
}

/**
 * Combines a computed key with the mask already in the document.
 *
 * Taking the minimum is what makes the methods stackable: each pass can only
 * remove more, never resurrect something an earlier pass deliberately erased.
 */
export function applyKey(mask: ByteArray, key: ByteArray): ByteArray {
  const out = bytes(mask.length);
  for (let i = 0; i < mask.length; i += 1) out[i] = Math.min(mask[i]!, key[i]!);
  return out;
}

/** Averages a small square, so a single noisy pixel does not decide the key. */
export function sampleColor(
  state: Pick<DocumentState, 'pixels' | 'width' | 'height'>,
  x: number,
  y: number,
  radius = 1,
): string {
  const { pixels, width, height } = state;
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const sx = Math.floor(x) + dx;
      const sy = Math.floor(y) + dy;
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
      const p = (sy * width + sx) * 4;
      r += pixels[p]!;
      g += pixels[p + 1]!;
      b += pixels[p + 2]!;
      count += 1;
    }
  }
  if (count === 0) return '#000000';
  return toHex({ r: r / count, g: g / count, b: b / count });
}
