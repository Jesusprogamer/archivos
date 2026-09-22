import { x264ThreadArgs } from '../ffmpeg/threads';
import { FORMATS, type Format, type MediaKind } from '../detect/formats';
import type { ConversionOptions, QualityLevel } from './options';

/**
 * Output formats, restricted to what the bundled ffmpeg core can genuinely
 * produce.
 *
 * The list was not copied from the ffmpeg documentation: it comes from running
 * `-encoders` and `-muxers` against this exact build in a browser (PLAN.md
 * §3.2). That is why AV1 is missing and H.265 is present — the opposite of what
 * the usual advice suggests.
 */

export type Engine = 'ffmpeg' | 'canvas';

export interface Target {
  readonly id: string;
  readonly format: Format;
  /** What the output is, which decides the controls shown. */
  readonly outputKind: MediaKind;
  readonly extension: string;
  /** Canvas handles the common image encodings without loading 32 MB of wasm. */
  readonly engine: Engine;
  /** Shown with a warning; the format works but playback support is patchy. */
  readonly caveat?: 'h265Playback' | 'gifColours' | 'jpegNoAlpha';
  /** Built only for ffmpeg targets. */
  readonly args?: (options: ConversionOptions, input: string, output: string) => string[];
}

/** CRF values per quality level, tuned per codec rather than shared blindly. */
const CRF: Record<'x264' | 'x265' | 'vp8', Record<QualityLevel, number>> = {
  x264: { high: 18, balanced: 23, small: 28 },
  x265: { high: 22, balanced: 28, small: 33 },
  vp8: { high: 10, balanced: 20, small: 32 },
};

/**
 * VP8 needs a bit-rate ceiling alongside its CRF.
 *
 * Unlike x264, libvpx treats CRF as a quality target within a bit-rate budget;
 * with `-b:v 0` it produces the constrained-quality mode, which this build
 * handles but which makes file sizes wildly unpredictable on detailed footage.
 */
const BITRATE: Record<QualityLevel, string> = {
  high: '4M',
  balanced: '2M',
  small: '1M',
};

/**
 * x264/x265 presets. `veryfast` and below are deliberate: in WebAssembly a
 * slower preset can triple the wait for a barely visible gain.
 */
const PRESET: Record<QualityLevel, string> = {
  high: 'medium',
  balanced: 'veryfast',
  small: 'veryfast',
};

function audioArgs(
  options: ConversionOptions['audio'],
  codec: string,
  lossless = false,
): string[] {
  const args = ['-c:a', codec];
  if (!lossless) args.push('-b:a', `${options.bitrateKbps}k`);
  if (options.sampleRate !== 'source') args.push('-ar', String(options.sampleRate));
  if (options.channels !== 'source') args.push('-ac', String(options.channels));
  return args;
}

/**
 * Scaling that never upscales and always lands on even dimensions, which
 * H.264 and VP9 both require with 4:2:0 chroma.
 */
function scaleFilter(height: number | 'source'): string | undefined {
  if (height === 'source') return 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
  return `scale=-2:'min(${height},ih)'`;
}

