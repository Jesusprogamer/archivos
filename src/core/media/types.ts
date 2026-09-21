import type { Detection } from '../detect/detect';
import type { Format } from '../detect/formats';

export interface ImageMeta {
  readonly kind: 'image';
  readonly width: number;
  readonly height: number;
}

export interface AudioMeta {
  readonly kind: 'audio';
  readonly duration: number;
}

export interface VideoMeta {
  readonly kind: 'video';
  readonly width: number;
  readonly height: number;
  readonly duration: number;
  readonly hasAudio: boolean;
}

export type MediaMeta = ImageMeta | AudioMeta | VideoMeta;

export interface MediaItem {
  readonly id: string;
  readonly file: File;
  readonly name: string;
  readonly size: number;
  readonly format: Format;
  readonly detectedBy: Detection['source'];
  /** Object URL, created once per item and revoked when it is removed. */
  readonly url: string;
  /** Filled in asynchronously; `undefined` until the probe finishes. */
  readonly meta?: MediaMeta;
  /** Set when probing failed — the item is still listed, honestly marked. */
  readonly probeError?: string;
}

/** A file that was recognised but cannot be worked with, kept to explain why. */
export interface RejectedFile {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly format?: Format;
  readonly reason: 'unknownFormat' | 'noBrowserDecoder';
}
