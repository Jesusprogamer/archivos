import { frameCount, type AudioData, type Samples } from './buffer';

/**
 * Waveform peaks.
 *
 * Drawing a waveform means answering "what is the loudest and quietest sample
 * in this column of pixels?" a few thousand times per repaint. Doing that
 * straight from the samples is fine at low zoom and hopeless at high: a ten
 * minute track is 26 million samples per channel, and scanning them all on
 * every frame would make dragging the playhead unusable.
 *
 * So peaks are computed once per (range, width) and cached. The cache is keyed
 * on what actually changes, so scrubbing reuses it and zooming does not.
 */

export interface PeakColumn {
  readonly min: number;
  readonly max: number;
}

/** One array of columns per channel. */
export type Peaks = readonly (readonly PeakColumn[])[];

export function computePeaks(
  audio: AudioData,
  fromFrame: number,
  toFrame: number,
  columns: number,
): Peaks {
  const start = Math.max(0, Math.min(fromFrame, toFrame));
  const end = Math.min(frameCount(audio), Math.max(fromFrame, toFrame));
  const span = end - start;
  const width = Math.max(1, Math.floor(columns));

  return audio.channels.map((channel) => {
    const result: PeakColumn[] = new Array<PeakColumn>(width);
    for (let column = 0; column < width; column += 1) {
      const columnStart = start + Math.floor((column * span) / width);
      const columnEnd = start + Math.floor(((column + 1) * span) / width);
      result[column] = peakRange(channel, columnStart, Math.max(columnStart + 1, columnEnd));
    }
    return result;
  });
}

function peakRange(channel: Samples, from: number, to: number): PeakColumn {
  let min = Infinity;
  let max = -Infinity;
  const end = Math.min(channel.length, to);
  for (let i = Math.max(0, from); i < end; i += 1) {
    const value = channel[i]!;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  // An empty column (past the end of the audio) is silence, not infinity.
  return Number.isFinite(min) ? { min, max } : { min: 0, max: 0 };
}

interface CacheEntry {
  readonly key: string;
  readonly peaks: Peaks;
}

/**
 * A one-entry cache.
 *
 * One is the right number: the view only ever shows a single range at a single
 * width, and keeping older entries would pin megabytes for a scroll position
 * nobody is looking at any more.
 */
export class PeakCache {
  private entry: CacheEntry | undefined;

  get(audio: AudioData, from: number, to: number, columns: number, revision: number): Peaks {
    const key = `${revision}:${from}:${to}:${columns}`;
    if (this.entry?.key === key) return this.entry.peaks;
    const peaks = computePeaks(audio, from, to, columns);
    this.entry = { key, peaks };
    return peaks;
  }

  clear(): void {
    this.entry = undefined;
  }
}
