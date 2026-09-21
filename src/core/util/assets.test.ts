import { describe, expect, it } from 'vitest';
import { assetUrl } from './assets';
import { FONTS } from '../video/fonts';

describe('assetUrl', () => {
  it('joins onto the deployment base', () => {
    // BASE_URL is '/' under the test runner, and '/archivos/' on GitHub Pages.
    expect(assetUrl('ffmpeg/core')).toBe(`${import.meta.env.BASE_URL}ffmpeg/core`);
  });

  it('does not double the separator', () => {
    expect(assetUrl('fonts/x.woff2')).not.toContain('//');
  });
});

describe('public asset paths', () => {
  // A leading slash pins the file to the root of the domain, which breaks
  // every deployment served from a subfolder. This caught it once already.
  it('are relative to the base, never absolute', () => {
    const paths = FONTS.flatMap((font) => Object.values(font.files));
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.filter((path) => path.startsWith('/'))).toEqual([]);
  });
});
