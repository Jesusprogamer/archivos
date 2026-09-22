import { describe, expect, it } from 'vitest';
import { DEFAULT_SCENE } from './scene';
import { keepsAlpha } from './exporter';

describe('keepsAlpha', () => {
  const transparent = {
    ...DEFAULT_SCENE,
    background: { ...DEFAULT_SCENE.background, kind: 'transparent' as const },
  };

  it('keeps the alpha channel for a transparent background in WebM', () => {
    expect(keepsAlpha(transparent, 'webm')).toBe(true);
  });

  it('does not pretend MP4 can carry alpha', () => {
    // H.264 has no alpha channel. Asking for it would not fail loudly, it
    // would silently flatten the background to black, so the UI warns instead.
    expect(keepsAlpha(transparent, 'mp4')).toBe(false);
  });

  it('leaves an opaque background alone in both formats', () => {
    expect(keepsAlpha(DEFAULT_SCENE, 'webm')).toBe(false);
    expect(keepsAlpha(DEFAULT_SCENE, 'mp4')).toBe(false);
  });
});
