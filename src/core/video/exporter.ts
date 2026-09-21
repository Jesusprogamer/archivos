import { encodeWav } from '../audio/wav';
import { FFmpegCancelled, ffmpeg } from '../ffmpeg/client';
import { isMediaClip, clipEnd, projectDuration, sourceTimeAt, type VideoProject } from './project';
import { mixProject, type AudioSourceLookup } from './mixdown';
import { renderFrame } from './renderer';
import type { SourceManager } from './sources';

/**
 * Exporting a project to a file.
 *
 * Deterministic by construction: every output frame is produced by seeking each
 * contributing video to an exact source time and compositing with the same
 * `renderFrame` the preview uses. Nothing is captured in real time, so the
 * result does not depend on how fast the machine happens to be, and a slow
 * frame delays the export rather than being dropped from it.
 *
 * Frames are encoded in segments. Holding an entire film's worth of stills in
 * the WebAssembly filesystem would exhaust memory long before the encoder ever
 * ran; a few seconds at a time keeps the ceiling flat regardless of length.
 */

export type ExportFormat = 'mp4' | 'webm';
export type ExportQuality = 'high' | 'balanced' | 'small';

export interface ExportSettings {
  readonly format: ExportFormat;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly quality: ExportQuality;
}

export interface ExportProgress {
  /** 0–1 overall. */
  readonly progress: number;
  readonly stage: 'frames' | 'encoding' | 'muxing';
  readonly frame: number;
  readonly totalFrames: number;
  /** Seconds, once there is enough signal to estimate. */
  readonly remaining?: number;
}

export interface ExportContext {
  onProgress?: (progress: ExportProgress) => void;
  signal?: AbortSignal;
}

/** Frames per encoded segment: a few seconds, so peak memory stays flat. */
const SEGMENT_FRAMES = 120;

const CRF: Record<ExportFormat, Record<ExportQuality, number>> = {
  mp4: { high: 18, balanced: 23, small: 28 },
  webm: { high: 10, balanced: 20, small: 32 },
};

/** Bit-rate ceiling for VP8, which needs one alongside its CRF. */
const WEBM_BITRATE: Record<ExportQuality, string> = {
  high: '6M',
  balanced: '3M',
  small: '1500k',
};

/** JPEG quality for the intermediate stills, per output quality. */
const STILL_QUALITY: Record<ExportQuality, number> = {
  high: 0.96,
  balanced: 0.9,
  small: 0.82,
};

function videoArgs(settings: ExportSettings): string[] {
  if (settings.format === 'webm') {
    return [
      // VP8, not VP9, and not by preference.
      //
      // `libvpx-vp9` is present in this core's encoder list but traps with
      // "memory access out of bounds" after the first frame, in every
      // configuration tried: with and without `-row-mt`, both deadlines,
      // `-threads 1`, and constant-bitrate mode (PLAN.md §3.6). VP8 encodes the
      // same clip cleanly, and four times faster with a realtime deadline.
      '-c:v', 'libvpx',
      '-crf', String(CRF.webm[settings.quality]),
      '-b:v', WEBM_BITRATE[settings.quality],
      '-deadline', settings.quality === 'high' ? 'good' : 'realtime',
      '-cpu-used', settings.quality === 'high' ? '2' : '5',
    ];
  }
  return [
    '-c:v', 'libx264',
    '-preset', settings.quality === 'high' ? 'medium' : 'veryfast',
    '-crf', String(CRF.mp4[settings.quality]),
    '-pix_fmt', 'yuv420p',
  ];
}

/** Which sources need seeking for a given moment, and to what time. */
export function sourceTimesAt(project: VideoProject, time: number): Map<string, number> {
  const times = new Map<string, number>();
  for (const track of project.tracks) {
    if (track.kind === 'audio' || track.hidden) continue;
    for (const clip of track.clips) {
      if (!isMediaClip(clip) || clip.kind === 'image') continue;
      if (time < clip.start || time >= clipEnd(clip)) continue;
      times.set(clip.sourceId, sourceTimeAt(clip, time));
    }
  }
  return times;
}

export interface ExportResult {
  readonly blob: Blob;
  /** Peak of the mixed audio, so the interface can warn about clipping. */
  readonly audioPeak: number;
  readonly frames: number;
}

