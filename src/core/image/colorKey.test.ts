import { describe, expect, it } from 'vitest';
import {
  applyKey,
  colorDistance,
  computeColorKey,
  parseHex,
  sampleColor,
  toHex,
  type ColorKeyParams,
} from './colorKey';
import { bytes } from './bytes';

/** Builds a document from a grid of hex colours, one per pixel. */
function fromGrid(rows: string[][]) {
  const height = rows.length;
  const width = rows[0]!.length;
  const pixels = bytes(width * height * 4);
  rows.forEach((row, y) =>
    row.forEach((hex, x) => {
      const { r, g, b } = parseHex(hex);
      const p = (y * width + x) * 4;
      pixels[p] = r;
      pixels[p + 1] = g;
      pixels[p + 2] = b;
      pixels[p + 3] = 255;
    }),
  );
  return { pixels, width, height };
}

const params = (overrides: Partial<ColorKeyParams> = {}): ColorKeyParams => ({
  color: '#00ff00',
  tolerance: 20,
  softness: 0,
  contiguous: false,
  ...overrides,
});

describe('hex helpers', () => {
  it('round-trips', () => {
    expect(toHex(parseHex('#1a2b3c'))).toBe('#1a2b3c');
  });

  it('expands the short form', () => {
    expect(parseHex('#f00')).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('clamps out-of-range channels rather than producing rubbish', () => {
    expect(toHex({ r: -10, g: 300, b: 12.6 })).toBe('#00ff0d');
  });
});

describe('colorDistance', () => {
  it('is zero for the same colour', () => {
    expect(colorDistance(parseHex('#336699'), parseHex('#336699'))).toBe(0);
  });

  it('weighs a hue change more heavily than a brightness change', () => {
    const green = parseHex('#00a000');
    // Same green, darker — a shadow on the backdrop.
    const darkerGreen = colorDistance(green, parseHex('#007000'));
    // Same brightness, different hue — part of the subject.
    const otherHue = colorDistance(green, parseHex('#a00000'));
    expect(otherHue).toBeGreaterThan(darkerGreen * 2);
  });
});

describe('computeColorKey — global', () => {
  it('removes matching pixels and keeps the rest', () => {
    const doc = fromGrid([
      ['#00ff00', '#ff0000'],
      ['#00ff00', '#0000ff'],
    ]);
    const key = computeColorKey(doc, params());
    expect([...key]).toEqual([0, 255, 0, 255]);
  });

  it('removes a shaded version of the keyed colour at a modest tolerance', () => {
    const doc = fromGrid([['#00ff00', '#00c800', '#ff0000']]);
    const key = computeColorKey(doc, params({ tolerance: 30 }));
    expect(key[0]).toBe(0);
    expect(key[1]).toBe(0);
    expect(key[2]).toBe(255);
  });

  it('removes nothing at zero tolerance except an exact match', () => {
    const doc = fromGrid([['#00ff00', '#01ff00']]);
    const key = computeColorKey(doc, params({ tolerance: 0 }));
    expect(key[0]).toBe(0);
    expect(key[1]).toBe(255);
  });

  it('produces partial alpha inside the soft band', () => {
    const doc = fromGrid([['#00ff00', '#00b400', '#ff00ff']]);
    const key = computeColorKey(doc, params({ tolerance: 5, softness: 60 }));
    expect(key[0]).toBe(0);
    expect(key[1]!).toBeGreaterThan(0);
    expect(key[1]!).toBeLessThan(255);
    expect(key[2]).toBe(255);
  });
});

describe('computeColorKey — contiguous', () => {
  const doc = fromGrid([
    ['#00ff00', '#00ff00', '#ff0000', '#00ff00'],
    ['#00ff00', '#ff0000', '#ff0000', '#00ff00'],
  ]);

  it('only removes the region connected to the seed', () => {
    const key = computeColorKey(doc, params({ contiguous: true, seed: { x: 0, y: 0 } }));
    // The left green block goes; the green column on the right is cut off by
    // the red pixels and must survive.
    expect(key[0]).toBe(0);
    expect(key[1]).toBe(0);
    expect(key[4]).toBe(0);
    expect(key[3]).toBe(255);
    expect(key[7]).toBe(255);
  });

  it('removes both regions when it is not contiguous', () => {
    const key = computeColorKey(doc, params({ contiguous: false }));
    expect(key[3]).toBe(0);
    expect(key[7]).toBe(0);
  });

  it('does nothing when the seed is outside the image', () => {
    const key = computeColorKey(doc, params({ contiguous: true, seed: { x: 99, y: 99 } }));
    expect([...key].every((value) => value === 255)).toBe(true);
  });

  it('does nothing when the seed colour does not match the key', () => {
    const key = computeColorKey(doc, params({ contiguous: true, seed: { x: 2, y: 0 } }));
    expect([...key].every((value) => value === 255)).toBe(true);
  });

  it('handles a fully matching image without overflowing the stack', () => {
    const solid = fromGrid(Array.from({ length: 40 }, () => Array.from({ length: 40 }, () => '#00ff00')));
    const key = computeColorKey(solid, params({ contiguous: true, seed: { x: 20, y: 20 } }));
    expect([...key].every((value) => value === 0)).toBe(true);
  });
});

describe('applyKey', () => {
  it('can only remove more, never restore', () => {
    const mask = bytes([255, 0, 128]);
    const key = bytes([0, 255, 255]);
    expect([...applyKey(mask, key)]).toEqual([0, 0, 128]);
  });
});

describe('sampleColor', () => {
  it('averages a neighbourhood so one noisy pixel does not decide the key', () => {
    const doc = fromGrid([
      ['#000000', '#000000', '#000000'],
      ['#000000', '#ffffff', '#000000'],
      ['#000000', '#000000', '#000000'],
    ]);
    // Eight black neighbours and one white centre average to a near-black.
    expect(sampleColor(doc, 1, 1, 1)).toBe('#1c1c1c');
    // With no radius, the sample is the pixel itself.
    expect(sampleColor(doc, 1, 1, 0)).toBe('#ffffff');
  });

  it('ignores neighbours off the edge instead of reading garbage', () => {
    const doc = fromGrid([
      ['#ff0000', '#ff0000'],
      ['#ff0000', '#ff0000'],
    ]);
    expect(sampleColor(doc, 0, 0, 1)).toBe('#ff0000');
  });
});