function videoArgs(
  options: ConversionOptions,
  codec: 'x264' | 'x265' | 'vp8',
  audioCodec: string,
): string[] {
  const { video } = options;
  const args: string[] = [];
  const filters = [scaleFilter(video.height)].filter(Boolean) as string[];
  if (filters.length > 0) args.push('-vf', filters.join(','));
  if (video.fps !== 'source') args.push('-r', String(video.fps));

  if (codec === 'vp8') {
    args.push(
      // VP8, not VP9, and not by preference.
      //
      // `libvpx-vp9` is present in this core's encoder list but traps with
      // "memory access out of bounds" after the first frame, in every
      // configuration tried: with and without `-row-mt`, both deadlines,
      // `-threads 1`, and constant-bitrate mode (PLAN.md §3.6). VP8 encodes the
      // same clip cleanly, and four times faster with a realtime deadline.
      '-c:v', 'libvpx',
      '-crf', String(CRF.vp8[video.quality]),
      '-b:v', String(BITRATE[video.quality]),
      '-deadline', video.quality === 'high' ? 'good' : 'realtime',
      '-cpu-used', video.quality === 'high' ? '2' : '5',
    );
  } else {
    args.push(
      '-c:v', codec === 'x264' ? 'libx264' : 'libx265',
      '-preset', PRESET[video.quality],
      '-crf', String(CRF[codec][video.quality]),
      '-pix_fmt', 'yuv420p',
      // Solo x264: sin `-threads` explícito se cae contra el núcleo multihilo.
      // A x265 le sienta peor forzarlo, y no lo necesita (PLAN §3.8).
      ...(codec === 'x264' ? x264ThreadArgs() : []),
    );
    if (codec === 'x265') args.push('-tag:v', 'hvc1');
  }

  // See the note on the WebM target: the audio codec is chosen by what this
  // build can actually mux, not by what compresses best.
  args.push(...audioArgs(video.audio, audioCodec));
  return args;
}

/**
 * Audio outputs.
 *
 * Opus is **not** here, and its absence is measured rather than an oversight:
 * `libopus` is compiled into this core and encodes mono happily, but traps with
 * "memory access out of bounds" on any stereo input, at every sample rate and
 * bit-rate mode tried (PLAN.md §3.6). Offering a format that silently downmixes
 * to mono, or that fails on most real files, would be worse than not offering
 * it. Forja can still *read* Opus; it just cannot write it.
 */
const AUDIO_TARGETS: readonly Target[] = [
  {
    id: 'mp3',
    format: FORMATS.mp3,
    outputKind: 'audio',
    extension: 'mp3',
    engine: 'ffmpeg',
    args: (o, i, out) => ['-i', i, '-vn', ...audioArgs(o.audio, 'libmp3lame'), out],
  },
  {
    id: 'wav',
    format: FORMATS.wav,
    outputKind: 'audio',
    extension: 'wav',
    engine: 'ffmpeg',
    args: (o, i, out) => ['-i', i, '-vn', ...audioArgs(o.audio, 'pcm_s16le', true), out],
  },
  {
    id: 'ogg',
    format: FORMATS.ogg,
    outputKind: 'audio',
    extension: 'ogg',
    engine: 'ffmpeg',
    args: (o, i, out) => ['-i', i, '-vn', ...audioArgs(o.audio, 'libvorbis'), out],
  },
  {
    id: 'flac',
    format: FORMATS.flac,
    outputKind: 'audio',
    extension: 'flac',
    engine: 'ffmpeg',
    args: (o, i, out) => ['-i', i, '-vn', ...audioArgs(o.audio, 'flac', true), out],
  },
  {
    id: 'm4a',
    format: FORMATS.m4a,
    outputKind: 'audio',
    extension: 'm4a',
    engine: 'ffmpeg',
    // The `ipod` muxer is what produces a player-friendly .m4a rather than a
    // bare MP4 that some devices refuse to treat as music.
    args: (o, i, out) => ['-i', i, '-vn', ...audioArgs(o.audio, 'aac'), '-f', 'ipod', out],
  },
];

const VIDEO_TARGETS: readonly Target[] = [
  {
    id: 'mp4',
    format: FORMATS.mp4,
    outputKind: 'video',
    extension: 'mp4',
    engine: 'ffmpeg',
    args: (o, i, out) => [
      '-i', i,
      ...videoArgs(o, 'x264', 'aac'),
      // Puts the index at the front so the file plays before it finishes loading.
      '-movflags', '+faststart',
      out,
    ],
  },
  {
    id: 'webm',
    format: FORMATS.webm,
    outputKind: 'video',
    extension: 'webm',
    engine: 'ffmpeg',
    args: (o, i, out) => ['-i', i, ...videoArgs(o, 'vp8', 'libvorbis'), out],
  },
  {
    id: 'mkv',
    format: FORMATS.mkv,
    outputKind: 'video',
    extension: 'mkv',
    engine: 'ffmpeg',
    args: (o, i, out) => ['-i', i, ...videoArgs(o, 'x264', 'aac'), out],
  },
  {
    id: 'mov',
    format: FORMATS.mov,
    outputKind: 'video',
    extension: 'mov',
    engine: 'ffmpeg',
    args: (o, i, out) => ['-i', i, ...videoArgs(o, 'x264', 'aac'), '-f', 'mov', out],
  },
  {
    id: 'mp4-h265',
    format: FORMATS.mp4,
    outputKind: 'video',
    extension: 'mp4',
    engine: 'ffmpeg',
    caveat: 'h265Playback',
    args: (o, i, out) => ['-i', i, ...videoArgs(o, 'x265', 'aac'), '-movflags', '+faststart', out],
  },
];

