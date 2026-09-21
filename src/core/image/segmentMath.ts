import type { SegmentationModel } from './models';
import { bytes, type ByteArray } from './bytes';

/**
 * The pure numerical parts of segmentation, kept apart from the worker so they
 * can be tested without loading 14 MB of ONNX Runtime.
 */

/** RGBA bytes to the normalised NCHW float tensor the model expects. */
export function preprocess(
  rgba: ByteArray,
  size: number,
  mean: readonly [number, number, number],
  std: readonly [number, number, number],
): Float32Array {
  const pixels = size * size;
  const data = new Float32Array(pixels * 3);
  for (let i = 0; i < pixels; i += 1) {
    const p = i * 4;
    data[i] = (rgba[p]! / 255 - mean[0]) / std[0];
    data[pixels + i] = (rgba[p + 1]! / 255 - mean[1]) / std[1];
    data[pixels * 2 + i] = (rgba[p + 2]! / 255 - mean[2]) / std[2];
  }
  return data;
}

/**
 * The raw output map to a 0–255 mask.
 *
 * `minmax` rescales against the map's own range, which is how the U²-Net family
 * is meant to be read: its output is a relative saliency map, not a calibrated
 * probability. A flat map (every value identical) means the model saw nothing
 * to separate, so everything is kept rather than everything erased.
 */
export function postprocess(
  raw: Float32Array,
  mode: SegmentationModel['output'],
): ByteArray {
  const mask = bytes(raw.length);
  if (mode === 'sigmoid') {
    for (let i = 0; i < raw.length; i += 1) {
      mask[i] = (1 / (1 + Math.exp(-raw[i]!))) * 255;
    }
    return mask;
  }

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of raw) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const range = max - min;
  if (range <= 1e-6) {
    mask.fill(255);
    return mask;
  }
  for (let i = 0; i < raw.length; i += 1) mask[i] = ((raw[i]! - min) / range) * 255;
  return mask;
}
