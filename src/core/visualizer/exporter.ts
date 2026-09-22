import type { AudioData } from '../audio/buffer';
import { encodeWav } from '../audio/wav';
import { x264ThreadArgs } from '../ffmpeg/threads';
import { FFmpegCancelled, ffmpeg } from '../ffmpeg/client';
import type { Frame } from './analysis';
import { drawScene, type DrawAssets } from './draw';
import { frameSize, type VisualizerScene } from './scene';

/**
 * Rendering a visualiser to a video file.
 *
 * Frame by frame from the pre-computed analysis, never by recording the screen.
 * That is what the brief asks for and it is also the only way to get a usable
 * result: a screen recording drops frames under load, so a slow machine would
 * produce a visibly worse video rather than simply taking longer.
 *
 * The same segment-then-join approach as the video exporter, for the same
 * reason: an entire track's worth of stills would exhaust the WebAssembly
 * filesystem long before the encoder ran.
 */

export type VisualizerFormat = 'mp4' | 'webm';

export interface VisualizerExportSettings {
  readonly format: VisualizerFormat;
  readonly quality: 'high' | 'balanced' | 'small';
}

export interface VisualizerProgress {
  readonly progress: number;
  readonly stage: 'frames' | 'encoding' | 'muxing';
  readonly frame: number;
  readonly totalFrames: number;
  readonly remaining?: number;
}

export interface VisualizerExportContext {
  onProgress?: (progress: VisualizerProgress) => void;
  signal?: AbortSignal;
}

const SEGMENT_FRAMES = 150;

const CRF = {
  mp4: { high: 18, balanced: 23, small: 28 },
  webm: { high: 10, balanced: 20, small: 32 },
} as const;

const WEBM_BITRATE = { high: '6M', balanced: '3M', small: '1500k' } as const;

/**
 * ¿Hay que conservar el canal alfa?
 *
 * Solo cuando el fondo es transparente y el destino es WebM. En MP4 no es una
 * limitación nuestra: H.264 no tiene canal alfa.
 */
export function keepsAlpha(scene: VisualizerScene, format: VisualizerFormat): boolean {
  return scene.background.kind === 'transparent' && format === 'webm';
}

function videoArgs(settings: VisualizerExportSettings, alpha: boolean): string[] {
  if (settings.format === 'webm') {
    // VP8 and Vorbis, for the reasons measured in PLAN.md §3.6: this build's
    // VP9 and stereo Opus both trap.
    return [
      '-c:v', 'libvpx',
      '-crf', String(CRF.webm[settings.quality]),
      '-b:v', WEBM_BITRATE[settings.quality],
      '-deadline', settings.quality === 'high' ? 'good' : 'realtime',
      '-cpu-used', settings.quality === 'high' ? '2' : '5',
      // `yuva420p` guarda el canal alfa; `auto-alt-ref` tiene que estar
      // apagado porque libvpx no lo admite junto con alfa y aborta.
      ...(alpha ? ['-pix_fmt', 'yuva420p', '-auto-alt-ref', '0'] : []),
    ];
  }
  return [
    '-c:v', 'libx264',
    '-preset', settings.quality === 'high' ? 'medium' : 'veryfast',
    '-crf', String(CRF.mp4[settings.quality]),
    '-pix_fmt', 'yuv420p',
    // Obligatorio, no una mejora: ver `x264ThreadArgs` y PLAN §3.8.
    ...x264ThreadArgs(),
  ];
}

export async function exportVisualizer(
  scene: VisualizerScene,
  frames: readonly Frame[],
  audio: AudioData,
  assets: DrawAssets,
  settings: VisualizerExportSettings,
  context: VisualizerExportContext = {},
): Promise<Blob> {
  if (frames.length === 0) throw new Error('there is nothing to render');

  const alpha = keepsAlpha(scene, settings.format);
  const size = frameSize(scene);
  const canvas = new OffscreenCanvas(size.width, size.height);
  // Sin alfa el contexto es más rápido, así que solo se pide cuando hace falta.
  const canvasContext = canvas.getContext('2d', { alpha });
  if (!canvasContext) throw new Error('2D context unavailable');

  const check = () => {
    if (context.signal?.aborted) throw new FFmpegCancelled();
  };

  await ffmpeg.writeFile('vis.wav', new Uint8Array(await encodeWav(audio).arrayBuffer()));

  const segments: string[] = [];
  const written: string[] = [];
  const started = performance.now();
  let inSegment = 0;
  let segmentIndex = 0;

  const encodeSegment = async () => {
    if (inSegment === 0) return;
    check();
    const name = `vseg_${segmentIndex}.${settings.format}`;
    await ffmpeg.run(
      [
        '-framerate', String(scene.fps),
        '-i', `v%05d.${alpha ? 'png' : 'jpg'}`,
        ...videoArgs(settings, alpha),
        '-an',
        '-y', name,
      ],
      context.signal ? { signal: context.signal } : {},
    );
    segments.push(name);
    for (const file of written) await ffmpeg.deleteFile(file);
    written.length = 0;
    inSegment = 0;
    segmentIndex += 1;
  };

  for (let index = 0; index < frames.length; index += 1) {
    check();
    drawScene(canvasContext, scene, frames[index], index, size, assets);

    // JPEG por defecto porque es bastante más rápido de codificar y de leer;
    // PNG solo cuando hay que conservar el alfa, que JPEG no tiene.
    const still = alpha
      ? await canvas.convertToBlob({ type: 'image/png' })
      : await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
    const name = `v${String(inSegment).padStart(5, '0')}.${alpha ? 'png' : 'jpg'}`;
    await ffmpeg.writeFile(name, new Uint8Array(await still.arrayBuffer()));
    written.push(name);
    inSegment += 1;

    const done = index + 1;
    const elapsed = (performance.now() - started) / 1000;
    context.onProgress?.({
      progress: (done / frames.length) * 0.9,
      stage: 'frames',
      frame: done,
      totalFrames: frames.length,
      ...(done > 5 ? { remaining: Math.round((elapsed / done) * (frames.length - done)) } : {}),
    });

    if (inSegment >= SEGMENT_FRAMES) await encodeSegment();
  }

  await encodeSegment();
  check();
  context.onProgress?.({
    progress: 0.93,
    stage: 'muxing',
    frame: frames.length,
    totalFrames: frames.length,
  });

  const output = `visualizer.${settings.format}`;
  await ffmpeg.writeFile(
    'vsegments.txt',
    new TextEncoder().encode(`${segments.map((name) => `file '${name}'`).join('\n')}\n`),
  );

  await ffmpeg.run(
    [
      '-f', 'concat',
      '-safe', '0',
      '-i', 'vsegments.txt',
      '-i', 'vis.wav',
      '-c:v', 'copy',
      '-c:a', settings.format === 'webm' ? 'libvorbis' : 'aac',
      '-b:a', '192k',
      '-shortest',
      ...(settings.format === 'mp4' ? ['-movflags', '+faststart'] : []),
      '-y', output,
    ],
    context.signal ? { signal: context.signal } : {},
  );

  const data = await ffmpeg.readFile(output);
  if (data.length === 0) throw new Error('the export produced an empty file');

  for (const name of [...segments, 'vsegments.txt', 'vis.wav', output]) {
    await ffmpeg.deleteFile(name);
  }

  context.onProgress?.({
    progress: 1,
    stage: 'muxing',
    frame: frames.length,
    totalFrames: frames.length,
  });

  return new Blob([data], {
    type: settings.format === 'webm' ? 'video/webm' : 'video/mp4',
  });
}
