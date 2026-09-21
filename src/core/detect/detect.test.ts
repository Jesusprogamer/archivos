import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectFromBytes, extensionOf, SNIFF_BYTES } from './detect';
import { FORMATS } from './formats';

const FIXTURES = path.resolve(import.meta.dirname, '../../../tests/fixtures');

/** Reads the same leading slice the app reads from a dropped file. */
function head(name: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(FIXTURES, name)).subarray(0, SNIFF_BYTES));
}

/** Builds a synthetic header for formats we have no fixture for. */
function bytes(...parts: Array<string | number[]>): Uint8Array {
  const flat: number[] = [];
  for (const part of parts) {
    if (typeof part === 'string') {
      for (const char of part) flat.push(char.charCodeAt(0));
    } else {
      flat.push(...part);
    }
  }
  return new Uint8Array(flat);
}

describe('detectFromBytes — real files', () => {
  const cases: Array<[string, (typeof FORMATS)[keyof typeof FORMATS]]> = [
    ['photo.png', FORMATS.png],
    ['photo.jpg', FORMATS.jpeg],
    ['photo.webp', FORMATS.webp],
    ['greenscreen.png', FORMATS.png],
    ['tone.mp3', FORMATS.mp3],
    ['tone.wav', FORMATS.wav],
    ['clip.mp4', FORMATS.mp4],
    ['clip.webm', FORMATS.webm],
  ];

  it.each(cases)('identifies %s by its bytes', (file, expected) => {
    const detection = detectFromBytes(head(file), file);
    expect(detection?.format.id).toBe(expected.id);
    expect(detection?.source).toBe('signature');
  });

  it('ignores a lying extension', () => {
    // A PNG renamed to .mp3 is still a PNG.
    expect(detectFromBytes(head('photo.png'), 'trap.mp3')?.format.id).toBe('png');
  });
});

