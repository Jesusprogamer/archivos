// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { Frame } from './analysis';
import { shapeBands } from './draw';
import {
  ASPECTS,
  DEFAULT_SCENE,
  VISUAL_STYLES,
  deletePreset,
  frameSize,
  listPresets,
  savePreset,
} from './scene';

function frame(bands: number[]): Frame {
  return {
    bands: new Float32Array(bands),
    level: 0.5,
    bass: 0.5,
    wave: new Float32Array(8).fill(0.5),
  };
}

describe('frameSize', () => {
  it('derives the width from the aspect ratio', () => {
    expect(frameSize({ ...DEFAULT_SCENE, aspect: '16:9', height: 720 })).toEqual({
      width: 1280,
      height: 720,
    });
    expect(frameSize({ ...DEFAULT_SCENE, aspect: '1:1', height: 1080 })).toEqual({
      width: 1080,
      height: 1080,
    });
  });

  it('gives a portrait frame for the vertical ratios', () => {
    const vertical = frameSize({ ...DEFAULT_SCENE, aspect: '9:16', height: 1280 });
    expect(vertical.width).toBeLessThan(vertical.height);
    const fourFive = frameSize({ ...DEFAULT_SCENE, aspect: '4:5', height: 1350 });
    expect(fourFive.width).toBeLessThan(fourFive.height);
  });

  it('always returns even dimensions, which the encoders insist on', () => {
    for (const aspect of Object.keys(ASPECTS) as Array<keyof typeof ASPECTS>) {
      for (const height of [481, 721, 1081, 999]) {
        const size = frameSize({ ...DEFAULT_SCENE, aspect, height });
        expect(size.width % 2, `${aspect} at ${height}`).toBe(0);
        expect(size.height % 2, `${aspect} at ${height}`).toBe(0);
      }
    }
  });
});

describe('shapeBands', () => {
  const visual = DEFAULT_SCENE.visual;

  it('applies sensitivity', () => {
    const out = shapeBands(frame([0.2, 0.3]), { ...visual, sensitivity: 2, symmetry: false });
    expect(out[0]).toBeCloseTo(0.4, 5);
  });

  it('clamps to one rather than drawing past the frame', () => {
    const out = shapeBands(frame([0.9]), { ...visual, sensitivity: 4, symmetry: false });
    expect(out[0]).toBe(1);
  });

  it('never returns a negative value', () => {
    const out = shapeBands(frame([0, 0]), { ...visual, sensitivity: 3, symmetry: false });
    expect([...out].every((value) => value >= 0)).toBe(true);
  });

  it('mirrors around the centre when symmetry is on', () => {
    const out = shapeBands(frame([1, 0.8, 0.6, 0.4, 0.2, 0.1, 0.05, 0]), {
      ...visual,
      sensitivity: 1,
      symmetry: true,
    });
    // Symmetric about the middle, to within the resampling.
    expect(out[3]).toBeCloseTo(out[4]!, 5);
    expect(out[2]).toBeCloseTo(out[5]!, 5);
  });

  it('keeps the same number of bands', () => {
    const input = frame([0.1, 0.2, 0.3, 0.4]);
    expect(shapeBands(input, { ...visual, symmetry: true })).toHaveLength(4);
    expect(shapeBands(input, { ...visual, symmetry: false })).toHaveLength(4);
  });
});

describe('the style catalogue', () => {
  it('offers at least the six the brief asks for', () => {
    expect(VISUAL_STYLES.length).toBeGreaterThanOrEqual(6);
    expect(new Set(VISUAL_STYLES).size).toBe(VISUAL_STYLES.length);
  });
});

describe('presets', () => {
  beforeEach(() => localStorage.clear());

  it('saves and lists', () => {
    savePreset({ id: 'a', name: 'Mío', scene: DEFAULT_SCENE, savedAt: 1 });
    expect(listPresets()).toHaveLength(1);
    expect(listPresets()[0]?.name).toBe('Mío');
  });

  it('replaces a preset with the same id instead of duplicating it', () => {
    savePreset({ id: 'a', name: 'Uno', scene: DEFAULT_SCENE, savedAt: 1 });
    savePreset({ id: 'a', name: 'Dos', scene: DEFAULT_SCENE, savedAt: 2 });
    expect(listPresets()).toHaveLength(1);
    expect(listPresets()[0]?.name).toBe('Dos');
  });

  it('lists the newest first', () => {
    savePreset({ id: 'old', name: 'Viejo', scene: DEFAULT_SCENE, savedAt: 1 });
    savePreset({ id: 'new', name: 'Nuevo', scene: DEFAULT_SCENE, savedAt: 2 });
    expect(listPresets()[0]?.id).toBe('new');
  });

  it('deletes', () => {
    savePreset({ id: 'a', name: 'Mío', scene: DEFAULT_SCENE, savedAt: 1 });
    deletePreset('a');
    expect(listPresets()).toHaveLength(0);
  });

  it('survives corrupted storage', () => {
    localStorage.setItem('forja.visualizer.presets', '{{{');
    expect(listPresets()).toEqual([]);
  });

  it('round-trips a whole scene, so a preset cannot drift from what was saved', () => {
    const scene = {
      ...DEFAULT_SCENE,
      aspect: '9:16' as const,
      visual: { ...DEFAULT_SCENE.visual, style: 'radial' as const, bars: 96 },
    };
    savePreset({ id: 'a', name: 'Vertical', scene, savedAt: 1 });
    const restored = listPresets()[0]!.scene;
    expect(restored.aspect).toBe('9:16');
    expect(restored.visual.style).toBe('radial');
    expect(restored.visual.bars).toBe(96);
  });
});
