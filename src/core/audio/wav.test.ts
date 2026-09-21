import { describe, expect, it } from 'vitest';
import { createAudio, frameCount, type AudioData } from './buffer';
import { decodeWav, encodeWav } from './wav';

function tone(frames: number, channels = 2, sampleRate = 44100): AudioData {
  const audio = createAudio(channels, frames, sampleRate);
  audio.channels.forEach((channel, index) => {
    for (let i = 0; i < frames; i += 1) {
      channel[i] = Math.sin((i / 20) * Math.PI) * (index === 0 ? 0.8 : 0.4);
    }
  });
  return audio;
}

async function roundTrip(audio: AudioData): Promise<AudioData> {
  return decodeWav(await encodeWav(audio).arrayBuffer());
}

describe('encodeWav / decodeWav', () => {
  it('round-trips samples exactly, because it stores floats', async () => {
    const audio = tone(200);
    const out = await roundTrip(audio);
    expect(out.sampleRate).toBe(44100);
    expect(out.channels).toHaveLength(2);
    expect(frameCount(out)).toBe(200);
    for (let i = 0; i < 200; i += 1) {
      expect(out.channels[0]![i]).toBeCloseTo(audio.channels[0]![i]!, 6);
      expect(out.channels[1]![i]).toBeCloseTo(audio.channels[1]![i]!, 6);
    }
  });

  it('keeps an unusual sample rate and channel count', async () => {
    const out = await roundTrip(createAudio(1, 10, 22050));
    expect(out.sampleRate).toBe(22050);
    expect(out.channels).toHaveLength(1);
  });

  it('survives samples beyond full scale, which integer PCM would clip', async () => {
    const audio = createAudio(1, 2, 44100);
    audio.channels[0]![0] = 1.7;
    audio.channels[0]![1] = -1.3;
    const out = await roundTrip(audio);
    expect(out.channels[0]![0]).toBeCloseTo(1.7, 5);
    expect(out.channels[0]![1]).toBeCloseTo(-1.3, 5);
  });

  it('writes a header a decoder can find its way around', async () => {
    const view = new DataView(await encodeWav(tone(4)).arrayBuffer());
    expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe('RIFF');
    expect(view.getUint16(20, true)).toBe(3); // IEEE float
    expect(view.getUint16(34, true)).toBe(32); // bits per sample
  });

  it('handles an empty buffer', async () => {
    const out = await roundTrip(createAudio(2, 0, 48000));
    expect(frameCount(out)).toBe(0);
  });
});

describe('decodeWav — other producers', () => {
  /** Builds an integer-PCM WAV with an extra chunk before `data`. */
  function integerWav(bits: 8 | 16 | 24 | 32, samples: number[]): ArrayBuffer {
    const bytes = bits / 8;
    const listSize = 10; // odd payload plus its pad byte, to exercise alignment
    const dataBytes = samples.length * bytes;
    const buffer = new ArrayBuffer(12 + 24 + (8 + listSize) + 8 + dataBytes);
    const view = new DataView(buffer);
    const ascii = (offset: number, text: string) => {
      for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
    };

    ascii(0, 'RIFF');
    view.setUint32(4, buffer.byteLength - 8, true);
    ascii(8, 'WAVE');

    ascii(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true);
    view.setUint32(28, 8000 * bytes, true);
    view.setUint16(32, bytes, true);
    view.setUint16(34, bits, true);

    // The LIST chunk ffmpeg likes to insert, which is exactly what breaks
    // decoders that assume `data` begins at byte 44.
    ascii(36, 'LIST');
    view.setUint32(40, listSize, true);

    const dataAt = 44 + listSize;
    ascii(dataAt, 'data');
    view.setUint32(dataAt + 4, dataBytes, true);
    samples.forEach((value, index) => {
      const at = dataAt + 8 + index * bytes;
      if (bits === 8) view.setUint8(at, value);
      else if (bits === 16) view.setInt16(at, value, true);
      else if (bits === 24) {
        view.setUint8(at, value & 0xff);
        view.setUint8(at + 1, (value >> 8) & 0xff);
        view.setUint8(at + 2, (value >> 16) & 0xff);
      } else view.setInt32(at, value, true);
    });
    return buffer;
  }

  it('walks the chunk list instead of assuming data is at byte 44', () => {
    const out = decodeWav(integerWav(16, [0, 16384, -16384]));
    expect(frameCount(out)).toBe(3);
    expect(out.channels[0]![1]).toBeCloseTo(0.5, 4);
    expect(out.channels[0]![2]).toBeCloseTo(-0.5, 4);
  });

  it('reads 8-bit as unsigned, which is the odd one out', () => {
    const out = decodeWav(integerWav(8, [128, 255, 0]));
    expect(out.channels[0]![0]).toBeCloseTo(0, 4);
    expect(out.channels[0]![1]).toBeCloseTo(0.9922, 3);
    expect(out.channels[0]![2]).toBeCloseTo(-1, 4);
  });

  it('reads 24-bit, including negative values', () => {
    const out = decodeWav(integerWav(24, [4194304, -4194304]));
    expect(out.channels[0]![0]).toBeCloseTo(0.5, 4);
    expect(out.channels[0]![1]).toBeCloseTo(-0.5, 4);
  });

  it('reads 32-bit integer', () => {
    const out = decodeWav(integerWav(32, [1073741824]));
    expect(out.channels[0]![0]).toBeCloseTo(0.5, 4);
  });

  it('rejects something that is not a WAV at all', () => {
    expect(() => decodeWav(new ArrayBuffer(64))).toThrow(/RIFF/);
  });
});
