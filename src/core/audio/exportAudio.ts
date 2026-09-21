import { ffmpeg } from '../ffmpeg/client';
import { AUDIO_TARGETS, type Target } from '../convert/targets';
import type { ConversionOptions } from '../convert/options';
import type { AudioData } from './buffer';
import { encodeWav } from './wav';

/**
 * Exporting edited audio.
 *
 * The editor holds 32-bit float samples, so WAV needs no encoder at all — it is
 * a header and a copy. Everything else goes through ffmpeg.wasm, reusing the
 * very same target definitions the converter uses, so a "192 kbit/s MP3" means
 * exactly the same thing in both places.
 */

export const EXPORT_TARGETS: readonly Target[] = AUDIO_TARGETS;

export interface AudioExportContext {
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

export async function exportAudio(
  audio: AudioData,
  target: Target,
  options: ConversionOptions,
  context: AudioExportContext = {},
): Promise<Blob> {
  const wav = encodeWav(audio);
  if (target.id === 'wav' && options.audio.sampleRate === 'source' && options.audio.channels === 'source') {
    // Nothing to re-encode: the samples already are the file.
    context.onProgress?.(1);
    return wav;
  }

  const input = `edit_in.wav`;
  const output = `edit_out.${target.extension}`;
  try {
    await ffmpeg.writeFile(input, new Uint8Array(await wav.arrayBuffer()));
    if (!target.args) throw new Error(`${target.id} has no ffmpeg arguments`);
    await ffmpeg.run(target.args(options, input, output), {
      ...(context.signal ? { signal: context.signal } : {}),
      ...(context.onProgress ? { onProgress: context.onProgress } : {}),
    });
    const data = await ffmpeg.readFile(output);
    if (data.length === 0) throw new Error('ffmpeg produced an empty file');
    return new Blob([data], { type: target.format.mime });
  } finally {
    if (!context.signal?.aborted) {
      await ffmpeg.deleteFile(input);
      await ffmpeg.deleteFile(output);
    }
  }
}