/**
 * GIF needs two passes: one to build a palette from the whole clip, one to
 * apply it. A single pass uses a generic 256-colour palette and looks it.
 */
export function gifArgs(
  options: ConversionOptions,
  input: string,
  palette: string,
): { first: string[]; second: string[] } {
  const fps = options.video.fps === 'source' ? 12 : Math.min(options.video.fps, 25);
  const height = options.video.height === 'source' ? 360 : options.video.height;
  const chain = `fps=${fps},scale=-2:'min(${height},ih)':flags=lanczos`;
  return {
    first: ['-i', input, '-vf', `${chain},palettegen=stats_mode=diff`, '-y', palette],
    second: [
      '-i', input,
      '-i', palette,
      '-filter_complex', `${chain}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3`,
      '-loop', '0',
      '-y', 'output.gif',
    ],
  };
}

const GIF_TARGET: Target = {
  id: 'gif',
  format: FORMATS.gif,
  outputKind: 'image',
  extension: 'gif',
  engine: 'ffmpeg',
  caveat: 'gifColours',
};

const IMAGE_TARGETS: readonly Target[] = [
  { id: 'png', format: FORMATS.png, outputKind: 'image', extension: 'png', engine: 'canvas' },
  {
    id: 'jpeg',
    format: FORMATS.jpeg,
    outputKind: 'image',
    extension: 'jpg',
    engine: 'canvas',
    caveat: 'jpegNoAlpha',
  },
  { id: 'webp', format: FORMATS.webp, outputKind: 'image', extension: 'webp', engine: 'canvas' },
  { id: 'avif', format: FORMATS.avif, outputKind: 'image', extension: 'avif', engine: 'canvas' },
  {
    id: 'bmp',
    format: FORMATS.bmp,
    outputKind: 'image',
    extension: 'bmp',
    engine: 'ffmpeg',
    args: (_o, i, out) => ['-i', i, '-frames:v', '1', out],
  },
  {
    id: 'gif-still',
    format: FORMATS.gif,
    outputKind: 'image',
    extension: 'gif',
    engine: 'ffmpeg',
    args: (_o, i, out) => ['-i', i, '-frames:v', '1', out],
  },
];

/**
 * The output formats offered for a given input.
 *
 * Video gains the audio list (extracting the sound) and GIF. Audio gets only
 * audio. Images get images.
 */
export function targetsFor(format: Format, canvasTypes?: ReadonlySet<string>): readonly Target[] {
  const withoutSelf = (targets: readonly Target[]) => targets;
  switch (format.kind) {
    case 'audio':
      return withoutSelf(AUDIO_TARGETS);
    case 'video':
      return [...VIDEO_TARGETS, GIF_TARGET, ...AUDIO_TARGETS];
    case 'image':
      return IMAGE_TARGETS.filter(
        (target) =>
          target.engine !== 'canvas' || !canvasTypes || canvasTypes.has(target.format.mime),
      );
  }
}

export function targetById(id: string): Target | undefined {
  return [...AUDIO_TARGETS, ...VIDEO_TARGETS, GIF_TARGET, ...IMAGE_TARGETS].find(
    (target) => target.id === id,
  );
}

export { AUDIO_TARGETS, VIDEO_TARGETS, IMAGE_TARGETS, GIF_TARGET };
