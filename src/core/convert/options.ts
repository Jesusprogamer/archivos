import type { MediaKind } from '../detect/formats';

/**
 * Conversion options, kept deliberately small.
 *
 * Every field here maps to a control the user can see and to an ffmpeg
 * argument we actually pass. Nothing is carried around "just in case".
 */

export type QualityLevel = 'high' | 'balanced' | 'small';

export const QUALITY_LEVELS: readonly QualityLevel[] = ['high', 'balanced', 'small'];

/** `'source'` means: leave it exactly as the input had it. */
export type Source = 'source';

export interface AudioOptions {
  /** Ignored by lossless targets (WAV, FLAC), which hide the control. */
  bitrateKbps: number;
  sampleRate: number | Source;
  channels: 1 | 2 | Source;
}

export interface VideoOptions {
  /** Output height in pixels; width follows the source aspect ratio. */
  height: number | Source;
  fps: number | Source;
  quality: QualityLevel;
  audio: AudioOptions;
}

export interface ImageOptions {
  /** 1–100 for lossy encoders; ignored by PNG and BMP. */
  quality: number;
  /** Longest-edge limit, or `'source'` to keep the original size. */
  maxSize: number | Source;
}

export interface ConversionOptions {
  audio: AudioOptions;
  video: VideoOptions;
  image: ImageOptions;
}

export const DEFAULT_OPTIONS: ConversionOptions = {
  audio: { bitrateKbps: 192, sampleRate: 'source', channels: 'source' },
  video: {
    height: 'source',
    fps: 'source',
    quality: 'balanced',
    audio: { bitrateKbps: 160, sampleRate: 'source', channels: 'source' },
  },
  image: { quality: 85, maxSize: 'source' },
};

export const AUDIO_BITRATES = [64, 96, 128, 160, 192, 256, 320] as const;
export const SAMPLE_RATES = [22050, 32000, 44100, 48000] as const;
export const VIDEO_HEIGHTS = [2160, 1440, 1080, 720, 480, 360] as const;
export const FRAME_RATES = [60, 30, 25, 24, 15, 12] as const;

/** Which option group a target needs shown. */
export type ControlGroup = MediaKind;