describe('detectFromBytes — synthetic headers', () => {
  it('separates ISO-BMFF brands', () => {
    expect(detectFromBytes(bytes([0, 0, 0, 0x20], 'ftyp', 'avif'))?.format.id).toBe('avif');
    expect(detectFromBytes(bytes([0, 0, 0, 0x20], 'ftyp', 'heic'))?.format.id).toBe('heic');
    expect(detectFromBytes(bytes([0, 0, 0, 0x20], 'ftyp', 'qt  '))?.format.id).toBe('mov');
    expect(detectFromBytes(bytes([0, 0, 0, 0x20], 'ftyp', 'M4A '))?.format.id).toBe('m4a');
    expect(detectFromBytes(bytes([0, 0, 0, 0x20], 'ftyp', '3gp4'))?.format.id).toBe('threegp');
    expect(detectFromBytes(bytes([0, 0, 0, 0x20], 'ftyp', 'isom'))?.format.id).toBe('mp4');
  });

  it('reads the M4A brand from the compatible list, not just the major brand', () => {
    const header = bytes([0, 0, 0, 0x20], 'ftyp', 'isom', [0, 0, 2, 0], 'isomiso2M4A mp41');
    expect(detectFromBytes(header)?.format.id).toBe('m4a');
  });

  it('separates RIFF form types', () => {
    expect(detectFromBytes(bytes('RIFF', [0, 0, 0, 0], 'WAVE'))?.format.id).toBe('wav');
    expect(detectFromBytes(bytes('RIFF', [0, 0, 0, 0], 'WEBP'))?.format.id).toBe('webp');
    expect(detectFromBytes(bytes('RIFF', [0, 0, 0, 0], 'AVI '))?.format.id).toBe('avi');
    expect(detectFromBytes(bytes('RIFF', [0, 0, 0, 0], 'NOPE'))).toBeUndefined();
  });

  it('separates EBML doctypes', () => {
    expect(detectFromBytes(bytes([0x1a, 0x45, 0xdf, 0xa3], 'xxDocTypexwebm'))?.format.id).toBe('webm');
    expect(detectFromBytes(bytes([0x1a, 0x45, 0xdf, 0xa3], 'xxDocTypexmatroska'))?.format.id).toBe('mkv');
  });

  it('routes a .weba file to the audio format', () => {
    const webm = bytes([0x1a, 0x45, 0xdf, 0xa3], 'xxDocTypexwebm');
    expect(detectFromBytes(webm, 'song.weba')?.format.id).toBe('weba');
    expect(detectFromBytes(webm, 'clip.webm')?.format.id).toBe('webm');
  });

  it('separates Ogg codecs by the first page payload', () => {
    const page = (codec: string) => bytes('OggS', new Array(24).fill(0), codec);
    expect(detectFromBytes(page('OpusHead'))?.format.id).toBe('opus');
    expect(detectFromBytes(page('\x01vorbis'))?.format.id).toBe('ogg');
    expect(detectFromBytes(page('\x80theora'))?.format.id).toBe('ogv');
  });

  it('accepts a tagged and a bare MP3', () => {
    expect(detectFromBytes(bytes('ID3', [3, 0, 0, 0, 0, 0, 0]))?.format.id).toBe('mp3');
    expect(detectFromBytes(bytes([0xff, 0xfb, 0x90, 0x00]))?.format.id).toBe('mp3');
  });

  it('rejects MPEG frames with reserved fields', () => {
    expect(detectFromBytes(bytes([0xff, 0xea, 0x90, 0x00]))).toBeUndefined(); // reserved version
    expect(detectFromBytes(bytes([0xff, 0xf9, 0xfc, 0x00]))?.format.id).not.toBe('mp3');
    expect(detectFromBytes(bytes([0xff, 0xfb, 0xf0, 0x00]))).toBeUndefined(); // bad bitrate index
  });

  it('recognises ADTS AAC ahead of MP3', () => {
    expect(detectFromBytes(bytes([0xff, 0xf1, 0x50, 0x80]))?.format.id).toBe('aac');
  });

  it('recognises MPEG-TS by its repeating sync byte', () => {
    const ts = new Uint8Array(400);
    ts[0] = 0x47;
    ts[188] = 0x47;
    ts[376] = 0x47;
    expect(detectFromBytes(ts)?.format.id).toBe('mpegts');
  });

  it('recognises the remaining single-signature formats', () => {
    expect(detectFromBytes(bytes('fLaC'))?.format.id).toBe('flac');
    expect(detectFromBytes(bytes('FORM', [0, 0, 0, 0], 'AIFF'))?.format.id).toBe('aiff');
    expect(detectFromBytes(bytes('FLV', [1]))?.format.id).toBe('flv');
    expect(detectFromBytes(bytes([0x30, 0x26, 0xb2, 0x75]))?.format.id).toBe('wmv');
    expect(detectFromBytes(bytes([0x49, 0x49, 0x2a, 0x00]))?.format.id).toBe('tiff');
    expect(detectFromBytes(bytes('GIF89a'))?.format.id).toBe('gif');
    expect(detectFromBytes(bytes('BM'))?.format.id).toBe('bmp');
  });
});

describe('detectFromBytes — fallbacks', () => {
  it('falls back to the extension when the bytes say nothing', () => {
    const detection = detectFromBytes(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), 'mystery.flac');
    expect(detection?.format.id).toBe('flac');
    expect(detection?.source).toBe('extension');
  });

  it('gives up when neither the bytes nor the name help', () => {
    expect(detectFromBytes(new Uint8Array([1, 2, 3, 4]), 'notes.txt')).toBeUndefined();
    expect(detectFromBytes(new Uint8Array(0), '')).toBeUndefined();
  });

  it('does not crash on a truncated header', () => {
    expect(() => detectFromBytes(new Uint8Array([0xff]))).not.toThrow();
    expect(() => detectFromBytes(bytes('RIFF'))).not.toThrow();
    expect(() => detectFromBytes(bytes([0, 0, 0, 0x20], 'ftyp'))).not.toThrow();
  });
});

describe('extensionOf', () => {
  it('lowercases and handles the awkward cases', () => {
    expect(extensionOf('Song.MP3')).toBe('mp3');
    expect(extensionOf('archive.tar.gz')).toBe('gz');
    expect(extensionOf('noextension')).toBe('');
    expect(extensionOf('.hidden')).toBe('hidden');
  });
});
