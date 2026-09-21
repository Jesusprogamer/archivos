import { FORMATS, formatById, type Format } from './formats';

/** Bytes read from the head of a file. Enough for every signature we check. */
export const SNIFF_BYTES = 4096;

export type DetectionSource = 'signature' | 'extension';

export interface Detection {
  readonly format: Format;
  /**
   * `signature` means the file's own bytes identified it. `extension` is the
   * fallback for the few container-less formats (raw AAC, bare MPEG audio)
   * whose bytes are genuinely ambiguous.
   */
  readonly source: DetectionSource;
}

const ascii = (bytes: Uint8Array, start: number, length: number): string => {
  let out = '';
  for (let i = start; i < start + length && i < bytes.length; i += 1) {
    out += String.fromCharCode(bytes[i]!);
  }
  return out;
};

const startsWith = (bytes: Uint8Array, offset: number, signature: readonly number[]): boolean => {
  if (offset + signature.length > bytes.length) return false;
  return signature.every((byte, i) => bytes[offset + i] === byte);
};

const indexOfAscii = (bytes: Uint8Array, needle: string, limit: number): number => {
  const end = Math.min(bytes.length, limit) - needle.length;
  outer: for (let i = 0; i <= end; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (bytes[i + j] !== needle.charCodeAt(j)) continue outer;
    }
    return i;
  }
  return -1;
};

/**
 * ISO base media files (MP4, MOV, M4A, AVIF, HEIC, 3GP) all begin with an
 * `ftyp` box; only the brand tells them apart.
 */
function detectIsoBmff(bytes: Uint8Array): Format | undefined {
  if (ascii(bytes, 4, 4) !== 'ftyp') return undefined;
  const brand = ascii(bytes, 8, 4);
  const compatible = ascii(bytes, 8, 64);

  if (brand === 'avif' || brand === 'avis') return FORMATS.avif;
  if (['heic', 'heix', 'heim', 'heis', 'hevc', 'mif1', 'msf1'].includes(brand)) return FORMATS.heic;
  if (brand === 'qt  ') return FORMATS.mov;
  if (brand === 'M4A ' || brand === 'M4B ') return FORMATS.m4a;
  if (brand.startsWith('3g')) return FORMATS.threegp;
  // `isom`, `mp41`, `mp42`, `avc1`, `dash`, `M4V ` and friends: an MP4 whose
  // audio-only variants declare an M4A brand among the compatible ones.
  if (compatible.includes('M4A ')) return FORMATS.m4a;
  return FORMATS.mp4;
}

/** RIFF containers: the form type at byte 8 disambiguates them. */
function detectRiff(bytes: Uint8Array): Format | undefined {
  if (ascii(bytes, 0, 4) !== 'RIFF') return undefined;
  const form = ascii(bytes, 8, 4);
  if (form === 'WAVE') return FORMATS.wav;
  if (form === 'WEBP') return FORMATS.webp;
  if (form === 'AVI ') return FORMATS.avi;
  return undefined;
}

/** EBML: WebM and MKV share the magic; the DocType element separates them. */
function detectEbml(bytes: Uint8Array): Format | undefined {
  if (!startsWith(bytes, 0, [0x1a, 0x45, 0xdf, 0xa3])) return undefined;
  // The DocType sits in the EBML header, well within the first few hundred bytes.
  if (indexOfAscii(bytes, 'webm', 256) !== -1) return FORMATS.webm;
  if (indexOfAscii(bytes, 'matroska', 256) !== -1) return FORMATS.mkv;
  return FORMATS.mkv;
}

/** Ogg: the codec identifier lives in the first page payload, at byte 28. */
function detectOgg(bytes: Uint8Array): Format | undefined {
  if (ascii(bytes, 0, 4) !== 'OggS') return undefined;
  const payload = ascii(bytes, 28, 8);
  if (payload.startsWith('OpusHead')) return FORMATS.opus;
  if (payload.includes('theora')) return FORMATS.ogv;
  if (payload.includes('vorbis')) return FORMATS.ogg;
  if (payload.startsWith('fLaC')) return FORMATS.flac;
  // A rarer codec in an Ogg wrapper: treat it as audio and let ffmpeg decide.
  return FORMATS.ogg;
}

