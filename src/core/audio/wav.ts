import { createAudio, frameCount, type AudioData } from './buffer';

/**
 * WAV reading and writing.
 *
 * WAV is the interchange format inside Forja: the audio editor hands ffmpeg.wasm
 * a WAV to encode, and ffmpeg hands back a WAV when something needs decoding
 * that the browser will not decode itself. 32-bit float is used because it is
 * exactly what the editor holds in memory — no quantisation on the way through,
 * and no clipping of samples that momentarily exceed full scale.
 */

const RIFF = 0x46464952; // 'RIFF'
const WAVE = 0x45564157; // 'WAVE'
const FMT = 0x20746d66; // 'fmt '
const DATA = 0x61746164; // 'data'

export function encodeWav(audio: AudioData): Blob {
  const channels = audio.channels.length;
  const frames = frameCount(audio);
  const bytesPerSample = 4;
  const blockAlign = channels * bytesPerSample;
  const dataBytes = frames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  view.setUint32(0, RIFF, true);
  view.setUint32(4, 36 + dataBytes, true);
  view.setUint32(8, WAVE, true);
  view.setUint32(12, FMT, true);
  view.setUint32(16, 16, true);
  // Format 3 is IEEE float; 1 would be integer PCM.
  view.setUint16(20, 3, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  view.setUint32(36, DATA, true);
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      view.setFloat32(offset, audio.channels[channel]![frame]!, true);
      offset += 4;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Decodes a WAV we wrote, or one ffmpeg wrote.
 *
 * Deliberately narrow: it handles 8/16/24/32-bit integer and 32-bit float PCM,
 * walking the chunk list rather than assuming `data` sits at byte 44, because
 * ffmpeg inserts a `LIST` chunk. Anything else is someone else's job — the
 * browser's decoder, or ffmpeg.
 */
export function decodeWav(buffer: ArrayBuffer): AudioData {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== RIFF || view.getUint32(8, true) !== WAVE) {
    throw new Error('not a RIFF/WAVE file');
  }

  let format = 1;
  let channels = 2;
  let sampleRate = 44100;
  let bits = 16;
  let dataStart = -1;
  let dataLength = 0;

  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const id = view.getUint32(offset, true);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;

    if (id === FMT) {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
    } else if (id === DATA) {
      dataStart = body;
      dataLength = Math.min(size, buffer.byteLength - body);
    }
    // Chunks are word-aligned: an odd size is followed by a pad byte.
    offset = body + size + (size % 2);
  }

  if (dataStart < 0) throw new Error('no data chunk');

  const bytesPerSample = bits / 8;
  const frames = Math.floor(dataLength / (bytesPerSample * channels));
  const audio = createAudio(channels, frames, sampleRate);

  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const at = dataStart + (frame * channels + channel) * bytesPerSample;
      let value: number;
      if (format === 3) {
        value = bits === 64 ? view.getFloat64(at, true) : view.getFloat32(at, true);
      } else if (bits === 8) {
        // 8-bit WAV is unsigned, unlike every other depth.
        value = (view.getUint8(at) - 128) / 128;
      } else if (bits === 16) {
        value = view.getInt16(at, true) / 32768;
      } else if (bits === 24) {
        const raw =
          view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getInt8(at + 2) << 16);
        value = raw / 8388608;
      } else {
        value = view.getInt32(at, true) / 2147483648;
      }
      audio.channels[channel]![frame] = value;
    }
  }

  return audio;
}
