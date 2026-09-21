/**
 * The format catalogue.
 *
 * `supported` distinguishes "Forja can work with this" from "Forja recognises
 * this but a browser cannot open it". Telling someone their HEIC photo was
 * recognised but cannot be decoded is far more useful than a flat rejection.
 */
export type MediaKind = 'image' | 'audio' | 'video';

export interface Format {
  readonly id: string;
  readonly kind: MediaKind;
  readonly label: string;
  readonly mime: string;
  readonly extensions: readonly string[];
  /** False when the format is recognisable but not workable in a browser. */
  readonly supported: boolean;
  /** Why it is not supported — shown to the user verbatim (as a key). */
  readonly unsupportedReason?: 'noBrowserDecoder';
}

function f(format: Format): Format {
  return format;
}

export const FORMATS = {
  // ---- Images ----
  png: f({ id: 'png', kind: 'image', label: 'PNG', mime: 'image/png', extensions: ['png'], supported: true }),
  jpeg: f({ id: 'jpeg', kind: 'image', label: 'JPEG', mime: 'image/jpeg', extensions: ['jpg', 'jpeg', 'jpe'], supported: true }),
  gif: f({ id: 'gif', kind: 'image', label: 'GIF', mime: 'image/gif', extensions: ['gif'], supported: true }),
  webp: f({ id: 'webp', kind: 'image', label: 'WebP', mime: 'image/webp', extensions: ['webp'], supported: true }),
  bmp: f({ id: 'bmp', kind: 'image', label: 'BMP', mime: 'image/bmp', extensions: ['bmp'], supported: true }),
  avif: f({ id: 'avif', kind: 'image', label: 'AVIF', mime: 'image/avif', extensions: ['avif'], supported: true }),
  tiff: f({ id: 'tiff', kind: 'image', label: 'TIFF', mime: 'image/tiff', extensions: ['tif', 'tiff'], supported: false, unsupportedReason: 'noBrowserDecoder' }),
  ico: f({ id: 'ico', kind: 'image', label: 'ICO', mime: 'image/x-icon', extensions: ['ico'], supported: true }),
  heic: f({ id: 'heic', kind: 'image', label: 'HEIC / HEIF', mime: 'image/heic', extensions: ['heic', 'heif'], supported: false, unsupportedReason: 'noBrowserDecoder' }),

  // ---- Audio ----
  mp3: f({ id: 'mp3', kind: 'audio', label: 'MP3', mime: 'audio/mpeg', extensions: ['mp3'], supported: true }),
  wav: f({ id: 'wav', kind: 'audio', label: 'WAV', mime: 'audio/wav', extensions: ['wav', 'wave'], supported: true }),
  flac: f({ id: 'flac', kind: 'audio', label: 'FLAC', mime: 'audio/flac', extensions: ['flac'], supported: true }),
  ogg: f({ id: 'ogg', kind: 'audio', label: 'OGG Vorbis', mime: 'audio/ogg', extensions: ['ogg', 'oga'], supported: true }),
  opus: f({ id: 'opus', kind: 'audio', label: 'Opus', mime: 'audio/ogg', extensions: ['opus'], supported: true }),
  m4a: f({ id: 'm4a', kind: 'audio', label: 'M4A / AAC', mime: 'audio/mp4', extensions: ['m4a', 'm4b'], supported: true }),
  aac: f({ id: 'aac', kind: 'audio', label: 'AAC', mime: 'audio/aac', extensions: ['aac', 'adts'], supported: true }),
  aiff: f({ id: 'aiff', kind: 'audio', label: 'AIFF', mime: 'audio/aiff', extensions: ['aif', 'aiff', 'aifc'], supported: true }),
  weba: f({ id: 'weba', kind: 'audio', label: 'WebM (audio)', mime: 'audio/webm', extensions: ['weba'], supported: true }),

  // ---- Video ----
  mp4: f({ id: 'mp4', kind: 'video', label: 'MP4', mime: 'video/mp4', extensions: ['mp4', 'm4v'], supported: true }),
  mov: f({ id: 'mov', kind: 'video', label: 'QuickTime', mime: 'video/quicktime', extensions: ['mov', 'qt'], supported: true }),
  webm: f({ id: 'webm', kind: 'video', label: 'WebM', mime: 'video/webm', extensions: ['webm'], supported: true }),
  mkv: f({ id: 'mkv', kind: 'video', label: 'Matroska', mime: 'video/x-matroska', extensions: ['mkv'], supported: true }),
  avi: f({ id: 'avi', kind: 'video', label: 'AVI', mime: 'video/x-msvideo', extensions: ['avi'], supported: true }),
  ogv: f({ id: 'ogv', kind: 'video', label: 'OGG Theora', mime: 'video/ogg', extensions: ['ogv'], supported: true }),
  mpegts: f({ id: 'mpegts', kind: 'video', label: 'MPEG-TS', mime: 'video/mp2t', extensions: ['ts', 'mts', 'm2ts'], supported: true }),
  mpeg: f({ id: 'mpeg', kind: 'video', label: 'MPEG-PS', mime: 'video/mpeg', extensions: ['mpg', 'mpeg', 'vob'], supported: true }),
  threegp: f({ id: 'threegp', kind: 'video', label: '3GP', mime: 'video/3gpp', extensions: ['3gp', '3g2'], supported: true }),
  flv: f({ id: 'flv', kind: 'video', label: 'FLV', mime: 'video/x-flv', extensions: ['flv'], supported: true }),
  wmv: f({ id: 'wmv', kind: 'video', label: 'ASF / WMV', mime: 'video/x-ms-wmv', extensions: ['wmv', 'asf'], supported: true }),
} as const satisfies Record<string, Format>;

export type FormatId = keyof typeof FORMATS;

export const ALL_FORMATS: readonly Format[] = Object.values(FORMATS);

export function formatById(id: string): Format | undefined {
  return (FORMATS as Record<string, Format>)[id];
}

/** Formats the user can actually open, grouped for the "what can I drop?" list. */
export function supportedFormatsByKind(kind: MediaKind): readonly Format[] {
  return ALL_FORMATS.filter((format) => format.kind === kind && format.supported);
}
