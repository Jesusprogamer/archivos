import { describe, expect, it } from 'vitest';
import { FORMATS } from '../detect/formats';
import { DEFAULT_OPTIONS, type ConversionOptions } from './options';
import { gifArgs, targetById, targetsFor } from './targets';

function options(overrides: Partial<ConversionOptions> = {}): ConversionOptions {
  return structuredClone({ ...DEFAULT_OPTIONS, ...overrides });
}

function argsFor(id: string, o = options()): string[] {
  const target = targetById(id);
  if (!target?.args) throw new Error(`${id} has no argument builder`);
  return target.args(o, 'in.bin', 'out.bin');
}

/** Reads the value that follows a flag, the way ffmpeg parses it. */
function valueOf(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

describe('targetsFor', () => {
  it('offers only audio outputs for an audio file', () => {
    const ids = targetsFor(FORMATS.mp3).map((target) => target.id);
    expect(ids).toEqual(['mp3', 'wav', 'ogg', 'flac', 'm4a']);
  });

  it('offers video, GIF and audio extraction for a video file', () => {
    const ids = targetsFor(FORMATS.mp4).map((target) => target.id);
    expect(ids).toContain('mp4');
    expect(ids).toContain('webm');
    expect(ids).toContain('gif');
    expect(ids).toContain('mp3');
    // AV1 is absent from this ffmpeg build, so it must never be offered.
    expect(ids).not.toContain('av1');
  });

  it('never offers Opus, which traps this build on stereo input', () => {
    // Measured, not assumed (PLAN.md §3.6). Reading Opus still works.
    for (const format of [FORMATS.mp3, FORMATS.mp4, FORMATS.wav]) {
      expect(targetsFor(format).map((target) => target.id)).not.toContain('opus');
    }
  });

  it('hides canvas formats the browser cannot encode', () => {
    const withAvif = targetsFor(FORMATS.png, new Set(['image/png', 'image/jpeg', 'image/avif']));
    const withoutAvif = targetsFor(FORMATS.png, new Set(['image/png', 'image/jpeg']));
    expect(withAvif.map((t) => t.id)).toContain('avif');
    expect(withoutAvif.map((t) => t.id)).not.toContain('avif');
    // ffmpeg-backed image targets stay regardless of canvas support.
    expect(withoutAvif.map((t) => t.id)).toContain('bmp');
  });
});

describe('audio arguments', () => {
  it('drops the video stream when extracting audio', () => {
    expect(argsFor('mp3')).toContain('-vn');
  });

  it('passes the chosen bit rate to lossy encoders', () => {
    const o = options({ audio: { bitrateKbps: 320, sampleRate: 'source', channels: 'source' } });
    expect(valueOf(argsFor('mp3', o), '-b:a')).toBe('320k');
    expect(valueOf(argsFor('ogg', o), '-c:a')).toBe('libvorbis');
  });

  it('omits the bit rate for lossless encoders, where it means nothing', () => {
    expect(argsFor('wav')).not.toContain('-b:a');
    expect(argsFor('flac')).not.toContain('-b:a');
    expect(valueOf(argsFor('wav'), '-c:a')).toBe('pcm_s16le');
  });

  it('only sets sample rate and channels when they are not "source"', () => {
    expect(argsFor('mp3')).not.toContain('-ar');
    expect(argsFor('mp3')).not.toContain('-ac');
    const o = options({ audio: { bitrateKbps: 192, sampleRate: 48000, channels: 1 } });
    expect(valueOf(argsFor('mp3', o), '-ar')).toBe('48000');
    expect(valueOf(argsFor('mp3', o), '-ac')).toBe('1');
  });

  it('uses the ipod muxer for M4A so players treat it as music', () => {
    expect(valueOf(argsFor('m4a'), '-f')).toBe('ipod');
  });
});

describe('video arguments', () => {
  it('forces even dimensions even when keeping the source size', () => {
    // H.264 with 4:2:0 chroma rejects odd width or height.
    expect(valueOf(argsFor('mp4'), '-vf')).toBe('scale=trunc(iw/2)*2:trunc(ih/2)*2');
  });

  it('never upscales when a height is chosen', () => {
    const o = options();
    o.video.height = 720;
    expect(valueOf(argsFor('mp4', o), '-vf')).toBe("scale=-2:'min(720,ih)'");
  });

  it('maps quality levels to per-codec CRF values', () => {
    const high = options();
    high.video.quality = 'high';
    const small = options();
    small.video.quality = 'small';
    expect(valueOf(argsFor('mp4', high), '-crf')).toBe('18');
    expect(valueOf(argsFor('mp4', small), '-crf')).toBe('28');
    // x265 needs a higher CRF for comparable quality, so the numbers differ.
    expect(valueOf(argsFor('mp4-h265', high), '-crf')).toBe('22');
  });

  it('puts the MP4 index at the front so the file streams', () => {
    expect(valueOf(argsFor('mp4'), '-movflags')).toBe('+faststart');
  });

  it('tags H.265 as hvc1 so Apple players accept it', () => {
    expect(valueOf(argsFor('mp4-h265'), '-tag:v')).toBe('hvc1');
  });

  it('uses VP8 with Vorbis for WebM', () => {
    const args = argsFor('webm');
    expect(valueOf(args, '-c:v')).toBe('libvpx');
    // Not Opus: it traps the Matroska muxer in this build (PLAN.md §3.6).
    expect(valueOf(args, '-c:a')).toBe('libvorbis');
    expect(valueOf(args, '-cpu-used')).toBe('5');
  });

  it('never asks for VP9, which crashes this build of libvpx', () => {
    // Measured, not assumed: libvpx-vp9 is in the encoder list but traps with
    // "memory access out of bounds" after the first frame in every
    // configuration (PLAN.md §3.6). This guards against it being helpfully
    // reinstated by someone reading the usual advice.
    for (const id of ['webm']) {
      expect(argsFor(id)).not.toContain('libvpx-vp9');
      expect(argsFor(id)).not.toContain('-row-mt');
    }
  });

  it('only sets the frame rate when it is not "source"', () => {
    expect(argsFor('mp4')).not.toContain('-r');
    const o = options();
    o.video.fps = 24;
    expect(valueOf(argsFor('mp4', o), '-r')).toBe('24');
  });
});

describe('gifArgs', () => {
  it('builds a palette first and applies it second', () => {
    const { first, second } = gifArgs(options(), 'in.mp4', 'pal.png');
    expect(first.join(' ')).toContain('palettegen');
    expect(second.join(' ')).toContain('paletteuse');
    expect(second).toContain('pal.png');
  });

  it('uses the same filter chain in both passes, or the palette would not match', () => {
    const { first, second } = gifArgs(options(), 'in.mp4', 'pal.png');
    const chain = 'fps=12,scale=-2:\'min(360,ih)\':flags=lanczos';
    expect(first.join(' ')).toContain(chain);
    expect(second.join(' ')).toContain(chain);
  });

  it('caps the frame rate and size, which GIF cannot sensibly carry', () => {
    const o = options();
    o.video.fps = 60;
    o.video.height = 2160;
    const { first } = gifArgs(o, 'in.mp4', 'pal.png');
    expect(first.join(' ')).toContain('fps=25');
    expect(first.join(' ')).toContain('min(2160,ih)');
  });

  it('loops forever, which is what people expect from a GIF', () => {
    expect(gifArgs(options(), 'in.mp4', 'pal.png').second).toContain('-loop');
  });
});
