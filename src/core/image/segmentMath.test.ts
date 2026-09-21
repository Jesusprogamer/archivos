import { describe, expect, it } from 'vitest';
import { postprocess, preprocess } from './segmentMath';

const MEAN = [0.485, 0.456, 0.406] as const;
const STD = [0.229, 0.224, 0.225] as const;

describe('preprocess', () => {
  it('lays the channels out as NCHW, not interleaved', () => {
    const size = 2;
    const rgba = new Uint8ClampedArray(size * size * 4);
    // Mark one pixel red, another green, to see where each channel lands.
    rgba[0] = 255;
    rgba[4 + 1] = 255;
    const data = preprocess(rgba, size, MEAN, STD);

    expect(data).toHaveLength(size * size * 3);
    // Red plane first, then green, then blue.
    expect(data[0]!).toBeCloseTo((1 - 0.485) / 0.229, 5);
    expect(data[4 + 1]!).toBeCloseTo((1 - 0.456) / 0.224, 5);
  });

  it('normalises with the model mean and standard deviation', () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 255]);
    const data = preprocess(rgba, 1, MEAN, STD);
    expect(data[0]!).toBeCloseTo(-0.485 / 0.229, 5);
    expect(data[1]!).toBeCloseTo(-0.456 / 0.224, 5);
    expect(data[2]!).toBeCloseTo(-0.406 / 0.225, 5);
  });

  it('ignores the alpha channel of the input', () => {
    const opaque = preprocess(new Uint8ClampedArray([120, 120, 120, 255]), 1, MEAN, STD);
    const clear = preprocess(new Uint8ClampedArray([120, 120, 120, 0]), 1, MEAN, STD);
    expect([...opaque]).toEqual([...clear]);
  });
});

describe('postprocess — minmax', () => {
  it('stretches the map across the full range', () => {
    const mask = postprocess(new Float32Array([0.2, 0.45, 0.7]), 'minmax');
    expect(mask[0]).toBe(0);
    expect(mask[2]).toBe(255);
    expect(mask[1]).toBeGreaterThan(120);
    expect(mask[1]).toBeLessThan(135);
  });

  it('keeps everything when the model saw no contrast at all', () => {
    // A flat map means "nothing stood out". Erasing the whole picture would be
    // the worst possible reading of that.
    const mask = postprocess(new Float32Array([0.5, 0.5, 0.5, 0.5]), 'minmax');
    expect([...mask]).toEqual([255, 255, 255, 255]);
  });

  it('handles negative values, which a raw saliency map can contain', () => {
    const mask = postprocess(new Float32Array([-3, 0, 3]), 'minmax');
    expect([...mask]).toEqual([0, 128, 255]);
  });
});

describe('postprocess — sigmoid', () => {
  it('maps logits through the logistic curve', () => {
    const mask = postprocess(new Float32Array([-10, 0, 10]), 'sigmoid');
    expect(mask[0]).toBe(0);
    expect(mask[1]).toBe(128);
    expect(mask[2]).toBe(255);
  });

  it('does not rescale, unlike minmax', () => {
    // Two confident-but-not-extreme logits stay mid-range instead of being
    // stretched to 0 and 255.
    const mask = postprocess(new Float32Array([1, 2]), 'sigmoid');
    expect(mask[0]).toBeGreaterThan(180);
    expect(mask[1]).toBeLessThan(250);
  });
});
