import type { DocumentState } from './document';
import { bytes, type ByteArray } from './bytes';

/**
 * Geometry: crop, resize, rotate in quarter turns, flip.
 *
 * Each of these moves the pixels and the mask together. Keeping them in step is
 * the whole point — a mask that survives a rotation is what lets someone crop
 * after they have already cut the background out.
 */

export interface CropRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type QuarterTurns = 0 | 1 | 2 | 3;

export function clampCrop(rect: CropRect, width: number, height: number): CropRect {
  const x = Math.max(0, Math.min(Math.round(rect.x), width - 1));
  const y = Math.max(0, Math.min(Math.round(rect.y), height - 1));
  return {
    x,
    y,
    width: Math.max(1, Math.min(Math.round(rect.width), width - x)),
    height: Math.max(1, Math.min(Math.round(rect.height), height - y)),
  };
}

export function crop(state: DocumentState, rect: CropRect): DocumentState {
  const area = clampCrop(rect, state.width, state.height);
  const pixels = bytes(area.width * area.height * 4);
  const mask = bytes(area.width * area.height);

  for (let y = 0; y < area.height; y += 1) {
    const sourceRow = (y + area.y) * state.width + area.x;
    const targetRow = y * area.width;
    // Copying whole rows beats a per-pixel loop by a wide margin on big images.
    pixels.set(
      state.pixels.subarray(sourceRow * 4, (sourceRow + area.width) * 4),
      targetRow * 4,
    );
    mask.set(state.mask.subarray(sourceRow, sourceRow + area.width), targetRow);
  }

  return { width: area.width, height: area.height, pixels, mask };
}

/** Where a source pixel ends up after a quarter turn and optional flips. */
function orient(
  x: number,
  y: number,
  width: number,
  height: number,
  turns: QuarterTurns,
  flipX: boolean,
  flipY: boolean,
): { x: number; y: number; width: number; height: number } {
  let px = flipX ? width - 1 - x : x;
  let py = flipY ? height - 1 - y : y;
  let w = width;
  let h = height;

  for (let turn = 0; turn < turns; turn += 1) {
    const nx = h - 1 - py;
    const ny = px;
    px = nx;
    py = ny;
    [w, h] = [h, w];
  }
  return { x: px, y: py, width: w, height: h };
}

export function rotateFlip(
  state: DocumentState,
  turns: QuarterTurns,
  flipX = false,
  flipY = false,
): DocumentState {
  if (turns === 0 && !flipX && !flipY) return state;
  const swap = turns === 1 || turns === 3;
  const width = swap ? state.height : state.width;
  const height = swap ? state.width : state.height;
  const pixels = bytes(width * height * 4);
  const mask = bytes(width * height);

  for (let y = 0; y < state.height; y += 1) {
    for (let x = 0; x < state.width; x += 1) {
      const target = orient(x, y, state.width, state.height, turns, flipX, flipY);
      const from = (y * state.width + x) * 4;
      const to = (target.y * width + target.x) * 4;
      pixels[to] = state.pixels[from]!;
      pixels[to + 1] = state.pixels[from + 1]!;
      pixels[to + 2] = state.pixels[from + 2]!;
      pixels[to + 3] = state.pixels[from + 3]!;
      mask[target.y * width + target.x] = state.mask[y * state.width + x]!;
    }
  }

  return { width, height, pixels, mask };
}

/** Dimensions for a resize that keeps the aspect ratio, given one side. */
export function fitSize(
  width: number,
  height: number,
  target: { width?: number; height?: number },
): { width: number; height: number } {
  if (target.width && target.height) {
    return { width: Math.max(1, target.width), height: Math.max(1, target.height) };
  }
  if (target.width) {
    return {
      width: Math.max(1, target.width),
      height: Math.max(1, Math.round((target.width / width) * height)),
    };
  }
  if (target.height) {
    return {
      width: Math.max(1, Math.round((target.height / height) * width)),
      height: Math.max(1, target.height),
    };
  }
  return { width, height };
}

/**
 * Bilinear resampling for the mask.
 *
 * The pixels go through the canvas, which resamples better than anything worth
 * hand-writing, but a canvas cannot carry a single-channel mask. Nearest
 * neighbour here would give the cut-out a staircase edge, so the mask gets its
 * own bilinear pass.
 */
export function resampleMask(
  mask: ByteArray,
  fromWidth: number,
  fromHeight: number,
  toWidth: number,
  toHeight: number,
): ByteArray {
  const out = bytes(toWidth * toHeight);
  const scaleX = fromWidth / toWidth;
  const scaleY = fromHeight / toHeight;

  for (let y = 0; y < toHeight; y += 1) {
    const sy = Math.min(fromHeight - 1, Math.max(0, (y + 0.5) * scaleY - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(fromHeight - 1, y0 + 1);
    const fy = sy - y0;

    for (let x = 0; x < toWidth; x += 1) {
      const sx = Math.min(fromWidth - 1, Math.max(0, (x + 0.5) * scaleX - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(fromWidth - 1, x0 + 1);
      const fx = sx - x0;

      const top = mask[y0 * fromWidth + x0]! * (1 - fx) + mask[y0 * fromWidth + x1]! * fx;
      const bottom = mask[y1 * fromWidth + x0]! * (1 - fx) + mask[y1 * fromWidth + x1]! * fx;
      out[y * toWidth + x] = top * (1 - fy) + bottom * fy;
    }
  }
  return out;
}
