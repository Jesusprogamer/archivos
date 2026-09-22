/**
 * What a visualiser looks like.
 *
 * A plain serialisable object, like the video project: the same scene drives
 * the live preview, the export and the saved presets, so a preset cannot drift
 * from what it looked like when it was saved.
 */

export type VisualStyle =
  | 'bars'
  | 'mirrorBars'
  | 'waveLine'
  | 'radial'
  | 'area'
  | 'particles';

export const VISUAL_STYLES: readonly VisualStyle[] = [
  'bars',
  'mirrorBars',
  'waveLine',
  'radial',
  'area',
  'particles',
];

export type AspectId = '16:9' | '9:16' | '1:1' | '4:5';

export const ASPECTS: Readonly<Record<AspectId, number>> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '4:5': 4 / 5,
};

export interface BackgroundSettings {
  /**
   * `transparent` deja el lienzo vacío en lugar de pintarlo.
   *
   * Solo sobrevive a la exportación en WebM: MP4/H.264 no tiene canal alfa, ni
   * lo tendrá. Medido en el spike 7 (PLAN §3.7): libvpx admite `yuva420p` y el
   * navegador reproduce el resultado con transparencia real, aunque el propio
   * ffmpeg la pierda al volver a descodificarlo.
   */
  readonly kind: 'color' | 'gradient' | 'image' | 'transparent';
  readonly color: string;
  readonly gradientTo: string;
  /** Degrees; 0 is left to right. */
  readonly gradientAngle: number;
  /** Object URL of a chosen image, set at runtime. */
  readonly imageName: string;
  /** 0–1: darkens a busy background so the visual stays readable. */
  readonly dim: number;
}

export interface TextLayer {
  readonly title: string;
  readonly artist: string;
  readonly fontFamily: string;
  readonly color: string;
  /** Fraction of the frame height. */
  readonly size: number;
  readonly position: 'top' | 'bottom' | 'center';
  readonly show: boolean;
}

export interface LogoLayer {
  readonly show: boolean;
  readonly name: string;
  /** Fraction of the frame width. */
  readonly size: number;
  readonly position: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' | 'center';
  readonly opacity: number;
}

export interface VisualSettings {
  readonly style: VisualStyle;
  readonly colorFrom: string;
  readonly colorTo: string;
  /** When true, each bar takes its colour from its position in the spectrum. */
  readonly gradientAcross: boolean;
  readonly bars: number;
  /** Pixels at 1080p; scaled with the frame. */
  readonly thickness: number;
  /** 0–1: how much of the previous frame carries over. */
  readonly smoothing: number;
  /** 0.2–4: multiplies every band before drawing. */
  readonly sensitivity: number;
  readonly minFrequency: number;
  readonly maxFrequency: number;
  readonly symmetry: boolean;
  /** 0–1: how much the shape glows. */
  readonly glow: number;
  /** 0–1: how much the whole thing pulses with the bass. */
  readonly bassReaction: number;
  /** 0–1 of the frame height the visual occupies. */
  readonly height: number;
}

export interface VisualizerScene {
  readonly aspect: AspectId;
  readonly height: number;
  readonly fps: number;
  readonly visual: VisualSettings;
  readonly background: BackgroundSettings;
  readonly text: TextLayer;
  readonly logo: LogoLayer;
}

export const DEFAULT_SCENE: VisualizerScene = {
  aspect: '16:9',
  height: 720,
  fps: 30,
  visual: {
    style: 'bars',
    colorFrom: '#ff7a2f',
    colorTo: '#ffd166',
    gradientAcross: true,
    bars: 64,
    thickness: 10,
    smoothing: 0.65,
    sensitivity: 1.2,
    minFrequency: 30,
    maxFrequency: 16000,
    symmetry: false,
    glow: 0.35,
    bassReaction: 0.35,
    height: 0.45,
  },
  background: {
    kind: 'gradient',
    color: '#0a0c0f',
    gradientTo: '#1a1f26',
    gradientAngle: 120,
    imageName: '',
    dim: 0,
  },
  text: {
    title: '',
    artist: '',
    fontFamily: 'Outfit',
    color: '#ffffff',
    size: 0.06,
    position: 'bottom',
    show: false,
  },
  logo: {
    show: false,
    name: '',
    size: 0.12,
    position: 'topRight',
    opacity: 0.9,
  },
};

/** Frame size for an aspect ratio, with an even width the encoders accept. */
export function frameSize(scene: VisualizerScene): { width: number; height: number } {
  const height = Math.round(scene.height / 2) * 2;
  const width = Math.round((height * ASPECTS[scene.aspect]) / 2) * 2;
  return { width, height };
}

export const PRESET_STORAGE_KEY = 'forja.visualizer.presets';

export interface Preset {
  readonly id: string;
  readonly name: string;
  readonly scene: VisualizerScene;
  readonly savedAt: number;
}

function readPresets(): Preset[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PRESET_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Preset[]) : [];
  } catch {
    return [];
  }
}

export function listPresets(): readonly Preset[] {
  return readPresets().sort((a, b) => b.savedAt - a.savedAt);
}

export function savePreset(preset: Preset): void {
  if (typeof localStorage === 'undefined') return;
  const others = readPresets().filter((entry) => entry.id !== preset.id);
  try {
    localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify([preset, ...others].slice(0, 24)));
  } catch {
    // Storage full or blocked: presets are a convenience, not a guarantee.
  }
}

export function deletePreset(id: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      PRESET_STORAGE_KEY,
      JSON.stringify(readPresets().filter((entry) => entry.id !== id)),
    );
  } catch {
    // Nothing to do.
  }
}