export async function exportProject(
  project: VideoProject,
  sources: SourceManager,
  audioLookup: AudioSourceLookup,
  settings: ExportSettings,
  context: ExportContext = {},
): Promise<ExportResult> {
  const duration = projectDuration(project);
  if (duration <= 0) throw new Error('the project is empty');

  const totalFrames = Math.max(1, Math.ceil(duration * settings.fps));
  const scale = settings.width / project.width;
  const canvas = new OffscreenCanvas(settings.width, settings.height);
  const canvasContext = canvas.getContext('2d', { alpha: false });
  if (!canvasContext) throw new Error('2D context unavailable');

  const check = () => {
    if (context.signal?.aborted) throw new FFmpegCancelled();
  };

  // ---- Audio first: it is quick, and a failure here should not waste a long
  // ---- frame render.
  const { audio, peak } = mixProject(project, audioLookup);
  const hasAudio = peak > 0;
  if (hasAudio) {
    await ffmpeg.writeFile('mix.wav', new Uint8Array(await encodeWav(audio).arrayBuffer()));
  }

  const segments: string[] = [];
  const started = performance.now();
  let frameInSegment = 0;
  let segmentIndex = 0;
  const written: string[] = [];

  const encodeSegment = async () => {
    if (frameInSegment === 0) return;
    check();
    const name = `seg_${segmentIndex}.${settings.format === 'webm' ? 'webm' : 'mp4'}`;
    await ffmpeg.run(
      [
        '-framerate', String(settings.fps),
        '-i', 'f%05d.jpg',
        ...videoArgs(settings),
        '-an',
        '-y', name,
      ],
      context.signal ? { signal: context.signal } : {},
    );
    segments.push(name);
    for (const file of written) await ffmpeg.deleteFile(file);
    written.length = 0;
    frameInSegment = 0;
    segmentIndex += 1;
  };

  sources.pauseAll();

  for (let frame = 0; frame < totalFrames; frame += 1) {
    check();
    const time = frame / settings.fps;

    await sources.seekAll(sourceTimesAt(project, time));
    renderFrame(canvasContext, project, time, sources.lookup, { scale });

    const still = await canvas.convertToBlob({
      type: 'image/jpeg',
      quality: STILL_QUALITY[settings.quality],
    });
    const name = `f${String(frameInSegment).padStart(5, '0')}.jpg`;
    await ffmpeg.writeFile(name, new Uint8Array(await still.arrayBuffer()));
    written.push(name);
    frameInSegment += 1;

    const done = frame + 1;
    const elapsed = (performance.now() - started) / 1000;
    context.onProgress?.({
      // Frame rendering is the bulk of the work; encoding gets the last tenth.
      progress: (done / totalFrames) * 0.9,
      stage: 'frames',
      frame: done,
      totalFrames,
      ...(done > 5 ? { remaining: Math.round((elapsed / done) * (totalFrames - done)) } : {}),
    });

    if (frameInSegment >= SEGMENT_FRAMES) await encodeSegment();
  }

  await encodeSegment();
  check();

  context.onProgress?.({ progress: 0.92, stage: 'muxing', frame: totalFrames, totalFrames });

  // ---- Join the segments and add the sound ----
  const output = `export.${settings.format}`;
  const list = segments.map((name) => `file '${name}'`).join('\n');
  await ffmpeg.writeFile('segments.txt', new TextEncoder().encode(`${list}\n`));

  const audioArgs = hasAudio
    ? [
        '-i', 'mix.wav',
      // Vorbis, not Opus, for WebM.
      //
      // libopus works in an Ogg container but traps the Matroska muxer in this
      // build with "memory access out of bounds", in every sample format
      // tried (PLAN.md §3.6). Vorbis muxes cleanly.
        '-c:a', settings.format === 'webm' ? 'libvorbis' : 'aac',
        '-b:a', '192k',
        '-shortest',
      ]
    : ['-an'];

  await ffmpeg.run(
    [
      '-f', 'concat',
      '-safe', '0',
      '-i', 'segments.txt',
      ...audioArgs,
      // The video is already in the right codec, so it is copied rather than
      // re-encoded: a second pass would cost time and quality for nothing.
      '-c:v', 'copy',
      ...(settings.format === 'mp4' ? ['-movflags', '+faststart'] : []),
      '-y', output,
    ],
    context.signal ? { signal: context.signal } : {},
  );

  const data = await ffmpeg.readFile(output);
  if (data.length === 0) throw new Error('the export produced an empty file');

  // ---- Tidy up ----
  for (const name of [...segments, 'segments.txt', 'mix.wav', output]) {
    await ffmpeg.deleteFile(name);
  }

  context.onProgress?.({ progress: 1, stage: 'muxing', frame: totalFrames, totalFrames });

  return {
    blob: new Blob([data], {
      type: settings.format === 'webm' ? 'video/webm' : 'video/mp4',
    }),
    audioPeak: peak,
    frames: totalFrames,
  };
}

export const EXPORT_RESOLUTIONS = [
  { label: '2160p', height: 2160 },
  { label: '1440p', height: 1440 },
  { label: '1080p', height: 1080 },
  { label: '720p', height: 720 },
  { label: '480p', height: 480 },
] as const;

export const EXPORT_FRAME_RATES = [60, 30, 25, 24] as const;