/**
 * A bare MPEG audio frame: 11 sync bits, then a version and layer that must
 * not be the reserved values. Checking those fields keeps us from matching any
 * file that happens to start with 0xFF.
 */
function isMpegAudioFrame(bytes: Uint8Array, offset: number): boolean {
  const b0 = bytes[offset];
  const b1 = bytes[offset + 1];
  const b2 = bytes[offset + 2];
  if (b0 !== 0xff || b1 === undefined || b2 === undefined) return false;
  if ((b1 & 0xe0) !== 0xe0) return false;
  if ((b1 & 0x18) === 0x08) return false; // reserved MPEG version
  if ((b1 & 0x06) === 0x00) return false; // reserved layer
  if ((b2 & 0xf0) === 0xf0) return false; // invalid bitrate index
  if ((b2 & 0x0c) === 0x0c) return false; // reserved sample rate
  return true;
}

function detectBySignature(bytes: Uint8Array): Format | undefined {
  // Containers first: their magic is unambiguous.
  const container = detectIsoBmff(bytes) ?? detectRiff(bytes) ?? detectEbml(bytes) ?? detectOgg(bytes);
  if (container) return container;

  if (startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return FORMATS.png;
  if (startsWith(bytes, 0, [0xff, 0xd8, 0xff])) return FORMATS.jpeg;
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return FORMATS.gif;
  if (ascii(bytes, 0, 2) === 'BM') return FORMATS.bmp;
  if (startsWith(bytes, 0, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, 0, [0x4d, 0x4d, 0x00, 0x2a])) {
    return FORMATS.tiff;
  }
  if (startsWith(bytes, 0, [0x00, 0x00, 0x01, 0x00])) return FORMATS.ico;

  if (ascii(bytes, 0, 4) === 'fLaC') return FORMATS.flac;
  if (ascii(bytes, 0, 4) === 'FORM' && ascii(bytes, 8, 4).startsWith('AIF')) return FORMATS.aiff;
  if (ascii(bytes, 0, 3) === 'FLV') return FORMATS.flv;
  if (startsWith(bytes, 0, [0x30, 0x26, 0xb2, 0x75])) return FORMATS.wmv;
  if (startsWith(bytes, 0, [0x00, 0x00, 0x01, 0xba])) return FORMATS.mpeg;

  // MPEG-TS: 0x47 sync byte repeating every 188 bytes.
  if (bytes[0] === 0x47 && bytes[188] === 0x47 && bytes[376] === 0x47) return FORMATS.mpegts;

  // ADTS AAC: sync word with layer bits at zero.
  if (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xf6) === 0xf0) return FORMATS.aac;

  // MP3, either tagged or a bare first frame.
  if (ascii(bytes, 0, 3) === 'ID3') return FORMATS.mp3;
  if (isMpegAudioFrame(bytes, 0)) return FORMATS.mp3;

  return undefined;
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

function detectByExtension(name: string): Format | undefined {
  const extension = extensionOf(name);
  if (!extension) return undefined;
  return Object.values(FORMATS).find((format) => format.extensions.includes(extension));
}

/**
 * Identifies a file from its leading bytes, falling back to the extension only
 * when the bytes say nothing. The name is also used to break one specific tie:
 * a `.weba` file is an EBML stream whose DocType is `webm`.
 */
export function detectFromBytes(bytes: Uint8Array, name = ''): Detection | undefined {
  const bySignature = detectBySignature(bytes);
  if (bySignature) {
    if (bySignature === FORMATS.webm && extensionOf(name) === 'weba') {
      return { format: FORMATS.weba, source: 'signature' };
    }
    return { format: bySignature, source: 'signature' };
  }
  const byExtension = detectByExtension(name);
  return byExtension ? { format: byExtension, source: 'extension' } : undefined;
}

/** Reads just the head of a Blob and identifies it. */
export async function detectFile(file: File | Blob, name?: string): Promise<Detection | undefined> {
  const head = file.slice(0, SNIFF_BYTES);
  const bytes = new Uint8Array(await head.arrayBuffer());
  return detectFromBytes(bytes, name ?? (file instanceof File ? file.name : ''));
}

export { formatById };
