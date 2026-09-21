import { ffmpeg, FFmpegCancelled } from '../ffmpeg/client';
import type { MediaItem } from '../media/types';
import { baseName, safeFileName } from '../util/format';
import { convertImage } from './imageClient';
import type { ConversionOptions } from './options';
import { gifArgs, type Target } from './targets';

export interface ConversionResult {
  readonly blob: Blob;
  readonly fileName: string;
}

export interface RunContext {
  /** 0–1 for this conversion, when it can be measured. */
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

export function outputFileName(item: MediaItem, target: Target): string {
  return safeFileName(`${baseName(item.name)}.${target.extension}`);
}

/**
 * The extension ffmpeg sees for the input.
 *
 * ffmpeg picks a demuxer partly from the name, so handing it `input.mp4` when
 * the file is really a MOV can make it guess wrong. We use the extension of the
 * format we detected, not the one the user's file happened to carry.
 */
function inputName(item: MediaItem): string {
  return `input_${item.id}.${item.format.extensions[0] ?? 'bin'}`;
}

async function runWithFfmpeg(
  item: MediaItem,
  target: Target,
  options: ConversionOptions,
  context: RunContext,
): Promise<ConversionResult> {
  const input = inputName(item);
  const output = `out_${item.id}.${target.extension}`;
  const palette = `pal_${item.id}.png`;
  const scratch: string[] = [input, output];

  try {
    await ffmpeg.writeFile(input, new Uint8Array(await item.file.arrayBuffer()));

    if (target.id === 'gif') {
      scratch.push(palette);
      const { first, second } = gifArgs(options, input, palette);
      // The palette pass is roughly a third of the work; splitting the reported
      // progress keeps the bar honest rather than letting it restart at zero.
      await ffmpeg.run(first, {
        ...(context.signal ? { signal: context.signal } : {}),
        onProgress: (p) => context.onProgress?.(p * 0.35),
      });
      await ffmpeg.run(
        second.map((argument) => (argument === 'output.gif' ? output : argument)),
        {
          ...(context.signal ? { signal: context.signal } : {}),
          onProgress: (p) => context.onProgress?.(0.35 + p * 0.65),
        },
      );
    } else {
      if (!target.args) throw new Error(`${target.id} has no ffmpeg arguments`);
      await ffmpeg.run(target.args(options, input, output), {
        ...(context.signal ? { signal: context.signal } : {}),
        onProgress: (p) => context.onProgress?.(p),
      });
    }

    const data = await ffmpeg.readFile(output);
    if (data.length === 0) throw new Error('ffmpeg produced an empty file');
    return {
      blob: new Blob([data], { type: target.format.mime }),
      fileName: outputFileName(item, target),
    };
  } finally {
    // The worker is gone after a cancellation, so there is nothing to tidy.
    if (!context.signal?.aborted) {
      for (const name of scratch) await ffmpeg.deleteFile(name);
    }
  }
}

async function runWithCanvas(
  item: MediaItem,
  target: Target,
  options: ConversionOptions,
  context: RunContext,
): Promise<ConversionResult> {
  context.onProgress?.(0.1);
  const { blob } = await convertImage({
    file: item.file,
    mime: target.format.mime,
    quality: options.image.quality,
    maxSize: options.image.maxSize,
    // JPEG has no alpha channel; without a fill, transparency comes out black.
    ...(target.caveat === 'jpegNoAlpha' ? { flattenTo: '#ffffff' } : {}),
  });
  if (context.signal?.aborted) throw new FFmpegCancelled();
  context.onProgress?.(1);
  return { blob, fileName: outputFileName(item, target) };
}

export function runConversion(
  item: MediaItem,
  target: Target,
  options: ConversionOptions,
  context: RunContext = {},
): Promise<ConversionResult> {
  return target.engine === 'canvas'
    ? runWithCanvas(item, target, options, context)
    : runWithFfmpeg(item, target, options, context);
}
